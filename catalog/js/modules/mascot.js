// Волк — талисман магазина и живой помощник каталога

/* У магазина есть свой волк в папахе и черкеске. До сих пор он жил только
 * картинкой в переписке; здесь он выходит в каталог и делает три вещи:
 * здоровается, подсказывает на пустых экранах и радуется, когда человек
 * что-то отметил. Это не украшение ради украшения: каталог без сервера
 * ничем не может напомнить о себе, и единственное, что заставляет вернуться, —
 * ощущение, что здесь тебе рады.
 *
 * Три правила, чтобы он не надоел:
 *   1) здоровается один раз в день, а не при каждом открытии;
 *   2) говорит не чаще раза в 2,5 секунды — иначе получается болтовня;
 *   3) в рабочих окнах (заказы, «закончилось», пересчёт) его нет вовсе:
 *      там человек работает, а не развлекается.
 * Выключается одним переключателем в настройках устройства. */

import { $, CFG, state, ui } from './store.js';
import { esc, toast } from './core.js';

const OFF_KEY = 'wm_wolf';       // 'off' — человек выключил волка
const HI_KEY = 'wm_wolf_hi';     // день, когда здоровались в последний раз
/* «Волк в меру» (слова владельца): реплика не чаще раза в шесть секунд.
 * Всё, что не влезло в этот промежуток, уходит обычным сообщением внизу —
 * человек ничего не теряет, а волк не превращается в болтуна. */
const SAY_GAP = 6000;            // мин. промежуток между репликами, мс
const SHOW_MS = 2800;            // сколько висит облачко

let lastSay = 0;
let hideTimer = 0;

export const mascotOn = () => {
  try { return localStorage.getItem(OFF_KEY) !== 'off'; } catch (e) { return true; }
};

function setMascot(on) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, 'off');
  } catch (e) { /* приватный режим */ }
  applyMascot();
}

function applyMascot() {
  const on = mascotOn();
  try { document.documentElement.classList.toggle('no-wolf', !on); } catch (e) { /* */ }
  if (!on) hideBubble();
}

/* ── Облачко с репликой ──────────────────────────────────────────────────
 * Держится не внутри шапки, а поверх страницы: шапка «липкая» и обрезала бы
 * облачко, а считать его место по шапке — надёжно, она всегда на виду. */
function hideBubble() {
  const b = $('wolfBubble');
  if (!b) return;
  b.classList.remove('show');
  b.hidden = true;
  clearTimeout(hideTimer);
}

function placeBubble(b, anchor) {
  const r = anchor.getBoundingClientRect();
  // висит под ВСЕЙ шапкой, а не под самим волком: иначе облачко ложится
  // прямо на строку поиска и закрывает то, ради чего человек сюда пришёл
  const head = document.querySelector('.header');
  const bottom = head ? head.getBoundingClientRect().bottom : r.bottom;
  const pad = 10;
  b.style.visibility = 'hidden';
  b.hidden = false;
  const w = b.offsetWidth;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  b.style.left = Math.round(left) + 'px';
  b.style.top = Math.round(bottom + 8) + 'px';
  // хвостик облачка смотрит на волка, где бы облачко ни оказалось
  const arrow = Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14));
  b.style.setProperty('--wolf-arrow', Math.round(arrow) + 'px');
  b.style.visibility = '';
}

/* Волк что-то говорит. Если его выключили или он сейчас не на экране,
 * реплика не пропадает — она превращается в обычное сообщение внизу. */
export function wolfSay(text, opts) {
  const o = opts || {};
  const b = $('wolfBubble');
  const anchor = $('wolfHi');
  const visible = mascotOn() && anchor && anchor.offsetParent !== null;
  if (!b || !visible) { if (!o.quiet) toast(text); return; }
  const now = Date.now();
  if (!o.force && now - lastSay < SAY_GAP) { if (!o.quiet) toast(text); return; }
  lastSay = now;
  b.innerHTML = esc(text);
  placeBubble(b, anchor);
  // класс вешаем следующим кадром — иначе появление не анимируется
  requestAnimationFrame(() => b.classList.add('show'));
  hop();
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, o.ms || SHOW_MS);
}

