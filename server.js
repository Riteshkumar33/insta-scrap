const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const PORT = 3000;

// Parse JSON bodies
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Cookie store ────────────────────────────────────────────────────────────
const COOKIES_FILE = path.join(__dirname, 'session_cookies.txt');
let storedCookies = '';
let isSessionValid = false;

async function verifySession(cookies) {
  if (!cookies) return false;
  try {
    const testR = await fetchWithCurl('https://www.instagram.com/web/search/topsearch/?query=instagram', {
      headers: buildWebHeaders(cookies, ''),
    });
    return testR.status === 200;
  } catch (e) {
    console.error('Session validation request failed:', e.message);
    return false;
  }
}

async function ensureCsrfToken(cookies) {
  if (!cookies) return '';
  let updatedCookies = cookies;

  if (!cookies.includes('csrftoken')) {
    const sidMatch = cookies.match(/sessionid=([^;]+)/);
    const sid = sidMatch ? sidMatch[1] : cookies.trim();
    
    console.log('🔑 Cookies missing csrftoken. Fetching from Instagram homepage...');
    try {
      const r = await fetchWithCurl('https://www.instagram.com/', {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Cookie': `sessionid=${sid}`,
        },
        redirect: 'manual',
      });
      const setCookies = r.headers.getSetCookie() || [];
      let csrftoken = '';
      for (const c of setCookies) {
        const m = c.match(/csrftoken=([^;]+)/);
        if (m) { csrftoken = m[1]; break; }
      }
      if (csrftoken) {
        const rawSid = decodeURIComponent(sid);
        const userId = rawSid.split(/%3A|:/)[0];
        updatedCookies = `sessionid=${sid}; csrftoken=${csrftoken}; ds_user_id=${userId}`;
        console.log('✅ CSRF token obtained and cookies updated');
      }
    } catch (e) {
      console.error('Failed to auto-fetch csrftoken:', e.message);
    }
  }
  return updatedCookies;
}

async function loadCookies() {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      let cookies = fs.readFileSync(COOKIES_FILE, 'utf8').trim();
      if (cookies) {
        console.log('🔑 Loaded stored cookies from session_cookies.txt');
        cookies = await ensureCsrfToken(cookies);
        storedCookies = cookies;
        fs.writeFileSync(COOKIES_FILE, cookies, 'utf8');
        
        isSessionValid = await verifySession(storedCookies);
        if (isSessionValid) {
          console.log('✅ Stored session is VALID');
        } else {
          console.log('⚠️ Stored session is INVALID or EXPIRED');
        }
      }
    }
  } catch (e) {
    console.error('Failed to load stored cookies:', e.message);
  }
}

function saveCookies(cookies) {
  try {
    storedCookies = cookies;
    fs.writeFileSync(COOKIES_FILE, cookies, 'utf8');
    console.log('🔑 Saved cookies to session_cookies.txt');
  } catch (e) {
    console.error('Failed to save cookies:', e.message);
  }
}

// Initial load
loadCookies().catch(console.error);

// ─── Language Detection ─────────────────────────────────────────────────────

const LANG_PATTERNS = [
  { lang: 'Hindi',      re: /[\u0900-\u097F]/ },
  { lang: 'Arabic',     re: /[\u0600-\u06FF]/ },
  { lang: 'Bengali',    re: /[\u0980-\u09FF]/ },
  { lang: 'Chinese',    re: /[\u4E00-\u9FFF]/ },
  { lang: 'Japanese',   re: /[\u3040-\u30FF]/ },
  { lang: 'Korean',     re: /[\uAC00-\uD7AF]/ },
  { lang: 'Tamil',      re: /[\u0B80-\u0BFF]/ },
  { lang: 'Telugu',     re: /[\u0C00-\u0C7F]/ },
  { lang: 'Thai',       re: /[\u0E00-\u0E7F]/ },
  { lang: 'Russian',    re: /[\u0400-\u04FF]/ },
  { lang: 'Gujarati',   re: /[\u0A80-\u0AFF]/ },
  { lang: 'Kannada',    re: /[\u0C80-\u0CFF]/ },
  { lang: 'Malayalam',  re: /[\u0D00-\u0D7F]/ },
  { lang: 'Punjabi',    re: /[\u0A00-\u0A7F]/ },
  { lang: 'Spanish',    re: /[áéíóúñ¿¡]/i },
  { lang: 'French',     re: /[àâæçéèêëïîôœùûüÿ]/i },
  { lang: 'German',     re: /[äöüß]/i },
  { lang: 'Portuguese', re: /[ãõàáâéêíóôúç]/i },
];

