// Настройки этого устройства

import { $, CACHE_KEY, state } from './store.js';
import { esc, openSheet, savedErrors, toast } from './core.js';
import { todayISO } from './catalog.js';
import { THEME_KEY, applyTheme, countActiveFilters, favorites, renderAll } from './render.js';
import { GH_TOKEN_KEY, SV_AUTH_KEY, ghToken } from './publish.js';
import { plural } from './competitors.js';

/* ── Настройки этого устройства ─────────────────────
 * Каталог живёт на десятках телефонов: у кассы, у сотрудников зала, у
 * владельца. Настройки у каждого свои и хранятся только на самом устройстве —
 * ничего не улетает на сервер и не мешает соседнему телефону. Экран нужен,
 * чтобы это перестало быть невидимым: видно, что запомнено, и как сбросить. */

export const DEV_NAME_KEY = 'wm_device_name';

/* ── Экономный режим для слабых телефонов ──────────────────────────────────
 * Красота интерфейса держится на «матовом стекле»: размытие под шапкой и под
 * окнами. На iPhone это делает видеочип и не стоит ничего. На бюджетном
 * Android каждое такое размытие пересчитывается КАЖДЫЙ КАДР — отсюда рывки
 * при прокрутке и «дёрганое» открытие окон.
 * Поэтому на слабых телефонах размытие выключается: фон просто затемняется.
 * Как определяем «слабый»: телефон сам сообщает объём памяти и число ядер.
 * iPhone таких сведений не даёт — там всё остаётся как было. */
function isLowPower() {
  try {
    // Объём памяти телефон сообщает сам (Chrome на Android). 4 ГБ и меньше —
    // это и есть бюджетный телефон, на котором «стекло» дороже, чем красивее.
    // Число ядер как признак не берём: оно врёт даже на хороших телефонах.
    const mem = navigator.deviceMemory;
    return typeof mem === 'number' && mem <= 4;
  } catch (e) { return false; }
}

/* ── «Поставить на главный экран» ───────────────────────────────────────────
 * Каталог открывают ссылкой в браузере. Поставленный на главный экран, он
 * запускается заметно быстрее (без адресной строки и вкладок браузера), лучше
 * держит офлайн-копию и получает быстрые действия по долгому нажатию на значок.
 * Подсказку показываем один раз и тихо: закрыл — больше не появится. */
const INSTALL_KEY = 'wm_install_hint';
let installEvent = null;

const installed = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  } catch (e) { return false; }
};
const hintHidden = () => { try { return localStorage.getItem(INSTALL_KEY) === 'off'; } catch (e) { return true; } };
const hideHint = () => {
  try { localStorage.setItem(INSTALL_KEY, 'off'); } catch (e) { /* приватный режим */ }
  const el = $('installBanner'); if (el) el.hidden = true;
};

export function watchInstall() {
  const banner = $('installBanner');
  if (!banner) return;
  $('installHide').addEventListener('click', hideHint);
  $('installGo').addEventListener('click', async () => {
    if (!installEvent) return;
    banner.hidden = true;
    try { installEvent.prompt(); await installEvent.userChoice; } catch (e) { /* передумал */ }
    installEvent = null;
    hideHint();
  });
  window.addEventListener('appinstalled', hideHint);

  // Android: браузер сам предлагает установку — показываем свою кнопку
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    if (installed() || hintHidden()) return;
    $('installText').textContent = 'Поставь каталог на главный экран — открывается быстрее и работает без интернета';
    $('installGo').hidden = false;
    banner.hidden = false;
  });

  // iPhone: своего предложения нет, поэтому один раз подсказываем словами
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (iOS && !installed() && !hintHidden()) {
    $('installText').textContent = 'Чтобы каталог открывался быстрее: «Поделиться» → «На экран «Домой»';
    banner.hidden = false;
  }
}

export function applyPowerMode() {
  try { document.documentElement.classList.toggle('low-power', isLowPower()); } catch (e) { /* некритично */ }
}

export function deviceName() {
  try { return localStorage.getItem(DEV_NAME_KEY) || ''; } catch (e) { return ''; }
}

