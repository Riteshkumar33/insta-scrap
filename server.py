import os
import re
import sys
import json
import time
import urllib.parse
import subprocess
import requests
from flask import Flask, request, jsonify

app = Flask(__name__, static_folder='public', static_url_path='')

PORT = 3000

# Cookie store setup
COOKIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'session_cookies.txt')
stored_cookies = ''
is_session_valid = False

# ─── Delay Helper ───────────────────────────────────────────────────────────
def delay(ms):
    time.sleep(ms / 1000.0)

# ─── Fetch with Curl Helper ──────────────────────────────────────────────────
class CurlResponse:
    def __init__(self, status, header_text, body_text):
        self.status = status
        self.ok = 200 <= status < 300
        self._header_text = header_text
        self._body_text = body_text

    def text(self):
        return self._body_text

    def json(self):
        return json.loads(self._body_text)

    def get_header(self, name):
        regex = re.compile(rf'^{re.escape(name)}:\s*(.*)$', re.IGNORECASE | re.MULTILINE)
        match = regex.search(self._header_text)
        return match.group(1).strip() if match else None

    def get_set_cookie(self):
        cookies = []
        for line in self._header_text.splitlines():
            m = re.match(r'^Set-Cookie:\s*(.*)$', line, re.IGNORECASE)
            if m:
                cookies.append(m.group(1).strip())
        return cookies

def fetch_with_curl(url, options=None):
    if options is None:
        options = {}
        
    args = ['curl.exe', '-s', '-i']
    
    if options.get('redirect') != 'manual':
        args.append('-L')
        
    method = options.get('method', 'GET').upper()
    if method == 'HEAD':
        args.append('-I')
    elif method != 'GET':
        args.extend(['-X', method])
        
    headers = options.get('headers', {})
    for key, val in headers.items():
        args.extend(['-H', f"{key}: {val}"])
        
    body = options.get('body')
    if body is not None:
        if not isinstance(body, str):
            body = json.dumps(body)
        args.extend(['-d', body])
        
    args.append(url)
    
    # Run the subprocess
    try:
        # Increase maxBuffer equivalent (not strictly limited in Python unless we specify, but capture_output handles it)
        result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='ignore', timeout=30)
        stdout = result.stdout
    except subprocess.TimeoutExpired:
        raise Exception("Curl request timed out")
    except Exception as e:
        raise Exception(f"Failed to run curl: {str(e)}")
        
    header_text = ''
    body_text = stdout
    pos = 0
    
    while True:
        remaining = stdout[pos:]
        if not re.match(r'^HTTP/[0-9.]+\s+\d+', remaining, re.IGNORECASE):
            break
            
        next_double_lf = remaining.find('\r\n\r\n')
        sep_len = 4
        if next_double_lf == -1:
            next_double_lf = remaining.find('\n\n')
            sep_len = 2
            
        if next_double_lf == -1:
            break
            
        header_text = remaining[:next_double_lf]
        pos += next_double_lf + sep_len
        body_text = stdout[pos:]
        
    status_line = header_text.splitlines()[0] if header_text else ''
    status_match = re.search(r'HTTP/[0-9.]+\s+(\d+)', status_line, re.IGNORECASE)
    status = int(status_match.group(1)) if status_match else 200
    
    return CurlResponse(status, header_text, body_text)

# ─── Cookie Helpers ─────────────────────────────────────────────────────────
def verify_session(cookies):
    if not cookies:
        return False
    try:
        test_r = fetch_with_curl('https://www.instagram.com/web/search/topsearch/?query=instagram', {
            'headers': build_web_headers(cookies, '')
        })
        return test_r.status == 200
    except Exception as e:
        print(f"Session validation request failed: {str(e)}", file=sys.stderr)
        return False

