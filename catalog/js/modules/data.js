// Загрузка каталога

import { CACHE_KEY, idbGet, idbSet, state } from './store.js';
import { buildIndex } from './catalog.js';

/* ── Данные ───────────────────────────────────── */

export async function loadCache() {
  try {
    const c = await idbGet(CACHE_KEY);
    if (c && Array.isArray(c.products)) {
      state.groups = c.groups || [];
      state.suppliers = c.suppliers || [];
      state.products = c.products;
      state.syncMax = c.syncMax || '';
      buildIndex();
      state.lastFetch = c.ts || 0;
      return true;
    }
  } catch (e) { /* нет кэша или IndexedDB недоступен — работаем от сети */ }
  return false;
}

export function saveCache() {
  // служебные поля индекса (начинаются с "_") в кэш не пишем — экономим место
  const clean = state.products.map((p) => {
    const o = {};
    for (const k in p) if (k[0] !== '_') o[k] = p[k];
    return o;
  });
  idbSet(CACHE_KEY, {
    groups: state.groups, suppliers: state.suppliers,
    products: clean, ts: Date.now(), syncMax: state.syncMax,
  }).catch(() => { /* не сохранилось — не страшно, кэш вспомогательный */ });
}

const PAGE = 1000; // база отдаёт максимум 1000 строк за раз
export const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
const trackMax = (rows) => { for (const r of rows) if (r.updated_at && r.updated_at > state.syncMax) state.syncMax = r.updated_at; };

// маленькие таблицы (группы, поставщики) — всегда целиком, это быстро

// Полная загрузка товаров страницами по id (быстро — id проиндексирован).
// Первую страницу показываем сразу, остальное дозагружаем в фоне — экран не пустует.

// Докачка: берём только товары, изменившиеся с прошлого раза, и вливаем в кэш.
// Обычно это 0–несколько строк → мгновенно. Удаления ловим сверкой количества.
