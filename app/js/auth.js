(() => {
  'use strict';

  let _sb   = null;
  let _session = null;

  function _client() {
    if (!_sb) _sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return _sb;
  }

  // Check URL for OAuth errors or tokens and expose them
  function _checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const err    = params.get('error');
    const errDesc = params.get('error_description');
    if (err) {
      window._authUrlError = errDesc ? decodeURIComponent(errDesc).replace(/\+/g,' ') : err;
      // Clean URL without reloading
      try { window.history.replaceState({}, '', window.location.pathname); } catch (_) {}
    }
  }

  // Called once from App.init() — resolves true if already signed in
  async function init() {
    _checkUrlParams();

    const sb = _client();

    // Give Supabase a moment to exchange the PKCE code from URL if present
    await new Promise(res => setTimeout(res, 100));

    const { data, error } = await sb.auth.getSession();
    _session = data.session;

    if (error) {
      window._authUrlError = window._authUrlError || error.message;
    }

    sb.auth.onAuthStateChange((event, session) => {
      _session = session;
      if (event === 'SIGNED_IN' && window.App && App._bootApp) {
        document.getElementById('loader') && document.getElementById('loader').classList.remove('hide');
        App._bootApp();
      } else if (event === 'SIGNED_OUT' && window.App) {
        App.showScreen && App.showScreen('scr-signin');
      }
    });

    return !!_session;
  }

  // Open Google OAuth redirect
  async function signIn() {
    const base = window.location.origin + window.location.pathname;
    const { error } = await _client().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: base,
        queryParams: { access_type: 'offline', prompt: 'select_account' }
      }
    });
    if (error) throw new Error(error.message);
  }

  function isSignedIn() {
    return !!_session;
  }

  function getToken() {
    if (!_session) throw new Error('Session expired');
    return _session.access_token;
  }

  function client() {
    return _client();
  }

  async function signOut() {
    _session = null;
    try { localStorage.clear(); } catch (_) {}
    await _client().auth.signOut();
  }

  async function tryAutoSignIn() {
    const { data } = await _client().auth.getSession();
    _session = data.session;
    return _session ? _session.access_token : null;
  }

  window.AUTH = { init, signIn, isSignedIn, getToken, signOut, tryAutoSignIn, client };
})();