// Что именно телефон помнит. Ключ → человеческое имя и краткое значение.
function deviceMemory() {
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const viewName = { normal: 'плитки', compact: 'плотные плитки', list: 'список' }[state.view] || state.view;
  const tabName = { catalog: 'Каталог', cats: 'Категории', fav: 'Избранное' }[state.tab] || state.tab;
  const themeRaw = get(THEME_KEY);
  const rows = [
    { name: 'Вход', val: state.session ? (state.isAdmin ? 'владелец' : 'сотрудник') : 'не выполнен' },
    { name: 'Экономный режим', val: isLowPower() ? 'включён — телефон послабее, размытие выключено' : 'не нужен' },
    { name: 'Вид списка', val: viewName },
    { name: 'Открытый раздел', val: tabName },
    { name: 'Тема', val: themeRaw === 'dark' ? 'тёмная' : themeRaw === 'light' ? 'светлая' : 'как в телефоне' },
    { name: 'Избранное', val: `${favorites().length} ${plural(favorites().length, 'товар', 'товара', 'товаров')}` },
    { name: 'Фильтры', val: countActiveFilters() ? `включено ${countActiveFilters()}` : 'не заданы' },
    { name: 'Каталог для работы без связи', val: get(CACHE_KEY) || get('wm_catalog_db') ? 'сохранён' : 'нет' },
  ];
  if (ghToken()) rows.push({ name: 'Ключ публикации', val: 'сохранён на этом устройстве' });
  return rows;
}

function renderDeviceSheet() {
  const box = $('devList');
  if (!box) return;
  box.innerHTML = deviceMemory().map((r) => `<div class="ios-row">
    <span class="ios-row-title">${esc(r.name)}</span><span class="ios-row-value">${esc(r.val)}</span></div>`).join('');
  $('devName').value = deviceName();
  // Последние сбои — здесь, а не в тайной консоли: если каталог однажды повёл
  // себя странно, владелец видит, что именно случилось, и может это назвать.
  const errs = savedErrors();
  $('devErrors').innerHTML = errs.length
    ? errs.slice(0, 5).map((e) => `<div class="ios-row"><span class="ios-row-title">${esc(e.msg)}
        <span class="ord-sub">${esc(String(e.at).slice(0, 16).replace('T', ' '))} · ${esc(e.where)}</span></span></div>`).join('')
    : '<div class="ios-row"><span class="ios-row-title muted">Сбоев не было</span></div>';
  // вход/выход прямо здесь: до этого экрана сотрудник доходит, ещё не войдя
  $('devAuth').innerHTML = state.session
    ? '<button type="button" class="ios-row ios-row-danger" id="devLogout"><span class="ios-row-title">Выйти из аккаунта</span></button>'
    : '<button type="button" class="ios-row ios-row-action" id="devLogin"><span class="ios-row-title">Войти</span></button>';
}

export function openDeviceSheet() { renderDeviceSheet(); openSheet('deviceSheet'); }

// Сброс: чистим только СВОИ ключи и только настройки — сохранённый каталог и
// ключ публикации не трогаем, иначе сотрудник останется без данных офлайн,
// а владелец потеряет доступ к публикации из-за случайного нажатия.
export function resetDevice() {
  const keep = new Set([GH_TOKEN_KEY, CACHE_KEY, 'wm_catalog_db', SV_AUTH_KEY]);
  let removed = 0;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('wm_') && !keep.has(k)) { localStorage.removeItem(k); removed++; }
    }
  } catch (e) { /* приватный режим */ }
  state.selCats = []; state.selGroups = []; state.selSuppliers = []; state.quick = [];
  state.priceMin = null; state.priceMax = null; state.selType = '';
  state.arrivalFrom = ''; state.arrivalTo = '';
  state.sort = 'relevance'; state.view = 'normal'; state.tab = 'catalog'; state.favOnly = false;
  state.query = ''; $('searchInput').value = '';
  applyTheme(null);
  renderAll();
  renderDeviceSheet();
  toast(`Настройки сброшены (${removed})`);
}

export const popViews = (id) => state.popularity[id] || 0;

// защита от накрутки: один просмотр/запрос за товар (запрос) в день с устройства
const TRACK_KEY = 'wm_tracked_v1';
function trackedToday() {
  try {
    const o = JSON.parse(localStorage.getItem(TRACK_KEY));
    if (o && o.d === todayISO()) return o;
  } catch (e) { /* */ }
  return { d: todayISO(), v: {}, s: {} };
}
function saveTracked(o) { try { localStorage.setItem(TRACK_KEY, JSON.stringify(o)); } catch (e) { /* */ } }

export function trackView(p) {
  if (!p) return;
  const o = trackedToday();
  if (o.v[p.id]) return;      // сегодня уже считали — не накручиваем
  o.v[p.id] = 1; saveTracked(o);
  state.popularity[p.id] = popViews(p.id) + 1; // оптимистично — «Популярное» живое сразу
}
export function trackSearch(q) {
  if (!q) return;
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return;
  const o = trackedToday();
  if (o.s[q]) return;
  o.s[q] = 1; saveTracked(o);
}

// загрузка счётчиков популярности (не критично: если ОБНОВЛЕНИЕ-16 не выполнено —
// просто нет «Популярного», приложение работает как обычно)

// «Популярное» — горизонтальная лента самых просматриваемых товаров (главная)