def ensure_csrf_token(cookies):
    if not cookies:
        return ''
    updated_cookies = cookies
    
    if 'csrftoken' not in cookies:
        sid_match = re.search(r'sessionid=([^;]+)', cookies)
        sid = sid_match.group(1) if sid_match else cookies.strip()
        
        print('🔑 Cookies missing csrftoken. Fetching from Instagram homepage...')
        try:
            r = fetch_with_curl('https://www.instagram.com/', {
                'method': 'HEAD',
                'headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Cookie': f"sessionid={sid}"
                },
                'redirect': 'manual'
            })
            set_cookies = r.get_set_cookie()
            csrftoken = ''
            for c in set_cookies:
                m = re.search(r'csrftoken=([^;]+)', c)
                if m:
                    csrftoken = m.group(1)
                    break
            if csrftoken:
                raw_sid = urllib.parse.unquote(sid)
                # Split user ID from session ID (which format is e.g. userID%3A... or userID:...)
                user_id = re.split(r'%3A|:', raw_sid)[0]
                updated_cookies = f"sessionid={sid}; csrftoken={csrftoken}; ds_user_id={user_id}"
                print('✅ CSRF token obtained and cookies updated')
        except Exception as e:
            print(f"Failed to auto-fetch csrftoken: {str(e)}", file=sys.stderr)
            
    return updated_cookies

def load_cookies():
    global stored_cookies, is_session_valid
    try:
        if os.path.exists(COOKIES_FILE):
            with open(COOKIES_FILE, 'r', encoding='utf-8') as f:
                cookies = f.read().strip()
            if cookies:
                print('🔑 Loaded stored cookies from session_cookies.txt')
                cookies = ensure_csrf_token(cookies)
                stored_cookies = cookies
                with open(COOKIES_FILE, 'w', encoding='utf-8') as f:
                    f.write(cookies)
                
                is_session_valid = verify_session(stored_cookies)
                if is_session_valid:
                    print('✅ Stored session is VALID')
                else:
                    print('⚠️ Stored session is INVALID or EXPIRED')
    except Exception as e:
        print(f"Failed to load stored cookies: {str(e)}", file=sys.stderr)

def save_cookies(cookies):
    global stored_cookies
    try:
        stored_cookies = cookies
        with open(COOKIES_FILE, 'w', encoding='utf-8') as f:
            f.write(cookies)
        print('🔑 Saved cookies to session_cookies.txt')
    except Exception as e:
        print(f"Failed to save cookies: {str(e)}", file=sys.stderr)

# ─── Language Detection ─────────────────────────────────────────────────────
LANG_PATTERNS = [
    {'lang': 'Hindi',      're': re.compile(r'[\u0900-\u097F]')},
    {'lang': 'Arabic',     're': re.compile(r'[\u0600-\u06FF]')},
    {'lang': 'Bengali',    're': re.compile(r'[\u0980-\u09FF]')},
    {'lang': 'Chinese',    're': re.compile(r'[\u4E00-\u9FFF]')},
    {'lang': 'Japanese',   're': re.compile(r'[\u3040-\u30FF]')},
    {'lang': 'Korean',     're': re.compile(r'[\uAC00-\uD7AF]')},
    {'lang': 'Tamil',      're': re.compile(r'[\u0B80-\u0BFF]')},
    {'lang': 'Telugu',     're': re.compile(r'[\u0C00-\u0C7F]')},
    {'lang': 'Thai',       're': re.compile(r'[\u0E00-\u0E7F]')},
    {'lang': 'Russian',    're': re.compile(r'[\u0400-\u04FF]')},
    {'lang': 'Gujarati',   're': re.compile(r'[\u0A80-\u0AFF]')},
    {'lang': 'Kannada',    're': re.compile(r'[\u0C80-\u0CFF]')},
    {'lang': 'Malayalam',  're': re.compile(r'[\u0D00-\u0D7F]')},
    {'lang': 'Punjabi',    're': re.compile(r'[\u0A00-\u0A7F]')},
    {'lang': 'Spanish',    're': re.compile(r'[áéíóúñ¿¡]', re.IGNORECASE)},
    {'lang': 'French',     're': re.compile(r'[àâæçéèêëïîôœùûüÿ]', re.IGNORECASE)},
    {'lang': 'German',     're': re.compile(r'[äöüß]', re.IGNORECASE)},
    {'lang': 'Portuguese', 're': re.compile(r'[ãõàáâéêíóôúç]', re.IGNORECASE)},
]

