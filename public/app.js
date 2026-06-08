/* ═══════════════════════════════════════════════════════════════════════════
   InstaScope — Frontend Application Logic
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM Elements ───────────────────────────────────────────────────────
  const usernameInput  = document.getElementById('username-input');
  const searchBtn      = document.getElementById('search-btn');
  const searchIcon     = searchBtn.querySelector('.search-icon');
  const spinner        = searchBtn.querySelector('.spinner');
  const errorSection   = document.getElementById('error-section');
  const errorMessage   = document.getElementById('error-message');
  const retryBtn       = document.getElementById('retry-btn');
  const resultsSection = document.getElementById('results-section');
  const hintBtns       = document.querySelectorAll('.hint-btn');

  // Profile elements
  const profilePic     = document.getElementById('profile-pic');
  const profileName    = document.getElementById('profile-name');
  const profileUsername = document.getElementById('profile-username');
  const verifiedBadge  = document.getElementById('verified-badge');
  const businessBadge  = document.getElementById('business-badge');
  const privateBadge   = document.getElementById('private-badge');
  const categoryBadge  = document.getElementById('category-badge');
  const statPosts      = document.getElementById('stat-posts');
  const statFollowers  = document.getElementById('stat-followers');
  const statFollowing  = document.getElementById('stat-following');
  const bioSection     = document.getElementById('bio-section');
  const bioText        = document.getElementById('bio-text');
  const dataTbody      = document.getElementById('data-tbody');
  const exportBtn      = document.getElementById('export-btn');

  // Session elements
  const sessionToggle  = document.getElementById('session-toggle');
  const sessionBody    = document.getElementById('session-body');
  const sessionChevron = document.getElementById('session-chevron');
  const sessionInput   = document.getElementById('session-input');
  const sessionSaveBtn = document.getElementById('session-save-btn');
  const sessionStatus  = document.getElementById('session-status');
  const sessionCard    = document.querySelector('.session-card');
  const sessionWarning = document.getElementById('session-warning');

  let currentData = null;

  // ─── Session Panel Toggle ─────────────────────────────────────────────
  sessionToggle.addEventListener('click', () => {
    const isOpen = sessionBody.classList.toggle('open');
    sessionChevron.classList.toggle('open', isOpen);
  });

  // Auto-open session panel on load
  checkSessionStatus();

  // ─── Session Save ─────────────────────────────────────────────────────
  sessionSaveBtn.addEventListener('click', saveSession);
  sessionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveSession();
  });

  async function saveSession() {
    const value = sessionInput.value.trim();
    if (!value) {
      shakeElement(sessionInput);
      return;
    }

    sessionSaveBtn.textContent = 'Saving...';
    sessionSaveBtn.disabled = true;
    sessionWarning.style.display = 'none';

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: value }),
      });

      const data = await response.json();

      if (data.success && data.valid) {
        setSessionConnected(true, true);
        sessionInput.value = '';
        // Collapse the panel after saving
        setTimeout(() => {
          sessionBody.classList.remove('open');
          sessionChevron.classList.remove('open');
        }, 800);
      } else {
        setSessionConnected(true, false);
        sessionWarning.textContent = data.message || 'Verification failed. Please check the session ID.';
        sessionWarning.style.display = 'block';
        shakeElement(sessionCard);
      }
    } catch (err) {
      console.error('Failed to save session:', err);
      sessionWarning.textContent = 'Failed to connect to the server.';
      sessionWarning.style.display = 'block';
    } finally {
      sessionSaveBtn.textContent = 'Save';
      sessionSaveBtn.disabled = false;
    }
  }

  async function checkSessionStatus() {
    try {
      const response = await fetch('/api/session/status');
      const data = await response.json();
      setSessionConnected(data.hasSession, data.isValid);

      // Auto-open if not connected or invalid
      if (!data.hasSession || !data.isValid) {
        sessionBody.classList.add('open');
        sessionChevron.classList.add('open');
        if (data.hasSession && !data.isValid) {
          sessionWarning.textContent = '⚠️ Your stored session cookie has expired or is invalid. Please get a fresh one from your browser.';
          sessionWarning.style.display = 'block';
        }
      }
    } catch (err) {
      setSessionConnected(false, false);
      sessionBody.classList.add('open');
      sessionChevron.classList.add('open');
    }
  }

  function setSessionConnected(connected, isValid) {
    sessionStatus.classList.remove('connected', 'validating', 'invalid');
    sessionCard.classList.remove('connected', 'invalid');

    if (connected) {
      if (isValid) {
        sessionStatus.textContent = '● Connected';
        sessionStatus.classList.add('connected');
        sessionCard.classList.add('connected');
        sessionWarning.style.display = 'none';
      } else {
        sessionStatus.textContent = '● Session invalid / expired';
        sessionStatus.classList.add('invalid');
        sessionCard.classList.add('invalid');
      }
    } else {
      sessionStatus.textContent = '● Not connected';
      sessionCard.classList.remove('connected');
      sessionWarning.style.display = 'none';
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────────
  searchBtn.addEventListener('click', handleSearch);
  retryBtn.addEventListener('click', () => {
    usernameInput.focus();
    hideError();
  });

  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  hintBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      usernameInput.value = btn.dataset.username;
      handleSearch();
    });
  });

  exportBtn.addEventListener('click', exportCSV);

  // ─── Search Handler ───────────────────────────────────────────────────
  async function handleSearch() {
    const username = usernameInput.value.trim().replace(/^@/, '');

    if (!username) {
      usernameInput.focus();
      shakeElement(usernameInput.closest('.search-input-wrapper'));
      return;
    }

    setLoading(true);
    hideError();
    hideResults();

    try {
      const response = await fetch(`/api/scrape/${encodeURIComponent(username)}`);
      const json = await response.json();

      if (!response.ok || !json.success) {
        // If auth is needed, open the session panel
        if (json.needsAuth) {
          sessionBody.classList.add('open');
          sessionChevron.classList.add('open');
          sessionInput.focus();
        }
        throw new Error(json.error || 'Failed to fetch profile data');
      }

      currentData = json.data;
      renderProfile(json.data);
      showResults();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Render Profile ───────────────────────────────────────────────────
  function renderProfile(data) {
    // Profile picture
    if (data.profilePicUrl) {
      profilePic.src = `/api/proxy-image?url=${encodeURIComponent(data.profilePicUrl)}`;
      profilePic.alt = `${data.fullName} profile picture`;
    } else {
      profilePic.src = generateAvatarSvg(data.username);
    }

    // Name & Username
    profileName.textContent = data.fullName || data.username;
    profileUsername.textContent = `@${data.username}`;

    // Badges
    verifiedBadge.style.display = data.isVerified ? 'flex' : 'none';
    businessBadge.style.display = data.isBusiness ? 'inline-block' : 'none';
    privateBadge.style.display = data.isPrivate ? 'inline-block' : 'none';

    if (data.category) {
      categoryBadge.textContent = data.category;
      categoryBadge.style.display = 'inline-block';
    } else {
      categoryBadge.style.display = 'none';
    }

    // Stats with count-up animation
    animateNumber(statPosts, data.posts, data.postsFormatted);
    animateNumber(statFollowers, data.followers, data.followersFormatted);
    animateNumber(statFollowing, data.following, data.followingFormatted);

    // Bio
    if (data.bio && data.bio.trim()) {
      bioText.textContent = data.bio;
      bioSection.style.display = 'block';
    } else {
      bioSection.style.display = 'none';
    }

    // Data table
    renderDataTable(data);
  }

  // ─── Data Table ───────────────────────────────────────────────────────
  function renderDataTable(data) {
    const rows = [
      { label: 'Instagram ID', value: data.id, type: 'text' },
      { label: 'Full Name', value: data.fullName, type: 'text' },
      { label: 'Username', value: `@${data.username}`, type: 'text' },
      { label: 'Email', value: data.email, type: 'email' },
      { label: 'Category', value: data.category, type: 'text' },
      { label: 'Language', value: data.language, type: 'text' },
      { label: 'Followers', value: data.followers?.toLocaleString(), type: 'text' },
      { label: 'Following', value: data.following?.toLocaleString(), type: 'text' },
      { label: 'Posts', value: data.posts?.toLocaleString(), type: 'text' },
      { label: 'Verified', value: data.isVerified ? '✅ Yes' : '❌ No', type: 'text' },
      { label: 'Private', value: data.isPrivate ? '🔒 Yes' : '🔓 No', type: 'text' },
      { label: 'Business', value: data.isBusiness ? '🏢 Yes' : '👤 No', type: 'text' },
      { label: 'External URL', value: data.externalUrl, type: 'link' },
      { label: 'Profile Link', value: `https://instagram.com/${data.username}`, type: 'link' },
    ];

    dataTbody.innerHTML = '';

    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      const tdValue = document.createElement('td');

      tdLabel.textContent = row.label;

      if (row.value === null || row.value === undefined || row.value === '' || row.value === 'N/A') {
        tdValue.innerHTML = '<span class="data-value-na">Not available</span>';
      } else if (row.type === 'link') {
        const a = document.createElement('a');
        a.href = row.value;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'data-value-link';
        a.textContent = row.value;
        tdValue.appendChild(a);
      } else if (row.type === 'email') {
        const a = document.createElement('a');
        a.href = `mailto:${row.value}`;
        a.className = 'data-value-email';
        a.textContent = row.value;
        tdValue.appendChild(a);
      } else {
        tdValue.textContent = row.value;
      }

      tr.appendChild(tdLabel);
      tr.appendChild(tdValue);
      dataTbody.appendChild(tr);
    });
  }

  // ─── CSV Export ───────────────────────────────────────────────────────
  function exportCSV() {
    if (!currentData) return;

    const d = currentData;
    const headers = ['Field', 'Value'];
    const rows = [
      ['Instagram ID', d.id],
      ['Full Name', d.fullName],
      ['Username', d.username],
      ['Email', d.email || 'N/A'],
      ['Category / Genre', d.category || 'N/A'],
      ['Language', d.language || 'N/A'],
      ['Followers', d.followers],
      ['Following', d.following],
      ['Posts', d.posts],
      ['Verified', d.isVerified ? 'Yes' : 'No'],
      ['Private', d.isPrivate ? 'Yes' : 'No'],
      ['Business Account', d.isBusiness ? 'Yes' : 'No'],
      ['Bio', `"${(d.bio || '').replace(/"/g, '""')}"`],
      ['External URL', d.externalUrl || 'N/A'],
      ['Profile URL', `https://instagram.com/${d.username}`],
    ];

    const csvContent =
      headers.join(',') +
      '\n' +
      rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `instascope_${d.username}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    // Visual feedback
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Downloaded!
    `;
    exportBtn.style.background = 'rgba(46, 213, 115, 0.2)';
    setTimeout(() => {
      exportBtn.innerHTML = originalText;
      exportBtn.style.background = '';
    }, 2000);
  }

  // ─── UI Helpers ───────────────────────────────────────────────────────
  function setLoading(loading) {
    searchBtn.disabled = loading;
    searchIcon.style.display = loading ? 'none' : 'block';
    spinner.style.display = loading ? 'block' : 'none';
    usernameInput.disabled = loading;
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorSection.style.display = 'block';
    resultsSection.style.display = 'none';
  }

  function hideError() {
    errorSection.style.display = 'none';
  }

  function showResults() {
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideResults() {
    resultsSection.style.display = 'none';
  }

  function shakeElement(el) {
    el.style.animation = 'none';
    el.offsetHeight; // force reflow
    el.style.animation = 'shake 0.4s ease-in-out';
    setTimeout(() => (el.style.animation = ''), 500);
  }

  // ─── Count-Up Animation ──────────────────────────────────────────────
  function animateNumber(el, targetNum, formattedStr) {
    if (targetNum === 0 || targetNum === undefined) {
      el.textContent = '0';
      return;
    }

    // For large numbers, show formatted string directly with a fade effect
    if (targetNum > 10000) {
      el.style.opacity = '0';
      el.textContent = formattedStr;
      let opacity = 0;
      const fadeIn = setInterval(() => {
        opacity += 0.1;
        el.style.opacity = Math.min(opacity, 1);
        if (opacity >= 1) clearInterval(fadeIn);
      }, 30);
      return;
    }

    // Count-up for smaller numbers
    const duration = 800;
    const start = performance.now();

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(eased * targetNum);
      el.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = formattedStr;
    }

    requestAnimationFrame(step);
  }

  // ─── Fallback Avatar ─────────────────────────────────────────────────
  function generateAvatarSvg(username) {
    const initial = (username || '?')[0].toUpperCase();
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
        <defs>
          <linearGradient id="av-grad" x1="0" y1="88" x2="88" y2="0">
            <stop offset="0%" stop-color="#d62976"/>
            <stop offset="100%" stop-color="#4f5bd5"/>
          </linearGradient>
        </defs>
        <rect width="88" height="88" rx="44" fill="url(#av-grad)"/>
        <text x="44" y="44" dy="0.35em" text-anchor="middle"
              font-family="Inter,sans-serif" font-size="36" font-weight="700" fill="#fff">
          ${initial}
        </text>
      </svg>
    `;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  // Add shake animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
  `;
  document.head.appendChild(style);
})();
