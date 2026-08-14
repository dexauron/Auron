/* Каталог товаров — service worker.
 * Стратегия «сначала сеть»: онлайн всегда свежая версия (версии кэша бампать
 * не нужно), офлайн — последняя сохранённая копия приложения. */
const CACHE = 'wm-catalog-v80';
// Отдельный «вечный» кэш для фото товаров: заполняется по мере просмотра,
// НЕ очищается при обновлении приложения — фото грузятся один раз и потом
// показываются мгновенно, работают офлайн и не тратят трафик.
const PHOTOS = 'wm-photos-v1';
// Куски каталога. В адресе куска стоит подпись его содержимого, поэтому
// сохранённый кусок никогда не «протухает»: изменился — придёт другой адрес.
// Кэш тоже переживает обновление приложения, иначе после каждой версии люди
// заново качали бы весь каталог.
const DATA = 'wm-data-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'js/modules/app.js',
  'js/modules/store.js', 'js/modules/core.js', 'js/modules/icons.js', 'js/modules/catalog.js', 'js/modules/render.js', 'js/modules/device.js', 'js/modules/card.js', 'js/modules/data.js', 'js/modules/brand.js', 'js/modules/parts.js', 'js/modules/publish.js', 'js/modules/competitors.js', 'js/modules/photos.js', 'js/modules/admin.js', 'js/modules/imports.js', 'js/modules/scanner.js', 'js/config.js',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/logo-round.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // чистим старые версии оболочки, но кэш фото и кусков каталога не трогаем
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTOS && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// фото товара? (картинка из Storage Supabase — всегда другой домен).
// Иконки самого приложения (свой домен) сюда не попадают — они в оболочке
// с «сначала сеть», чтобы обновлялись при выходе новой версии.
function isPhoto(url, req) {
  if (url.origin === self.location.origin) return false;
  return url.pathname.includes('/storage/v1/object/') || req.destination === 'image';
}

// кусок каталога? В адресе есть подпись содержимого (?h=…), значит по этому
// адресу лежит ровно одно неизменное содержимое — можно смело брать из кэша.
function isDataPart(url) {
  return url.searchParams.has('h') && /(\/p\/\d+\.json|\.enc)$/.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // куски каталога — «сначала кэш»: тот же адрес = то же содержимое.
  // После мелкой правки заново качается только изменившийся кусок.
  if (isDataPart(url)) {
    e.respondWith(caches.open(DATA).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const resp = await fetch(e.request);
      if (resp.ok) {
        c.put(e.request, resp.clone());
        // прежние версии этого же куска больше не нужны
        for (const k of await c.keys()) {
          const u = new URL(k.url);
          if (u.pathname === url.pathname && u.search !== url.search) c.delete(k);
        }
      }
      return resp;
    }).catch(() => fetch(e.request)));
    return;
  }

  // фото товаров (в т.ч. с другого домена) — «сначала кэш»: один раз скачали,
  // дальше показываем мгновенно и офлайн, фото держится постоянно
  if (isPhoto(url, e.request)) {
    e.respondWith(
      caches.open(PHOTOS).then((c) => c.match(e.request).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((resp) => {
          if (resp.ok || resp.type === 'opaque') c.put(e.request, resp.clone());
          return resp;
        });
      })),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  // Оболочку приложения (страница, скрипты, стили) тянем МИМО обычного кэша
  // браузера: GitHub Pages отдаёт их с запасом на несколько минут, и без этого
  // «сначала сеть» могло вернуть старый файл — у людей оставалась прежняя версия.
  const isShell = e.request.mode === 'navigate'
    || /\.(html|js|css|webmanifest)$/i.test(url.pathname);
  const req = isShell ? new Request(e.request, { cache: 'reload' }) : e.request;
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),   // нет сети — из офлайн-копии
  );
});
