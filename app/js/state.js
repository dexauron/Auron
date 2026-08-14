(() => {
  'use strict';

  // Ядро платформы Auron: состояние, шина событий, права, модули, флаги.
  //
  // Соответствует docs/05-ARCHITECTURE.md — разделу «Пять фундаментальных
  // принципов» и таблице «Что закладываем с первого дня». Эти вещи нельзя
  // добавить потом: шину событий пришлось бы вживлять в готовый код,
  // а права переписывать вместе со всеми экранами.

  // ══════════════════════════════════════════════════════════════════
  // ШИНА СОБЫТИЙ
  // ══════════════════════════════════════════════════════════════════
  // Модули не знают друг о друге. Касса публикует shift.closed —
  // аналитика, уведомления и пульс реагируют сами. Добавить новую
  // реакцию = добавить слушателя, старый код не трогается.

  const _listeners = new Map();

  // Возвращает функцию отписки — её удобно звать при уходе с экрана
  function on(event, handler) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  function off(event, handler) {
    const set = _listeners.get(event);
    if (set) set.delete(handler);
  }

  // Слушатель не должен ронять остальных: ошибку логируем и идём дальше
  function emit(event, payload) {
    const set = _listeners.get(event);
    if (set) {
      for (const handler of [...set]) {
        try { handler(payload, event); }
        catch (e) { console.error('[bus] ' + event + ':', e); }
      }
    }
    // Слушатели с маской: 'shift.*' ловит все события кассы
    const dot = event.indexOf('.');
    if (dot > 0) {
      const wild = _listeners.get(event.slice(0, dot) + '.*');
      if (wild) {
        for (const handler of [...wild]) {
          try { handler(payload, event); }
          catch (e) { console.error('[bus] ' + event + ':', e); }
        }
      }
    }
    // Каждое событие идёт в трекинг — данные для ИИ копятся пассивно
    _track(event, payload);
  }

  // ══════════════════════════════════════════════════════════════════
  // ТРЕКИНГ
  // ══════════════════════════════════════════════════════════════════
  // Копится локально, отправляется пачкой. Событий много, сеть дорогая,
  // поэтому буфер ограничен — старые вытесняются.

  const TRACK_KEY = 'auron_events';
  const TRACK_MAX = 200;

  function _track(name, props) {
    try {
      const buf = JSON.parse(localStorage.getItem(TRACK_KEY) || '[]');
      buf.push({ name, props: props || null, at: Date.now(), screen: _state.screen });
      if (buf.length > TRACK_MAX) buf.splice(0, buf.length - TRACK_MAX);
      localStorage.setItem(TRACK_KEY, JSON.stringify(buf));
    } catch (_) {}
  }

  function takeEvents() {
    try {
      const buf = JSON.parse(localStorage.getItem(TRACK_KEY) || '[]');
      localStorage.removeItem(TRACK_KEY);
      return buf;
    } catch (_) { return []; }
  }

  // ══════════════════════════════════════════════════════════════════
  // СОСТОЯНИЕ
  // ══════════════════════════════════════════════════════════════════

  const _state = {
    org:      null,   // активная организация
    user:     null,   // профиль пользователя
    role:     null,   // роль в текущей организации
    screen:   null,   // какой экран открыт
    online:   typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    lastSync: null,   // когда последний раз получили данные с сервера
    pending:  0       // сколько операций ждёт отправки
  };

  function get(key) { return key ? _state[key] : { ..._state }; }

  // Меняет состояние и сообщает об этом. Событие уходит только если
  // значение реально изменилось — иначе экраны перерисовывались бы впустую.
  function set(patch) {
    const changed = [];
    for (const k of Object.keys(patch)) {
      if (_state[k] !== patch[k]) { _state[k] = patch[k]; changed.push(k); }
    }
    if (changed.length) emit('state.changed', { keys: changed, state: get() });
    return get();
  }

  // ══════════════════════════════════════════════════════════════════
  // ПРАВА
  // ══════════════════════════════════════════════════════════════════
  // Роль — не экран, а именованный набор разрешений. Владелец может
  // собрать свою роль из любого набора; модуль добавляет свои ключи
  // в ту же систему, и роли расширяются автоматически.

  const PERMISSIONS = {
    // Владелец: видит всё, не меняет ничего. Цели — исключение, их он ставит.
    owner: [
      'view_home', 'view_cash', 'view_debts', 'view_staff', 'view_products',
      'view_reports', 'view_analytics', 'manage_access', 'manage_settings',
      'edit_goals', 'approve_corrections'
    ],
    // Бухгалтер: полный доступ к деньгам и людям, кроме управления аккаунтами
    accountant: [
      'view_home', 'view_cash', 'edit_cash', 'view_debts', 'edit_debts',
      'view_staff', 'edit_staff', 'view_products', 'edit_products',
      'view_reports', 'view_analytics', 'edit_goals', 'create_transaction',
      'close_month', 'request_correction'
    ],
    // Администратор: заказы и запись на выплату, но не сами оплаты
    admin: [
      'view_home', 'view_debts', 'create_order', 'schedule_payment',
      'view_products', 'edit_products', 'create_transaction'
    ],
    // Сотрудник зала: товар и поставки, никаких денег
    staff: ['view_home', 'view_products', 'view_deliveries']
  };

  function can(permission) {
    const role = _state.role;
    if (!role) return false;
    const list = PERMISSIONS[role];
    return !!list && list.indexOf(permission) !== -1;
  }

  function permissionsOf(role) { return (PERMISSIONS[role] || []).slice(); }

  // Владелец создаёт свои роли поверх системных: «Старший администратор»
  // = набор нужных ключей. Реестр расширяется, экраны не трогаются.
  function defineRole(name, permissions) {
    PERMISSIONS[name] = permissions.slice();
    emit('role.defined', { name });
  }

  // ══════════════════════════════════════════════════════════════════
  // МОДУЛИ
  // ══════════════════════════════════════════════════════════════════
  // Новый модуль = запись в реестре, а не правка существующего кода.
  // Магазину без сотрудников модуль Персонала просто выключен.

  const _modules = new Map();

  function registerModule(def) {
    if (!def || !def.key) throw new Error('У модуля должен быть key');
    _modules.set(def.key, {
      key:      def.key,
      title:    def.title || def.key,
      icon:     def.icon || null,
      // какое право нужно, чтобы вкладка вообще появилась
      requires: def.requires || null,
      // порядок в навигации: чем меньше, тем левее
      order:    def.order != null ? def.order : 100,
      render:   def.render || null,
      enabled:  def.enabled !== false
    });
    emit('module.registered', { key: def.key });
  }

  function getModule(key) { return _modules.get(key) || null; }

  // Навигация собирается из активных модулей, а не задана списком.
  // Показываем только то, на что у роли есть право.
  function navItems() {
    return [..._modules.values()]
      .filter(m => m.enabled && (!m.requires || can(m.requires)))
      .sort((a, b) => a.order - b.order);
  }

  // На телефоне в панели максимум 5 вкладок: четыре первые и «Ещё»,
  // куда сложено остальное. На широком экране ограничения нет.
  function navLayout(isWide) {
    const items = navItems();
    if (isWide || items.length <= 5) return { tabs: items, more: [] };
    return { tabs: items.slice(0, 4), more: items.slice(4) };
  }

  function setModuleEnabled(key, enabled) {
    const m = _modules.get(key);
    if (!m) return false;
    m.enabled = !!enabled;
    emit('module.toggled', { key, enabled: m.enabled });
    return true;
  }

  // ══════════════════════════════════════════════════════════════════
  // ФЛАГИ ФУНКЦИЙ
  // ══════════════════════════════════════════════════════════════════
  // Включить функцию отдельному человеку без выкатки новой версии.

  const _flags = new Map();

  function setFlag(key, value) {
    _flags.set(key, !!value);
    try {
      const all = JSON.parse(localStorage.getItem('auron_flags') || '{}');
      all[key] = !!value;
      localStorage.setItem('auron_flags', JSON.stringify(all));
    } catch (_) {}
    emit('flag.changed', { key, value: !!value });
  }

  function flag(key, fallback) {
    if (_flags.has(key)) return _flags.get(key);
    return fallback !== undefined ? fallback : false;
  }

  function _loadFlags() {
    try {
      const all = JSON.parse(localStorage.getItem('auron_flags') || '{}');
      for (const k of Object.keys(all)) _flags.set(k, !!all[k]);
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════
  // СВЯЗЬ
  // ══════════════════════════════════════════════════════════════════
  // Экраны показывают «Нет соединения. Данные на 14:32» — время берётся
  // из отметки, которую ставит api.js после каждого удачного запроса.

  function _syncOnline() {
    const online = navigator.onLine !== false;
    if (online !== _state.online) {
      set({ online });
      emit(online ? 'net.online' : 'net.offline', null);
    }
  }

  function lastSyncLabel() {
    let ts = _state.lastSync;
    if (!ts) { try { ts = Number(localStorage.getItem('auron_last_sync')) || null; } catch (_) {} }
    if (!ts) return null;
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function init() {
    _loadFlags();
    if (typeof window !== 'undefined') {
      window.addEventListener('online',  _syncOnline);
      window.addEventListener('offline', _syncOnline);
    }
    emit('app.ready', null);
  }

  window.STATE = {
    // шина
    on, off, emit,
    // состояние
    get, set, init,
    // права
    can, permissionsOf, defineRole,
    // модули
    registerModule, getModule, navItems, navLayout, setModuleEnabled,
    // флаги
    flag, setFlag,
    // связь и трекинг
    lastSyncLabel, takeEvents
  };
})();
