(() => {
  'use strict';

  const CLIENT_ID = () => window.GOOGLE_CLIENT_ID;

  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'profile',
    'email',
  ].join(' ');

  const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
  const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

  const KEY_TOKEN    = 'auron_token';
  const KEY_RT       = 'auron_rt';
  const KEY_EXPIRY   = 'auron_expiry';
  const KEY_VERIFIER = 'auron_cv';
  const KEY_SSID     = 'auron_ssid';
  const KEY_OB       = 'auron_ob';
  const KEY_PROFILE  = 'auron_profile';

  function getRedirectUri() {
    const origin = window.location.origin;
    let path = window.location.pathname;
    if (!path.endsWith('/')) path += '/';
    return origin + path;
  }

  function base64urlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function generateRandom(length = 64) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return base64urlEncode(array);
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64urlEncode(digest);
  }

  function storeTokenResponse(data) {
    if (data.access_token) {
      localStorage.setItem(KEY_TOKEN, data.access_token);
    }
    if (data.refresh_token) {
      localStorage.setItem(KEY_RT, data.refresh_token);
    }
    if (data.expires_in) {
      const expiry = Date.now() + (data.expires_in - 60) * 1000;
      localStorage.setItem(KEY_EXPIRY, String(expiry));
    }
  }

  function clearAllKeys() {
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_RT);
    localStorage.removeItem(KEY_EXPIRY);
    localStorage.removeItem(KEY_VERIFIER);
    localStorage.removeItem(KEY_SSID);
    localStorage.removeItem(KEY_OB);
    localStorage.removeItem(KEY_PROFILE);
  }

  function tokenExpired() {
    const expiry = localStorage.getItem(KEY_EXPIRY);
    if (!expiry) return true;
    return Date.now() >= Number(expiry);
  }

  async function refreshAccessToken() {
    const rt = localStorage.getItem(KEY_RT);
    if (!rt) throw new Error('No refresh token available');

    const params = new URLSearchParams({
      client_id:     CLIENT_ID(),
      grant_type:    'refresh_token',
      refresh_token: rt,
    });

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!resp.ok) {
      clearAllKeys();
      throw new Error('Token refresh failed — signed out');
    }

    const data = await resp.json();
    storeTokenResponse(data);
    return data.access_token;
  }

  async function signIn() {
    const verifier  = generateRandom(64);
    const challenge = await sha256(verifier);

    localStorage.setItem(KEY_VERIFIER, verifier);

    const params = new URLSearchParams({
      client_id:             CLIENT_ID(),
      redirect_uri:          getRedirectUri(),
      response_type:         'code',
      scope:                 SCOPES,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      access_type:           'offline',
      prompt:                'consent',
    });

    window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async function handleCallback() {
    const url    = new URL(window.location.href);
    const code   = url.searchParams.get('code');
    const error  = url.searchParams.get('error');

    if (error) {
      clearAllKeys();
      throw new Error(`OAuth error: ${error}`);
    }

    if (!code) return false;

    const verifier = localStorage.getItem(KEY_VERIFIER);
    if (!verifier) throw new Error('Missing PKCE code verifier');

    const params = new URLSearchParams({
      client_id:     CLIENT_ID(),
      redirect_uri:  getRedirectUri(),
      grant_type:    'authorization_code',
      code,
      code_verifier: verifier,
    });

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error_description || 'Token exchange failed');
    }

    const data = await resp.json();
    localStorage.removeItem(KEY_VERIFIER);
    storeTokenResponse(data);

    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('scope');
    const cleanUrl = url.pathname + (url.search !== '?' ? url.search : '');
    window.history.replaceState({}, document.title, cleanUrl);

    return true;
  }

  async function getToken() {
    if (!tokenExpired()) {
      return localStorage.getItem(KEY_TOKEN);
    }
    if (localStorage.getItem(KEY_RT)) {
      return refreshAccessToken();
    }
    throw new Error('Not authenticated');
  }

  async function getUserInfo() {
    const token = await getToken();
    const resp  = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error('Failed to fetch user info');
    const profile = await resp.json();
    localStorage.setItem(KEY_PROFILE, JSON.stringify(profile));
    return profile;
  }

  function signOut() {
    clearAllKeys();
  }

  function isSignedIn() {
    const token = localStorage.getItem(KEY_TOKEN);
    const rt    = localStorage.getItem(KEY_RT);
    if (token && !tokenExpired()) return true;
    if (rt) return true;
    return false;
  }

  window.AUTH = { signIn, handleCallback, getToken, getUserInfo, signOut, isSignedIn };
})();
