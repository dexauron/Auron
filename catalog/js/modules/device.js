// Настройки этого устройства

import { $, CACHE_KEY, state } from './store.js';
import { esc, openSheet, toast } from './core.js';
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

function deviceName() {
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
  box.innerHTML = deviceMemory().map((r) => `<div class="dev-row">
    <span class="dev-key">${esc(r.name)}</span><span class="dev-val">${esc(r.val)}</span></div>`).join('');
  $('devName').value = deviceName();
  // вход/выход прямо здесь: до этого экрана сотрудник доходит, ещё не войдя
  $('devAuth').innerHTML = state.session
    ? '<button type="button" class="btn btn-ghost btn-block" id="devLogout">Выйти из аккаунта на этом устройстве</button>'
    : '<button type="button" class="btn btn-primary btn-block" id="devLogin">Войти</button>';
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
