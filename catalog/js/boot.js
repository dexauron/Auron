// Запускается до модулей: даже сломанная прежняя оболочка должна получить
// обновление и дать человеку восстановить приложение без удаления его данных.
(function () {
  'use strict';
  let started = false, ready = false, reloading = false;
  const recovery = document.body.hasAttribute('data-recovery');
  const notice = document.getElementById('startupNotice');
  const message = document.getElementById('startupMessage');
  const button = document.getElementById('startupReload');
  const show = (text) => {
    if (!notice || !message) return;
    message.textContent = text;
    notice.hidden = false;
  };
  const timer = setTimeout(() => {
    if (!ready && !recovery) show('Каталог загружается дольше обычного. Проверь интернет. Если загрузка не продолжается, обнови приложение.');
  }, 12000);
  window.addEventListener('wm:started', () => { started = true; }, { once: true });
  window.addEventListener('wm:ready', () => {
    ready = true; clearTimeout(timer);
    if (notice) notice.hidden = true;
  }, { once: true });
  window.addEventListener('error', (e) => {
    if (!started && (e.error || (e.target && e.target.tagName === 'SCRIPT'))) {
      show('Не удалось запустить каталог. Проверь интернет и обнови приложение. Сохранённые товары и настройки останутся на устройстве.');
    }
  }, true);
  window.addEventListener('unhandledrejection', () => {
    if (!started) show('Не удалось запустить каталог. Обнови приложение и попробуй снова.');
  });

  if (button) button.addEventListener('click', async () => {
    if (!navigator.onLine) { show('Для обновления приложения нужен интернет. Сохранённые данные остаются на устройстве.'); return; }
    button.disabled = true;
    show('Обновляю приложение…');
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.scope === new URL('./', location.href).href) { await reg.update(); await reg.unregister(); }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('wm-catalog-v')).map((key) => caches.delete(key)));
      }
      const url = new URL(location.href);
      url.searchParams.set('wm-reload', String(Date.now()));
      location.replace(url.href);
    } catch (e) {
      button.disabled = false;
      show('Обновление не загрузилось. Проверь интернет и попробуй ещё раз.');
    }
  });

  if (!recovery && 'serviceWorker' in navigator) {
    const controlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Работающий каталог сам учитывает открытые формы. Если модули вообще
      // не запустились, обновление должно вывести страницу из этого состояния.
      if (controlled && !started && !reloading) { reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    }).catch(() => { /* без сети работает установленная копия */ });
  }
})();
