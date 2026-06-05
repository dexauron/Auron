(() => {
  'use strict';

  let _sb      = null;
  let _session = null;

  function _client() {
    if (!_sb) {
      const url = window.SUPABASE_PROXY_URL || window.SUPABASE_URL;
      _sb = window.supabase.createClient(url, window.SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
    }
    return _sb;
  }

  async function init() {
    const sb = _client();
    const { data } = await sb.auth.getSession();
    _session = data.session;

    sb.auth.onAuthStateChange((event, session) => {
      _session = session;
      if (event === 'SIGNED_IN' && window.App && App._bootApp) {
        const loader = document.getElementById('loader');
        if (loader) loader.classList.remove('hide');
        App._bootApp();
      } else if (event === 'SIGNED_OUT' && window.App) {
        App.showScreen && App.showScreen('scr-signin');
      }
    });

    return !!_session;
  }

  // Email + пароль — работает без VPN в РФ
  async function signInEmail(email, password) {
    const { data, error } = await _client().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    _session = data.session;
    return data;
  }

  async function signUpEmail(email, password) {
    const { data, error } = await _client().auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return data;
  }

  async function resetPassword(email) {
    const { error } = await _client().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('#')[0]
    });
    if (error) throw new Error(error.message);
  }

  function isSignedIn() { return !!_session; }

  function getToken() {
    if (!_session) throw new Error('Session expired');
    return _session.access_token;
  }

  function client() { return _client(); }

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

  window.AUTH = { init, signInEmail, signUpEmail, resetPassword, isSignedIn, getToken, signOut, tryAutoSignIn, client };
})();