def detect_language(text):
    if not text or not text.strip():
        return 'Unknown'
    for pat in LANG_PATTERNS:
        if pat['re'].search(text):
            return pat['lang']
    if re.search(r'[a-zA-Z]', text):
        return 'English'
    return 'Unknown'

# ─── Email Extraction ───────────────────────────────────────────────────────
def extract_email_from_bio(bio):
    if not bio:
        return None
    email_regex = r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'
    matches = re.findall(email_regex, bio)
    return matches[0] if matches else None

# ─── Number Formatter ───────────────────────────────────────────────────────
def format_count(count):
    if count is None:
        return '0'
    try:
        count = int(count)
    except (ValueError, TypeError):
        return '0'
    if count >= 1000000:
        return f"{count / 1000000.0:.1f}M"
    if count >= 1000:
        return f"{count / 1000.0:.1f}K"
    return str(count)

def parse_formatted_number(str_val):
    if not str_val:
        return 0
    clean = str_val.replace(',', '').strip()
    multiplier_match = re.search(r'[KMB]$', clean, re.IGNORECASE)
    try:
        if multiplier_match:
            mult = multiplier_match.group(0).upper()
            num = float(clean[:-1])
            if mult == 'K':
                return int(round(num * 1000))
            elif mult == 'M':
                return int(round(num * 1000000))
            elif mult == 'B':
                return int(round(num * 1000000000))
        return int(round(float(clean)))
    except (ValueError, TypeError):
        return 0

# ─── Extract CSRF token from cookies ────────────────────────────────────────
def extract_csrf_token(cookies):
    match = re.search(r'csrftoken=([^;]+)', cookies)
    return match.group(1) if match else ''

# ─── Build headers ──────────────────────────────────────────────────────────
def build_web_headers(cookies, username):
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-IG-WWW-Claim': 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5it9P-5B5PtOOw',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': extract_csrf_token(cookies),
        'Referer': f"https://www.instagram.com/{username or ''}/",
        'Origin': 'https://www.instagram.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cookie': cookies,
    }

def build_mobile_headers(cookies):
    return {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
        'X-IG-App-ID': '567067343352427',
        'X-CSRFToken': extract_csrf_token(cookies),
        'Cookie': cookies,
    }

# ─── Deep search for user object in nested JSON ────────────────────────────
def find_user_in_object(obj, username, depth=0):
    if depth > 8 or not obj:
        return None
        
    if isinstance(obj, dict):
        if obj.get('username') == username and (
            obj.get('full_name') is not None or 
            obj.get('follower_count') is not None or 
            obj.get('edge_followed_by') is not None
        ):
            return obj
            
        for val in obj.values():
            found = find_user_in_object(val, username, depth + 1)
            if found:
                return found
                
    elif isinstance(obj, list):
        for item in obj:
            found = find_user_in_object(item, username, depth + 1)
            if found:
                return found
                
    return None

# ─── Data Extraction ────────────────────────────────────────────────────────
def extract_profile_data(user, username):
    bio = user.get('biography') or user.get('bio') or ''
    public_email = user.get('public_email') or user.get('business_email') or None
    bio_email = extract_email_from_bio(bio)
    email = public_email or bio_email or None
    language = detect_language(bio)

    # Followers
    edge_followed_by = user.get('edge_followed_by')
    followers = 0
    if isinstance(edge_followed_by, dict):
        followers = edge_followed_by.get('count', 0)
    else:
        followers = user.get('follower_count', 0)

    # Following
    edge_follow = user.get('edge_follow')
    following = 0
    if isinstance(edge_follow, dict):
        following = edge_follow.get('count', 0)
    else:
        following = user.get('following_count', 0)

    # Posts
    edge_owner_to_timeline_media = user.get('edge_owner_to_timeline_media')
    posts = 0
    if isinstance(edge_owner_to_timeline_media, dict):
        posts = edge_owner_to_timeline_media.get('count', 0)
    else:
        posts = user.get('media_count', 0)

    # Profile picture
    profile_pic = user.get('profile_pic_url_hd') or user.get('profile_pic_url')
    if not profile_pic:
        hd_info = user.get('hd_profile_pic_url_info')
        if isinstance(hd_info, dict):
            profile_pic = hd_info.get('url', '')

    return {
        'id': user.get('pk') or user.get('id') or user.get('fbid') or 'N/A',
        'username': user.get('username') or username,
        'fullName': user.get('full_name') or 'N/A',
        'bio': bio,
        'profilePicUrl': profile_pic or '',
        'followers': followers,
        'followersFormatted': format_count(followers),
        'following': following,
        'followingFormatted': format_count(following),
        'posts': posts,
        'postsFormatted': format_count(posts),
        'isVerified': bool(user.get('is_verified', False)),
        'isPrivate': bool(user.get('is_private', False)),
        'isBusiness': bool(user.get('is_business_account', False)),
        'category': user.get('category_name') or user.get('category') or None,
        'email': email,
        'externalUrl': user.get('external_url') or None,
        'language': language,
    }