function detectLanguage(text) {
  if (!text || text.trim().length === 0) return 'Unknown';
  for (const { lang, re } of LANG_PATTERNS) {
    if (re.test(text)) return lang;
  }
  if (/[a-zA-Z]/.test(text)) return 'English';
  return 'Unknown';
}

// ─── Email extraction ───────────────────────────────────────────────────────

function extractEmailFromBio(bio) {
  if (!bio) return null;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = bio.match(emailRegex);
  return matches ? matches[0] : null;
}

// ─── Number formatter ───────────────────────────────────────────────────────

function formatCount(count) {
  if (count === undefined || count === null) return '0';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
  return count.toString();
}

// ─── Delay helper ───────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Fetch with Curl Helper ──────────────────────────────────────────────────
function fetchWithCurl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-i'];
    
    if (options.redirect !== 'manual') {
      args.push('-L');
    }
    
    if (options.method && options.method.toUpperCase() === 'HEAD') {
      args.push('-I');
    } else if (options.method && options.method.toUpperCase() !== 'GET') {
      args.push('-X', options.method.toUpperCase());
    }
    
    if (options.headers) {
      for (const [key, val] of Object.entries(options.headers)) {
        args.push('-H', `${key}: ${val}`);
      }
    }
    
    if (options.body) {
      args.push('-d', typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    args.push(url);
    
    execFile('curl.exe', args, { maxBuffer: 15 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      
      let headerText = '';
      let bodyText = stdout;
      let pos = 0;
      
      while (true) {
        const remaining = stdout.substring(pos);
        if (!remaining.match(/^HTTP\/[0-9.]+\s+\d+/i)) {
          break;
        }
        
        let nextDoubleLf = remaining.indexOf('\r\n\r\n');
        let sepLen = 4;
        if (nextDoubleLf === -1) {
          nextDoubleLf = remaining.indexOf('\n\n');
          sepLen = 2;
        }
        
        if (nextDoubleLf === -1) {
          break;
        }
        
        headerText = remaining.substring(0, nextDoubleLf);
        pos += nextDoubleLf + sepLen;
        bodyText = stdout.substring(pos);
      }
      
      const statusLine = headerText.split(/\r?\n/)[0];
      const statusMatch = statusLine.match(/HTTP\/[0-9.]+\s+(\d+)/i);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
      
      resolve({
        status,
        ok: status >= 200 && status < 300,
        text: async () => bodyText,
        json: async () => JSON.parse(bodyText),
        headers: {
          get: (name) => {
            const regex = new RegExp(`^${name}:\\s*(.*)$`, 'im');
            const match = headerText.match(regex);
            return match ? match[1].trim() : null;
          },
          getSetCookie: () => {
            const cookies = [];
            const lines = headerText.split(/\r?\n/);
            for (const line of lines) {
              const m = line.match(/^Set-Cookie:\s*(.*)$/i);
              if (m) cookies.push(m[1].trim());
            }
            return cookies;
          }
        }
      });
    });
  });
}

// ─── Extract CSRF token from cookies ────────────────────────────────────────

function extractCsrfToken(cookies) {
  const match = cookies.match(/csrftoken=([^;]+)/);
  return match ? match[1] : '';
}

// ─── Build headers ──────────────────────────────────────────────────────────

