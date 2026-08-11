#!/usr/bin/env node
/*
 * Выгрузка «витрины» каталога в статические файлы для бесплатного GitHub Pages.
 *
 * Зачем: чтобы покупатель БЕЗ входа читал каталог из файла, а не с платного
 * сервера. Это первый шаг переезда «на GitHub без сервера, без VPN».
 *
 * Что делает: берёт товары с сервера ПУБЛИЧНЫМ (anon) ключом и оставляет только
 * витринные поля. Секретное (поставщики, закупка, штрихкоды/коды кассы,
 * поступления, примечания) в файл НЕ попадает — записываем строгий белый список.
 *
 * Итог:  catalog/data/products.json  и  catalog/data/groups.json
 *
 * Запуск (Node 18+):
 *   node catalog/setup/export-static.mjs
 * Ключи берёт из catalog/js/config.js. Можно переопределить окружением:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node catalog/setup/export-static.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..'); // catalog/

// Ключи из config.js (или из переменных окружения — удобно для робота GitHub).
const cfgTxt = readFileSync(join(root, 'js', 'config.js'), 'utf8');
const pick = (k) => (cfgTxt.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1];
const BASE = (process.env.SUPABASE_URL || pick('SUPABASE_URL') || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || pick('SUPABASE_ANON_KEY');
if (!BASE || !KEY) { console.error('❌ Нет SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(1); }

// Белый список витринных полей — что можно показывать покупателю. Всё, чего тут
// нет (supplier_ids, code, article, barcodes, department, note, arrival_at …),
// в файл не пишем.
const PUBLIC_FIELDS = ['id', 'name', 'group_id', 'retail_price', 'is_weighted', 'unit', 'description', 'photos'];

async function rest(path, headers = {}) {
  const r = await fetch(BASE + '/rest/v1/' + path, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, ...headers },
  });
  if (!r.ok) throw new Error(path + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
}

async function allProducts() {
  const out = [];
  const PAGE = 1000; // сервер отдаёт максимум 1000 строк за раз
  for (let from = 0; ; from += PAGE) {
    // select=* + строгая фильтрация ниже — устойчиво к разным версиям схемы
    const r = await rest('catalog_products?select=*&order=id', { Range: `${from}-${from + PAGE - 1}` });
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// оставляем только витринные поля
const clean = (p) => {
  const o = {};
  for (const k of PUBLIC_FIELDS) if (p[k] != null) o[k] = p[k];
  return o;
};

const raw = await allProducts();
const products = raw.map(clean).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
const groups = await (await rest('catalog_groups?select=id,name,sort_order&order=sort_order,name')).json();

const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'products.json'), JSON.stringify(products));
writeFileSync(join(dataDir, 'groups.json'), JSON.stringify(groups));
console.log(`✅ Выгружено: ${products.length} товаров, ${groups.length} категорий → catalog/data/`);