def extract_meta_data(html, username):
    desc_match = re.search(r'<meta[^>]*content="([^"]*)"[^>]*property="og:description"', html, re.IGNORECASE) or \
                 re.search(r'<meta[^>]*property="og:description"[^>]*content="([^"]*)"', html, re.IGNORECASE)
                 
    title_match = re.search(r'<meta[^>]*content="([^"]*)"[^>]*property="og:title"', html, re.IGNORECASE) or \
                  re.search(r'<meta[^>]*property="og:title"[^>]*content="([^"]*)"', html, re.IGNORECASE)
                  
    img_match = re.search(r'<meta[^>]*content="([^"]*)"[^>]*property="og:image"', html, re.IGNORECASE) or \
                re.search(r'<meta[^>]*property="og:image"[^>]*content="([^"]*)"', html, re.IGNORECASE)

    if not desc_match and not title_match:
        return None

    full_name = 'N/A'
    if title_match:
        name_match = re.search(r'^(.+?)\s*\(@', title_match.group(1))
        if name_match:
            full_name = name_match.group(1).strip()

    followers, following, posts = 0, 0, 0
    if desc_match:
        desc_text = desc_match.group(1)
        followers_match = re.search(r'([\d,.]+[KMB]?)\s*Followers', desc_text, re.IGNORECASE)
        following_match = re.search(r'([\d,.]+[KMB]?)\s*Following', desc_text, re.IGNORECASE)
        posts_match = re.search(r'([\d,.]+[KMB]?)\s*Posts', desc_text, re.IGNORECASE)

        if followers_match:
            followers = parse_formatted_number(followers_match.group(1))
        if following_match:
            following = parse_formatted_number(following_match.group(1))
        if posts_match:
            posts = parse_formatted_number(posts_match.group(1))

    bio = ''
    if desc_match:
        bio = re.sub(r'^[\d,.\s]*Followers.*?-\s*', '', desc_match.group(1))

    return {
        'id': 'N/A',
        'username': username,
        'fullName': full_name,
        'bio': bio.strip(),
        'profilePicUrl': img_match.group(1) if img_match else '',
        'followers': followers,
        'followersFormatted': format_count(followers),
        'following': following,
        'followingFormatted': format_count(following),
        'posts': posts,
        'postsFormatted': format_count(posts),
        'isVerified': False,
        'isPrivate': False,
        'isBusiness': False,
        'category': None,
        'email': extract_email_from_bio(bio),
        'externalUrl': None,
        'language': detect_language(bio),
    }

# ─── Scraping Strategies ────────────────────────────────────────────────────

# Strategy 1: Web Profile Info API
def try_web_profile_api(username, cookies):
    url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={urllib.parse.quote(username)}"
    response = fetch_with_curl(url, {'headers': build_web_headers(cookies, username)})
    
    if response.status == 429:
        return {'__rateLimit': True}
    if not response.ok:
        return None
        
    text = response.text()
    if not text or not text.strip():
        return None
        
    data = json.loads(text)
    user = data.get('data', {}).get('user')
    if not user:
        return None
        
    return extract_profile_data(user, username)