// Короткий подскок: волк заметил, что его нажали или что-то произошло
function hop() {
  const img = document.querySelector('#wolfHi .wolf');
  if (!img || !mascotOn()) return;
  img.classList.remove('hop');
  void img.offsetWidth;      // перезапуск анимации
  img.classList.add('hop');
}

// Лёгкий отклик телефона на важное подтверждение. iPhone его игнорирует —
// там отклик даёт сама система; Android отзывается коротким щелчком.
export function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* необязательно */ }
}

/* ── Пустой экран ────────────────────────────────────────────────────────
 * Пустая страница — самое обидное место: человек чего-то хотел и не получил.
 * Волк превращает её из тупика в разговор. Значок остаётся рядом в разметке:
 * если волка выключили, он и покажется вместо картинки. */
export function wolfEmpty(iconHtml) {
  return `<img class="wolf wolf-empty" src="icons/wolf.png" width="150" height="305" alt="" decoding="async" loading="lazy">`
    + `<span class="wolf-fallback">${iconHtml}</span>`;
}

/* ── Приветствие ─────────────────────────────────────────────────────────
 * Раз в день, при первом открытии. Магазин работает круглосуточно, поэтому
 * «доброй ночи» здесь не шутка — ночью в каталог заходят. */
function partOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'Доброе утро';
  if (h >= 11 && h < 17) return 'Добрый день';
  if (h >= 17 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

function greetedToday() {
  try {
    const d = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(HI_KEY) === d) return true;
    localStorage.setItem(HI_KEY, d);
    return false;
  } catch (e) { return true; }   // не можем запомнить — лучше промолчать
}

export function greet(force) {
  if (!mascotOn()) return;
  if (!force && greetedToday()) return;
  const hi = partOfDay();
  const text = state.session
    ? `${hi}! Хорошей смены`
    : `${hi}! Ищи по названию, коду или сканируй штрихкод`;
  wolfSay(text, { force: true, ms: 3600, quiet: true });
}

/* Тап по волку. Первый раз — здоровается, дальше говорит что-нибудь полезное
 * про сам каталог. Подсказки короткие и по делу: это не гадание, а помощь. */
const TIPS_GUEST = [
  'Нажми на товар — покажу цену и когда его привезли',
  'Отмечай товары в список покупок — посчитаю сумму',
  'Нет в наличии? Нажми «сообщить, когда появится»',
  'Штрихкод с упаковки можно отсканировать камерой',
  'Видел дешевле в другом магазине? Скажи нам — проверим',
];

// адрес и часы — из настроек магазина, а не зашиты в волка:
// каталог рассчитан на любой магазин, а не только на наш
function whereTip() {
  const addr = CFG.STORE_ADDRESS || '';
  const hours = CFG.STORE_HOURS || '';
  if (!addr && !hours) return '';
  return ['Мы ' + (addr ? 'здесь: ' + addr : 'ждём вас'), hours].filter(Boolean).join('. ');
}
const TIPS_STAFF = [
  'Товар кончился на полке — отметь, попадёт в заказ',
  'Заказы поставщикам — во вкладке «Работа»',
  'Сканер в шапке ищет товар по штрихкоду',
  'Не забудь опубликовать витрину после изменений',
];

let tipNo = 0;
function wolfTap() {
  buzz(6);
  const where = whereTip();
  const tips = state.session ? TIPS_STAFF : (where ? [...TIPS_GUEST, where] : TIPS_GUEST);
  wolfSay(tips[tipNo++ % tips.length], { force: true });
}

export function bindMascot() {
  applyMascot();
  ui.hideWolf = hideBubble;   // окна прячут облачко, не зная про этот модуль
  const btn = $('wolfHi');
  if (btn) btn.addEventListener('click', wolfTap);
  // облачко закрывается тапом по нему и не мешает листать
  const b = $('wolfBubble');
  if (b) b.addEventListener('click', hideBubble);
  window.addEventListener('scroll', () => { if (!$('wolfBubble').hidden) hideBubble(); }, { passive: true });
  window.addEventListener('resize', hideBubble);
  const sw = $('devWolf');
  if (sw) sw.addEventListener('change', () => { setMascot(sw.checked); if (sw.checked) greet(true); });
}