function buildWebHeaders(cookies, username) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': '936619743392459',
    'X-IG-WWW-Claim': 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5it9P-5B5PtOOw',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRFToken': extractCsrfToken(cookies),
    'Referer': `https://www.instagram.com/${username || ''}/`,
    'Origin': 'https://www.instagram.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cookie': cookies,
  };
}

function buildMobileHeaders(cookies) {
  return {
    'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
    'X-IG-App-ID': '567067343352427',
    'X-CSRFToken': extractCsrfToken(cookies),
    'Cookie': cookies,
  };
}

// ─── Save session endpoint ──────────────────────────────────────────────────

app.post('/api/session', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || sessionId.trim().length === 0) {
    saveCookies('');
    isSessionValid = false;
    return res.json({ success: true, message: 'Session cleared', valid: false });
  }

  let input = sessionId.trim();

  // If user pasted just the sessionid value (no "=" signs), wrap it
  if (!input.includes('=')) {
    if (!input.includes('sessionid')) {
      input = `sessionid=${input}`;
    }
  }

  // Ensure we have a csrftoken
  input = await ensureCsrfToken(input);
  saveCookies(input);

  // Validate the session by making a quick test request
  isSessionValid = await verifySession(storedCookies);
  if (isSessionValid) {
    console.log('✅ Session is VALID');
    return res.json({ success: true, message: 'Session saved and verified!', valid: true });
  } else {
    console.log('⚠️ Session validation failed');
    return res.json({ success: false, message: 'Session saved but could not verify. The cookie is likely invalid or expired.', valid: false });
  }
});

app.get('/api/session/status', (req, res) => {
  res.json({ hasSession: !!storedCookies, isValid: isSessionValid });
});

app.get('/api/debug-cookies', (req, res) => {
  res.json({ cookies: storedCookies });
});

// ─── Instagram scraping endpoint ────────────────────────────────────────────