# Strategy 2: Mobile API
def try_mobile_api(username, cookies):
    url = f"https://i.instagram.com/api/v1/users/web_profile_info/?username={urllib.parse.quote(username)}"
    response = fetch_with_curl(url, {'headers': build_mobile_headers(cookies)})
    
    if response.status == 429:
        return {'__rateLimit': True}
    if not response.ok:
        return None
        
    text = response.text()
    if not text or not text.strip():
        return None
        
    data = json.loads(text)
    user = data.get('data', {}).get('user') or data.get('user')
    if not user:
        return None
        
    return extract_profile_data(user, username)

# Strategy 3: GraphQL search + user info
def try_graphql_endpoint(username, cookies):
    search_url = f"https://www.instagram.com/web/search/topsearch/?query={urllib.parse.quote(username)}"
    search_response = fetch_with_curl(search_url, {'headers': build_web_headers(cookies, username)})
    
    if search_response.status == 429:
        return {'__rateLimit': True}
    if not search_response.ok:
        return None
        
    search_data = search_response.json()
    users = search_data.get('users', [])
    user_result = None
    for u in users:
        curr_user = u.get('user', {})
        if curr_user.get('username', '').lower() == username.lower():
            user_result = u
            break
            
    if not user_result or not user_result.get('user'):
        return None
        
    user_id = user_result['user']['pk']
    delay(300)
    
    info_url = f"https://www.instagram.com/api/v1/users/{user_id}/info/"
    info_response = fetch_with_curl(info_url, {'headers': build_web_headers(cookies, username)})
    
    if info_response.ok:
        info_data = info_response.json()
        info_user = info_data.get('user')
        if info_user and info_user.get('username'):
            return extract_profile_data(info_user, username)
            
    return extract_profile_data(user_result['user'], username)

# Strategy 4: HTML scraping fallback
def try_html_scraping(username, cookies):
    url = f"https://www.instagram.com/{urllib.parse.quote(username)}/"
    response = fetch_with_curl(url, {
        'headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': cookies,
            'Cache-Control': 'no-cache',
        }
    })
    
    if response.status == 429:
        return {'__rateLimit': True}
    if not response.ok:
        return None
        
    html = response.text()
    if not html or len(html) < 1000:
        return None
        
    if '/accounts/login' in html and 'og:description' not in html:
        print('    ⚠️ Redirected to login page — session may be invalid')
        return None
        
    # Try _sharedData
    shared_data_match = re.search(r'window\._sharedData\s*=\s*({.+?});</script>', html)
    if shared_data_match:
        try:
            shared_data = json.loads(shared_data_match.group(1))
            profile_page = shared_data.get('entry_data', {}).get('ProfilePage')
            if profile_page and len(profile_page) > 0:
                user = profile_page[0].get('graphql', {}).get('user')
                if user:
                    return extract_profile_data(user, username)
        except Exception:
            pass
            
    # Try __additionalDataLoaded
    additional_data_match = re.search(r'window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\)', html)
    if additional_data_match:
        try:
            additional_data = json.loads(additional_data_match.group(1))
            user = additional_data.get('graphql', {}).get('user') or additional_data.get('user')
            if user:
                return extract_profile_data(user, username)
        except Exception:
            pass
            
    # Try JSON embedded in script tags
    json_scripts = re.findall(r'<script[^>]*type="application/json"[^>]*>([\s\S]*?)</script>', html, re.IGNORECASE)
    for script_content in json_scripts:
        try:
            json_data = json.loads(script_content)
            user = find_user_in_object(json_data, username)
            if user:
                return extract_profile_data(user, username)
        except Exception:
            pass
            
    # Try extracting from meta tags
    return extract_meta_data(html, username)

# ─── Routes ─────────────────────────────────────────────────────────────────

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/<path:path>')
def serve_static(path):
    return app.send_static_file(path)

@app.route('/api/session', methods=['POST'])
def save_session_route():
    global is_session_valid, stored_cookies
    data = request.get_json() or {}
    session_id = data.get('sessionId')
    
    if not session_id or not session_id.strip():
        save_cookies('')
        is_session_valid = False
        return jsonify({'success': True, 'message': 'Session cleared', 'valid': False})
        
    input_val = session_id.strip()
    if '=' not in input_val:
        if 'sessionid' not in input_val:
            input_val = f"sessionid={input_val}"
            
    input_val = ensure_csrf_token(input_val)
    save_cookies(input_val)
    
    is_session_valid = verify_session(stored_cookies)
    if is_session_valid:
        print('✅ Session is VALID')
        return jsonify({'success': True, 'message': 'Session saved and verified!', 'valid': True})
    else:
        print('⚠️ Session validation failed')
        return jsonify({
            'success': False,
            'message': 'Session saved but could not verify. The cookie is likely invalid or expired.',
            'valid': False
        })

