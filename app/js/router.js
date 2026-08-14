(() => {
  'use strict';

  // SPA-навигация между вкладками.
  //
  // Экраны берутся из реестра модулей (state.js), а не заданы списком:
  // новый модуль появляется в навигации сам, роутер не правится.
  //
  // Адрес живёт в hash: #/kassa, #/suppliers/ivanov. Это нужно для
  // глубоких ссылок из 05-ARCHITECTURE — по ссылке из WhatsApp или с QR
  // открывается нужный экран, а не главная.

  let _root      = null;   // куда рисуем
  let _current   = null;   // ключ открытого модуля
  let _cleanup   = null;   // что позвать при уходе с экрана
  let _fallback  = 'home';

  // ── Разбор адреса ───────────────────────────────────────────────────
  // '#/suppliers/ivanov?tab=orders' → { key:'suppliers', params:['ivanov'], query:{tab:'orders'} }
  function parse(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const [path, search] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const query = {};
    if (search) {
      for (const [k, v] of new URLSearchParams(search)) query[k] = v;
    }
    return { key: parts[0] || _fallback, params: parts.slice(1), query };
  }

  function current() { return _current; }

  // ── Переход ─────────────────────────────────────────────────────────

  function go(key, params, query) {
    let hash = '#/' + key;
    if (params && params.length) hash += '/' + params.join('/');
    if (query && Object.keys(query).length) hash += '?' + new URLSearchParams(query).toString();
    if (location.hash === hash) { _render(parse(hash)); return; }
    location.hash = hash;   // дальше сработает hashchange
  }

  function back() { history.back(); }

  async function _render(route) {
    if (!_root) return;

    const mod = STATE.getModule(route.key);

    // Неизвестный адрес — не показываем пустоту, уводим на главную
    if (!mod) { go(_fallback); return; }

    // Модуль выключен в настройках магазина
    if (!mod.enabled) { _renderNotice('Раздел выключен', 'Включить его можно в настройках магазина.'); return; }

    // Нет права — честно говорим, а не притворяемся, что раздела нет
    if (mod.requires && !STATE.can(mod.requires)) {
      _renderNotice('Нет доступа', 'Этот раздел доступен другой роли. Обратитесь к владельцу.');
      return;
    }

    // Уходя с экрана, снимаем его подписки — иначе они копятся
    if (typeof _cleanup === 'function') {
      try { _cleanup(); } catch (e) { console.error('[router] cleanup:', e); }
      _cleanup = null;
    }

    _current = route.key;
    STATE.set({ screen: route.key });
    STATE.emit('route.changed', route);

    if (typeof mod.render !== 'function') {
      _renderNotice(mod.title, 'Этот раздел ещё не готов.');
      return;
    }

    // Пока модуль грузит данные — скелетон, но только при первом заходе.
    // Дальше работает оптимистичный UI и мигать нечем.
    _root.innerHTML = '';
    _root.setAttribute('data-screen', route.key);

    try {
      const result = await mod.render(_root, route);
      // Модуль может вернуть функцию — её позовём при уходе
      if (typeof result === 'function') _cleanup = result;
    } catch (e) {
      console.error('[router] ' + route.key + ':', e);
      _renderError(e);
    }
  }

  // ── Служебные состояния ─────────────────────────────────────────────
  // Пустой экран без объяснения запрещён дизайн-системой,
  // поэтому у каждого состояния есть текст и действие.

  function _renderNotice(title, text) {
    _root.innerHTML =
      '<div class="screen-notice">' +
        '<h2></h2><p></p>' +
        '<button type="button" data-go-home>На главную</button>' +
      '</div>';
    _root.querySelector('h2').textContent = title;
    _root.querySelector('p').textContent  = text;
    _root.querySelector('[data-go-home]').onclick = () => go(_fallback);
  }

  function _renderError(err) {
    // Пользователю — человеческое объяснение, без кодов и стектрейсов
    const offline = !STATE.get('online');
    const text = offline
      ? 'Нет соединения. Показываем то, что успели загрузить.'
      : (err && err.message) || 'Что-то пошло не так.';

    _root.innerHTML =
      '<div class="screen-error">' +
        '<p></p>' +
        '<button type="button" data-retry>Попробовать снова</button>' +
      '</div>';
    _root.querySelector('p').textContent = text;
    _root.querySelector('[data-retry]').onclick = () => _render(parse(location.hash));
  }

  // ── Запуск ──────────────────────────────────────────────────────────

  function start(rootEl, opts) {
    _root = typeof rootEl === 'string' ? document.getElementById(rootEl) : rootEl;
    if (!_root) throw new Error('Роутер не нашёл контейнер для экранов');
    if (opts && opts.fallback) _fallback = opts.fallback;

    window.addEventListener('hashchange', () => _render(parse(location.hash)));

    // Смена магазина перерисовывает текущий экран: данные-то другие
    STATE.on('org.changed', () => _render(parse(location.hash)));

    _render(parse(location.hash || '#/' + _fallback));
  }

  window.ROUTER = { start, go, back, current, parse };
})();