app.get('/api/scrape/:username', async (req, res) => {
  const { username } = req.params;

  if (!username || username.trim().length === 0) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const cleanUsername = username.trim().replace(/^@/, '');
  const cookies = storedCookies;

  if (!cookies || !isSessionValid) {
    return res.status(401).json({
      error: 'Session cookie is invalid, expired, or not connected. Please update it using the panel above.',
      needsAuth: true,
    });
  }

  console.log(`\n🔍 Scraping @${cleanUsername}...`);

  const strategies = [
    { name: 'Web Profile API', fn: () => tryWebProfileAPI(cleanUsername, cookies) },
    { name: 'Mobile API', fn: () => tryMobileAPI(cleanUsername, cookies) },
    { name: 'GraphQL Search', fn: () => tryGraphQLEndpoint(cleanUsername, cookies) },
    { name: 'HTML Scraping', fn: () => tryHtmlScraping(cleanUsername, cookies) },
  ];

  let lastError = '';
  let is429 = false;

  for (const strategy of strategies) {
    try {
      console.log(`  → Trying ${strategy.name}...`);
      const result = await strategy.fn();
      if (result) {
        if (result.__rateLimit) {
          is429 = true;
          console.log(`  ⚠️ ${strategy.name}: Rate limited (429)`);
          await delay(1000); // Wait before next strategy
          continue;
        }
        console.log(`  ✅ Success via ${strategy.name}`);
        return res.json({ success: true, data: result });
      }
      console.log(`  ⚠️ ${strategy.name}: No data returned`);
    } catch (err) {
      lastError = err.message;
      console.log(`  ❌ ${strategy.name} error: ${err.message}`);
    }
    await delay(500); // Small delay between strategies
  }

  console.log(`  ❌ All strategies failed for @${cleanUsername}`);

  if (is429) {
    return res.status(429).json({
      error: `Instagram is rate-limiting your requests (HTTP 429). Please wait 2-5 minutes and try again. If this persists, your session cookie may have expired — try getting a fresh one from your browser.`,
    });
  }

  return res.status(500).json({
    error: `Could not fetch profile data. ${lastError ? 'Last error: ' + lastError + '. ' : ''}Your session cookie may have expired — try re-copying it from your browser.`,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCRAPING STRATEGIES
// ═══════════════════════════════════════════════════════════════════════════

// Strategy 1: Web Profile Info API (best data)
async function tryWebProfileAPI(username, cookies) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetchWithCurl(url, { headers: buildWebHeaders(cookies, username) });

  if (response.status === 429) return { __rateLimit: true };
  if (!response.ok) return null;

  const text = await response.text();
  if (!text || text.length === 0) return null;

  const data = JSON.parse(text);
  if (!data.data?.user) return null;

  return extractProfileData(data.data.user, username);
}

// Strategy 2: Mobile API (i.instagram.com)
async function tryMobileAPI(username, cookies) {
  // Use the same web_profile_info endpoint but on mobile subdomain
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetchWithCurl(url, { headers: buildMobileHeaders(cookies) });

  if (response.status === 429) return { __rateLimit: true };
  if (!response.ok) return null;

  const text = await response.text();
  if (!text || text.length === 0) return null;

  const data = JSON.parse(text);
  const user = data.data?.user || data.user;
  if (!user) return null;

  return extractProfileData(user, username);
}

// Strategy 3: GraphQL search + user info
async function tryGraphQLEndpoint(username, cookies) {
  const searchUrl = `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(username)}`;
  const searchResponse = await fetchWithCurl(searchUrl, { headers: buildWebHeaders(cookies, username) });

  if (searchResponse.status === 429) return { __rateLimit: true };
  if (!searchResponse.ok) return null;

  const searchData = await searchResponse.json();
  const userResult = searchData.users?.find(
    (u) => u.user?.username?.toLowerCase() === username.toLowerCase()
  );

  if (!userResult?.user) return null;

  // Try to get full profile info
  const userId = userResult.user.pk;
  await delay(300);

  const infoUrl = `https://www.instagram.com/api/v1/users/${userId}/info/`;
  const infoResponse = await fetchWithCurl(infoUrl, { headers: buildWebHeaders(cookies, username) });

  if (infoResponse.ok) {
    const infoData = await infoResponse.json();
    if (infoData.user && infoData.user.username) {
      return extractProfileData(infoData.user, username);
    }
  }

  // Return partial data from search
  return extractProfileData(userResult.user, username);
}

// Strategy 4: HTML scraping fallback
async function tryHtmlScraping(username, cookies) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  const response = await fetchWithCurl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': cookies,
      'Cache-Control': 'no-cache',
    },
  });

  if (response.status === 429) return { __rateLimit: true };
  if (!response.ok) return null;

  const html = await response.text();
  if (!html || html.length < 1000) return null;

  // Check if we got redirected to login
  if (html.includes('/accounts/login') && !html.includes('og:description')) {
    console.log('    ⚠️ Redirected to login page — session may be invalid');
    return null;
  }

  // Try _sharedData
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
  if (sharedDataMatch) {
    try {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const user = sharedData.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) return extractProfileData(user, username);
    } catch (e) { /* continue */ }
  }

  // Try __additionalDataLoaded
  const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\)/);
  if (additionalDataMatch) {
    try {
      const additionalData = JSON.parse(additionalDataMatch[1]);
      const user = additionalData.graphql?.user || additionalData.user;
      if (user) return extractProfileData(user, username);
    } catch (e) { /* continue */ }
  }

  // Try JSON embedded in script tags (newer Instagram format)
  const jsonScripts = html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonScripts) {
    try {
      const json = JSON.parse(m[1]);
      const user = findUserInObject(json, username);
      if (user) return extractProfileData(user, username);
    } catch (e) { /* continue */ }
  }

  // Try extracting from meta tags as last resort
  return extractMetaData(html, username);
}

// ─── Deep search for user object in nested JSON ────────────────────────────