@app.route('/api/session/status', methods=['GET'])
def session_status_route():
    return jsonify({
        'hasSession': bool(stored_cookies),
        'isValid': is_session_valid
    })

@app.route('/api/debug-cookies', methods=['GET'])
def debug_cookies_route():
    return jsonify({'cookies': stored_cookies})

@app.route('/api/scrape/<username>', methods=['GET'])
def scrape_route(username):
    if not username or not username.strip():
        return jsonify({'error': 'Username is required'}), 400
        
    clean_username = username.strip().lstrip('@')
    cookies = stored_cookies
    
    if not cookies or not is_session_valid:
        return jsonify({
            'error': 'Session cookie is invalid, expired, or not connected. Please update it using the panel above.',
            'needsAuth': True
        }), 401
        
    print(f"\n🔍 Scraping @{clean_username}...")
    
    strategies = [
        {'name': 'Web Profile API', 'fn': lambda: try_web_profile_api(clean_username, cookies)},
        {'name': 'Mobile API', 'fn': lambda: try_mobile_api(clean_username, cookies)},
        {'name': 'GraphQL Search', 'fn': lambda: try_graphql_endpoint(clean_username, cookies)},
        {'name': 'HTML Scraping', 'fn': lambda: try_html_scraping(clean_username, cookies)},
    ]
    
    last_error = ''
    is_429 = False
    
    for strategy in strategies:
        try:
            print(f"  → Trying {strategy['name']}...")
            result = strategy['fn']()
            if result:
                if result.get('__rateLimit'):
                    is_429 = True
                    print(f"  ⚠️ {strategy['name']}: Rate limited (429)")
                    delay(1000)
                    continue
                print(f"  ✅ Success via {strategy['name']}")
                return jsonify({'success': True, 'data': result})
            print(f"  ⚠️ {strategy['name']}: No data returned")
        except Exception as e:
            last_error = str(e)
            print(f"  ❌ {strategy['name']} error: {str(e)}")
            
        delay(500)
        
    print(f"  ❌ All strategies failed for @{clean_username}")
    
    if is_429:
        return jsonify({
            'error': 'Instagram is rate-limiting your requests (HTTP 429). Please wait 2-5 minutes and try again. If this persists, your session cookie may have expired — try getting a fresh one from your browser.'
        }), 429
        
    return jsonify({
        'error': f"Could not fetch profile data. {f'Last error: {last_error}. ' if last_error else ''}Your session cookie may have expired — try re-copying it from your browser."
    }), 500

@app.route('/api/proxy-image', methods=['GET'])
def proxy_image_route():
    image_url = request.args.get('url')
    if not image_url:
        return 'Missing url parameter', 400
        
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        }
        r = requests.get(image_url, headers=headers, timeout=10)
        if r.status_code != 200:
            return 'Failed to fetch image', r.status_code
            
        content_type = r.headers.get('Content-Type', 'image/jpeg')
        response = app.make_response(r.content)
        response.headers['Content-Type'] = content_type
        response.headers['Cache-Control'] = 'public, max-age=3600'
        return response
    except Exception:
        return 'Image proxy error', 500

# ─── Start server ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Initial load
    load_cookies()
    
    print(f"\n  ╔══════════════════════════════════════════════╗")
    print(f"  ║   🔍 InstaScope running on                   ║")
    print(f"  ║   http://localhost:{PORT}                      ║")
    print(f"  ║                                              ║")
    print(f"  ║   Tip: Copy ALL cookies from your browser,   ║")
    print(f"  ║   not just the sessionid value.              ║")
    print(f"  ╚══════════════════════════════════════════════╝\n")
    
    app.run(host='0.0.0.0', port=PORT)
