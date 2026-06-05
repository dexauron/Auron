(() => {
  'use strict';

  let _sb   = null;
  let _session = null;

  function _client() {
    if (!_sb) _sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return _sb;
  }

  // Called once from App.init() — resolves true if already signed in
  async function init() {
    const sb = _client();
    const { data } = await sb.auth.getSession();
    _session = data.session;

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

  // Open Google OAuth popup/redirect
  async function signIn() {
    const { error } = await _client().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href.split('#')[0],
        queryParams: { access_type: 'offline', prompt: 'select_account' }
      }
    });
    if (error) throw new Error(error.message);
  }

  function isSignedIn() {
    return !!_session;
  }

  // Returns Supabase access token (used by api.js for RLS)
  function getToken() {
    if (!_session) throw new Error('Session expired');
    return _session.access_token;
  }

  // Returns the current Supabase client (for api.js)
  function client() {
    return _client();
  }

  async function signOut() {
    _session = null;
    try { localStorage.clear(); } catch (_) {}
    await _client().auth.signOut();
  }

  // tryAutoSignIn — with Supabase, session persists automatically (no action needed)
  async function tryAutoSignIn() {
    const { data } = await _client().auth.getSession();
    _session = data.session;
    return _session ? _session.access_token : null;
  }

  window.AUTH = { init, signIn, isSignedIn, getToken, signOut, tryAutoSignIn, client };
})();
