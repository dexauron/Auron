// Мелкие помощники: элементы, экранирование, форматы, шторки

import { $, state } from './store.js';
import { ic } from './icons.js';
import { stopScan } from './scanner.js';

/* ── Утилиты ──────────────────────────────────── */

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Фото не загрузилось (битая ссылка) → убираем «сломанную картинку» браузера и
// показываем ту же заглушку 📦, что у товаров без фото. Соседние фото не трогаем.
window.wmImgFail = function (img) {
  try {
    const box = img.parentElement;
    img.remove();
    if (box && !box.querySelector('img')) {
      box.classList.add('no-photo');
      if (!box.textContent.trim()) box.insertAdjacentHTML('beforeend', ic('box', 'ic-ph'));
    }
  } catch (e) { /* ignore */ }
};

export const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();

// «свободная» нормализация: убирает всё, кроме букв и цифр —
// «арт. 8816» == «арт8816», «0,5» == «0.5» == «05»
export const stripPunct = (s) => norm(s).replace(/[^0-9a-zа-я]+/g, '');
// как norm, но без trim и без изменения длины (для подсветки — позиции символов сохраняются)
const hlNorm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

// подсветка совпавших слов запроса в тексте (безопасно экранирует HTML)
export function highlight(text, tokens) {
  text = String(text ?? '');
  if (!tokens || !tokens.length) return esc(text);
  const low = hlNorm(text);
  const marks = new Array(text.length).fill(false);
  for (const t of tokens) {
    if (!t || t.length < 2) continue;
    let i = low.indexOf(t);
    while (i !== -1) { for (let j = i; j < i + t.length; j++) marks[j] = true; i = low.indexOf(t, i + t.length); }
  }
  let out = ''; let open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    else if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += esc(text[i]);
  }
  if (open) out += '</mark>';
  return out;
}

// Транслитерация: «сникерс» найдёт Snickers, snickers найдёт «Сникерс»
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'u', я: 'a',
};
export const translit = (s) => s.replace(/[а-я]/g, (ch) => TR[ch] ?? ch);
// варианты строки для сравнения: как есть + в латинице
const variants = (s) => {
  const t = translit(s);
  return t === s ? [s] : [s, t];
};

export function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

// ── Окна (шторки): стек + кнопка «назад» телефона + смахивание вниз ──
const sheetStack = [];
export let expectPop = 0; // сколько наших history.back() ещё «переварить» без действия

// z-index задаём по порядку ОТКРЫТИЯ, а не по порядку в HTML — иначе окно,
// открытое позже, могло оказаться ЗА уже открытым (баг «окошки сзади»)
function restackSheets() {
  sheetStack.forEach((id, i) => {
    const el = $(id);
    if (!el) return;
    el.style.zIndex = String(40 + i * 2);
    // затемняем фон только у верхнего окна — стопка не темнеет вдвое
    el.classList.toggle('backdrop-top', i === sheetStack.length - 1);
  });
}

export function openSheet(id) {
  const el = $(id);
  if (!el || !el.hidden) return; // нет элемента или уже открыт
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  sheetStack.push(id);
  restackSheets();
  // history-запись: кнопка «назад» на телефоне закроет это окно, а не выйдет из приложения
  try { history.pushState({ wmSheet: id }, ''); } catch (e) { /* некритично */ }
}

function hideSheet(id) { // фактическое скрытие, без истории
  const el = $(id);
  if (!el) return;
  el.hidden = true;
  el.style.zIndex = '';
  el.classList.remove('backdrop-top');
  const i = sheetStack.lastIndexOf(id);
  if (i >= 0) sheetStack.splice(i, 1);
  if (!sheetStack.length) document.body.style.overflow = '';
  else restackSheets();
  if (id === 'scanSheet') stopScan();
}

export function closeSheet(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  hideSheet(id);
  // «съедаем» нашу history-запись, чтобы счётчик «назад» не сбился
  if (window.history.state && window.history.state.wmSheet) { expectPop++; try { history.back(); } catch (e) { expectPop--; } }
}

window.addEventListener('popstate', () => {
  if (expectPop > 0) { expectPop--; return; } // это наш собственный закрывающий back — окно уже скрыто
  const lb = $('lightbox');
  if (lb && !lb.hidden) { lb.hidden = true; lb.querySelector('img') && (lb.querySelector('img').src = ''); return; } // «назад» закрывает фото на весь экран
  if (sheetStack.length) hideSheet(sheetStack[sheetStack.length - 1]); // «назад» на телефоне → закрыть верхнее окно
});

