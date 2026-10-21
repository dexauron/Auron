// Auron — очередь офлайн-операций (путь A).
// Операции, введённые без сети, копятся здесь и досылаются при восстановлении связи.
// Идемпотентность — по client_uuid: сервер (и эта очередь) отсекают дубликаты.
// Хранилище — localStorage: переживает перезагрузку и закрытие приложения.
(() => {
  'use strict';

  const KEY = 'auron_offline_queue';
  const listeners = [];
  let _flushing = false;

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (_) { return []; }
  }
  function _save(q) {
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch (_) {}
    _emit();
  }
  function _emit() {
    const n = pendingCount();
    listeners.forEach(fn => { try { fn(n); } catch (_) {} });
  }

  // op: { table, method, path, body, client_uuid }
  function enqueue(op) {
    const q = _load();
    // дубликат по client_uuid не добавляем (защита от двойного нажатия)
    if (op.client_uuid && q.some(o => o.client_uuid === op.client_uuid)) return;
    q.push(Object.assign({}, op, { status: 'pending', created_at_local: Date.now() }));
    _save(q);
  }

  function pending()      { return _load().filter(o => o.status !== 'synced'); }
  function pendingCount() { return pending().length; }
  function clearFailed()  { _save(_load().filter(o => o.status !== 'failed')); }
  function onChange(fn)   { if (typeof fn === 'function') { listeners.push(fn); fn(pendingCount()); } }

  function _isNetworkError(e) {
    return /нет соединения|failed to fetch|networkerror|offline/i.test(String(e && e.message || e));
  }

  // sender(op) => Promise. Успех = операция принята; бросок = ошибка.
  // Порядок сохраняется (FIFO). Пропадёт сеть — останавливаемся, остальное ждёт.
  // Реальная (не сетевая) ошибка — помечаем failed и идём дальше, не теряя запись.
  async function flush(sender) {
    if (_flushing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (typeof sender !== 'function') return;
    _flushing = true;
    try {
      const q = _load();
      const remaining = [];
      let stop = false;
      for (const op of q) {
        if (op.status === 'synced') continue;
        if (stop) { remaining.push(op); continue; }
        try {
          await sender(op);                 // успех → операция уходит из очереди
        } catch (e) {
          if (_isNetworkError(e)) {          // сеть снова пропала — стоп, ждём следующего раза
            remaining.push(Object.assign({}, op, { status: 'pending' }));
            stop = true;
          } else {                           // реальная ошибка — не теряем, помечаем и продолжаем
            remaining.push(Object.assign({}, op, { status: 'failed', error: String(e && e.message || e) }));
          }
        }
      }
      _save(remaining);
    } finally {
      _flushing = false;
      _emit();
    }
  }

  const OfflineQueue = { enqueue, flush, pending, pendingCount, clearFailed, onChange };

  if (typeof window !== 'undefined')       window.OfflineQueue = OfflineQueue;
  if (typeof module !== 'undefined' && module.exports) module.exports = OfflineQueue; // для юнит-теста
})();