function findUserInObject(obj, username, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;

  // Check if this object looks like a user
  if (obj.username === username && (obj.full_name !== undefined || obj.follower_count !== undefined || obj.edge_followed_by)) {
    return obj;
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findUserInObject(item, username, depth + 1);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      const found = findUserInObject(obj[key], username, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function extractProfileData(user, username) {
  const bio = user.biography || user.bio || '';
  const publicEmail = user.public_email || user.business_email || null;
  const bioEmail = extractEmailFromBio(bio);
  const email = publicEmail || bioEmail || null;
  const language = detectLanguage(bio);

  return {
    id: user.pk || user.id || user.fbid || 'N/A',
    username: user.username || username,
    fullName: user.full_name || 'N/A',
    bio: bio,
    profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url || user.hd_profile_pic_url_info?.url || '',
    followers: user.edge_followed_by?.count ?? user.follower_count ?? 0,
    followersFormatted: formatCount(user.edge_followed_by?.count ?? user.follower_count ?? 0),
    following: user.edge_follow?.count ?? user.following_count ?? 0,
    followingFormatted: formatCount(user.edge_follow?.count ?? user.following_count ?? 0),
    posts: user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0,
    postsFormatted: formatCount(user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0),
    isVerified: user.is_verified || false,
    isPrivate: user.is_private || false,
    isBusiness: user.is_business_account || false,
    category: user.category_name || user.category || null,
    email: email,
    externalUrl: user.external_url || null,
    language: language,
  };
}

function extractMetaData(html, username) {
  // Instagram meta tags can have content before or after property
  const descMatch = html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:description"/i)
                 || html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i);
  const titleMatch = html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:title"/i)
                  || html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i);
  const imgMatch = html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:image"/i)
                || html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/i);

  if (!descMatch && !titleMatch) return null;

  let fullName = 'N/A';
  if (titleMatch) {
    const nameMatch = titleMatch[1].match(/^(.+?)\s*\(@/);
    if (nameMatch) fullName = nameMatch[1].trim();
  }

  let followers = 0, following = 0, posts = 0;
  if (descMatch) {
    const followersMatch = descMatch[1].match(/([\d,.]+[KMB]?)\s*Followers/i);
    const followingMatch = descMatch[1].match(/([\d,.]+[KMB]?)\s*Following/i);
    const postsMatch = descMatch[1].match(/([\d,.]+[KMB]?)\s*Posts/i);

    if (followersMatch) followers = parseFormattedNumber(followersMatch[1]);
    if (followingMatch) following = parseFormattedNumber(followingMatch[1]);
    if (postsMatch) posts = parseFormattedNumber(postsMatch[1]);
  }

  const bio = descMatch ? descMatch[1].replace(/^[\d,.\s]*Followers.*?-\s*/, '') : '';

  return {
    id: 'N/A',
    username: username,
    fullName: fullName,
    bio: bio.trim(),
    profilePicUrl: imgMatch ? imgMatch[1] : '',
    followers, followersFormatted: formatCount(followers),
    following, followingFormatted: formatCount(following),
    posts, postsFormatted: formatCount(posts),
    isVerified: false, isPrivate: false, isBusiness: false,
    category: null, email: extractEmailFromBio(bio),
    externalUrl: null, language: detectLanguage(bio),
  };
}

function parseFormattedNumber(str) {
  if (!str) return 0;
  const clean = str.replace(/,/g, '');
  const multiplier = clean.match(/[KMB]$/i);
  const num = parseFloat(clean);
  if (multiplier) {
    switch (multiplier[0].toUpperCase()) {
      case 'K': return Math.round(num * 1_000);
      case 'M': return Math.round(num * 1_000_000);
      case 'B': return Math.round(num * 1_000_000_000);
    }
  }
  return Math.round(num) || 0;
}

// ─── Image Proxy ────────────────────────────────────────────────────────────

app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing url parameter');

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return res.status(response.status).send('Failed to fetch image');

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send('Image proxy error');
  }
});

// ─── Start server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║   🔍 InstaScope running on                   ║`);
  console.log(`  ║   http://localhost:${PORT}                      ║`);
  console.log(`  ║                                              ║`);
  console.log(`  ║   Tip: Copy ALL cookies from your browser,   ║`);
  console.log(`  ║   not just the sessionid value.              ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});