// Клавиша Esc закрывает верхнее окно (компьютер и планшет с клавиатурой).
// Через closeSheet — чтобы счётчик истории «назад» не сбивался.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  const lb = $('lightbox');
  if (lb && !lb.hidden) { // сначала закрываем фото на весь экран
    e.preventDefault();
    lb.hidden = true;
    const img = lb.querySelector('img'); if (img) img.src = '';
    return;
  }
  if (!sheetStack.length) return;
  e.preventDefault();
  closeSheet(sheetStack[sheetStack.length - 1]);
});

/* Подпись строки списка. Писать в строку через textContent нельзя: внутри есть
 * <span> с названием (и иногда со значением), и textContent их стирает —
 * строка теряет разметку, а стрелка съезжает к тексту. */
export function setRowText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const title = el.querySelector('.ios-row-title');
  if (title) title.textContent = text; else el.textContent = text;
}

// Стрелка «назад» в левом верхнем углу каждого окна
export function addBackButtons() {
  document.querySelectorAll('.sheet').forEach((sheet) => {
    const bd = sheet.closest('.sheet-backdrop');
    // У окон со своей шапкой (.ios-nav) кнопка закрытия уже есть — круглая
    // стрелка поверх заголовка выглядела бы чужеродно.
    if (!bd || sheet.hasAttribute('data-no-back') || sheet.querySelector('.sheet-back') || sheet.querySelector('.ios-nav')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-back';
    b.setAttribute('aria-label', 'Назад');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    b.addEventListener('click', () => closeSheet(bd.id));
    sheet.insertBefore(b, sheet.firstChild);
  });
}

// Смахивание шторки вниз, чтобы закрыть — в стиле iPhone: окно тянется за
// пальцем, фон плавно светлеет, при отпускании — мягкая «пружина» назад,
// а быстрый флик закрывает даже с небольшого расстояния.
export function enableSwipeToClose() {
  const NO_DRAG = 'button,a,input,textarea,select,label,.photo-strip,.price-history,.scan-box';
  const SPRING = 'transform .38s cubic-bezier(.32,.72,0,1)';
  document.querySelectorAll('.sheet').forEach((sheet) => {
    const bd = sheet.closest('.sheet-backdrop');
    let startY = 0; let cur = 0; let drag = false; let lastY = 0; let lastT = 0; let vel = 0;
    sheet.addEventListener('touchstart', (e) => {
      if (sheet.scrollTop > 3) return;            // контент прокручен — не мешаем скроллу
      if (e.target.closest(NO_DRAG)) return;      // не перехватываем кнопки/поля/листание фото
      startY = e.touches[0].clientY; cur = 0; drag = true;
      lastY = startY; lastT = e.timeStamp || Date.now(); vel = 0;
      sheet.style.transition = 'none';
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (!drag) return;
      const y = e.touches[0].clientY;
      let d = y - startY;
      // тянешь вверх — сопротивление «резинки», как в iOS
      cur = d >= 0 ? d : -Math.pow(-d, 0.75);
      const now = e.timeStamp || Date.now();
      if (now > lastT) { vel = (y - lastY) / (now - lastT); lastY = y; lastT = now; }
      sheet.style.transform = `translateY(${cur}px)`;
      if (bd) bd.style.opacity = String(Math.max(0.25, 1 - Math.max(0, cur) / (sheet.offsetHeight || 600)));
    }, { passive: true });
    const finish = () => {
      if (!drag) return;
      drag = false;
      sheet.style.transition = SPRING;
      sheet.style.transform = '';
      if (bd) { bd.style.transition = 'opacity .3s ease'; bd.style.opacity = ''; }
      // закрыть, если утянул далеко ИЛИ быстро фликнул вниз
      if ((cur > 110 || (vel > 0.6 && cur > 40)) && bd) closeSheet(bd.id);
      setTimeout(() => { sheet.style.transition = ''; if (bd) bd.style.transition = ''; }, 400);
    };
    sheet.addEventListener('touchend', finish);
    sheet.addEventListener('touchcancel', finish);
  });
}

export function groupById(id) { return state.groups.find((g) => g.id === id) || null; }
export function supplierById(id) { return state.suppliers.find((s) => s.id === id) || null; }
