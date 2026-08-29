// Оформление под конкретный магазин: название, логотип, цвет, что включено

/* Движок один, а магазинов может быть много. Всё, чем один магазин отличается
 * от другого, живёт в одном файле настроек (js/config.js) — здесь эти настройки
 * применяются к странице. В коде приложения названия «Way Market» нет нигде:
 * поменял настройки — получил каталог другого магазина. */

import { $, CFG } from './store.js';

export const feature = (name) => {
  const f = CFG.FEATURES;
  return !f || f[name] !== false;      // не указано — считаем включённым
};
const storeName = () => CFG.STORE_NAME || 'Каталог';

// Тёмный акцент на тёмном фоне читается плохо. Для текста и ссылок берём тот
// же цвет, но осветлённый до читаемого — иначе чужой фирменный цвет
// превратился бы в нечитаемые надписи.
function lighten(hex, minL) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(Math.max(l, minL) * 100)}%)`;
}

export function applyBrand() {
  const name = storeName();
  const sub = CFG.STORE_SUBTITLE || 'Каталог товаров';
  document.title = `${name} · ${sub}`;

  const nameEl = document.querySelector('.brand-name');
  const subEl = document.querySelector('.brand-sub');
  if (nameEl) nameEl.textContent = name;
  if (subEl) subEl.textContent = sub;

  const logo = document.querySelector('.brand-logo-img');
  if (logo) {
    if (CFG.LOGO) { logo.src = CFG.LOGO; logo.alt = name; }
    else {
      // логотипа нет — рисуем кружок с первой буквой названия
      const dot = document.createElement('div');
      dot.className = 'brand-logo-img brand-logo-letter';
      dot.textContent = name.trim().charAt(0).toUpperCase();
      logo.replaceWith(dot);
    }
  }

  if (CFG.ACCENT) {
    const root = document.documentElement.style;
    root.setProperty('--brand', CFG.ACCENT);
    root.setProperty('--brand-text', lighten(CFG.ACCENT, 0.62));
  }

  // Выключенное в настройках просто исчезает из интерфейса.
  // «цены магазинов» и «ходовые» переехали во вкладку «Работа» — там их
  // показ решается теми же feature-флагами при отрисовке экрана
}

function hide(id) { const el = $(id); if (el) el.hidden = true; }
