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

export const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

/* ── Уборка памяти ──────────────────────────────────────────────────────────
 * Каждый импорт добавляет строки истории цен и новый отчёт продаж, и со
 * временем в памяти телефона копится то, чем никто не пользуется: цены
 * трёхлетней давности, полтора десятка старых отчётов. На 17 тысячах товаров
 * это десятки мегабайт — телефон начинает думать и захлёбываться.
 * Правила простые и понятные:
 *   • история цены — последние 8 записей по каждому поставщику и не старше 2 лет
 *     (в карточке всё равно видно последние);
 *   • отчёты продаж — последние 12 периодов;
 *   • счётчик просмотров — 300 самых открываемых товаров.
 * Всё, что нужно для расчётов «сколько заказать» и сравнения цен, остаётся. */
const KEEP_PRICE_ROWS = 8;
const KEEP_PRICE_DAYS = 730;
const KEEP_SALES_PERIODS = 12;
const KEEP_POPULAR = 300;

export function tidyMemory() {
  const before = { prices: (state.prices || []).length, sales: (state.sales || []).length };
  const edge = new Date(Date.now() - KEEP_PRICE_DAYS * 86400000).toISOString().slice(0, 10);

  // цены: свежие сверху, оставляем по 8 на пару «товар + поставщик»
  if (state.prices && state.prices.length) {
    const seen = new Map();
    const kept = [];
    const sorted = state.prices.slice().sort((a, b) => String(b.price_date || '').localeCompare(String(a.price_date || '')));
    for (const r of sorted) {
      const key = r.product_id + '|' + r.supplier_id;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      // самую свежую запись храним всегда, даже если она старая: иначе у товара
      // вообще не останется цены и он «потеряет» поставщика
      if (n > KEEP_PRICE_ROWS) continue;
      if (n > 1 && r.price_date && r.price_date < edge) continue;
      kept.push(r);
    }
    state.prices = kept;
  }

  // продажи: последние периоды
  if (state.sales && state.sales.length) {
    const periods = [...new Set(state.sales.map((s) => (s.period_from || '') + '|' + (s.period_to || '')))]
      .sort((a, b) => b.localeCompare(a)).slice(0, KEEP_SALES_PERIODS);
    const keep = new Set(periods);
    state.sales = state.sales.filter((s) => keep.has((s.period_from || '') + '|' + (s.period_to || '')));
  }

  // счётчик просмотров
  const pop = state.popularity || {};
  const ids = Object.keys(pop);
  if (ids.length > KEEP_POPULAR) {
    const top = ids.sort((a, b) => pop[b] - pop[a]).slice(0, KEEP_POPULAR);
    const next = {};
    for (const id of top) next[id] = pop[id];
    state.popularity = next;
  }
  return { pricesRemoved: before.prices - (state.prices || []).length, salesRemoved: before.sales - (state.sales || []).length };
}
const trackMax = (rows) => { for (const r of rows) if (r.updated_at && r.updated_at > state.syncMax) state.syncMax = r.updated_at; };

// маленькие таблицы (группы, поставщики) — всегда целиком, это быстро

// Полная загрузка товаров страницами по id (быстро — id проиндексирован).
// Первую страницу показываем сразу, остальное дозагружаем в фоне — экран не пустует.

// Докачка: берём только товары, изменившиеся с прошлого раза, и вливаем в кэш.
// Обычно это 0–несколько строк → мгновенно. Удаления ловим сверкой количества.
