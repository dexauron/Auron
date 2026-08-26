// Категории товаров и умный поиск

import { $, CFG, RELATIVE_CUTOFF, SEARCH_THRESHOLD, state } from './store.js';
import { groupById, norm, stripPunct, supplierById, translit } from './core.js';
import { CATEGORIES, OTHER_CAT, catCache, ic } from './icons.js';
import { favorites } from './render.js';
import { popViews } from './device.js';
import { byName } from './data.js';
import { buildPopularIds } from './publish.js';

/* ── Категории: 200+ групп 1С → ~12 понятных разделов ──
 * Раскладываем автоматически по названию группы. Первое совпадение выигрывает.
 * Порядок правил важен: сначала точные (детское, гигиена), потом общие. */
/* ── Как определяется категория товара ──────────────
 * Раньше категория бралась ТОЛЬКО из названия группы 1С. Но группа часто
 * заполнена неверно, обобщённо («Товары», «Прочее») или пуста — и товар
 * оказывался не на своей полке. Теперь порядок такой:
 *   1. ручная правка или найденное в интернете (поле category у товара);
 *   2. САМО НАЗВАНИЕ товара — в выгрузках 1С оно почти всегда начинается с
 *      самого товара: «Молоко Простоквашино», «Шампунь Head & Shoulders»;
 *   3. название группы — как было;
 *   4. «Прочее».
 * Правила по названию нарочно привязаны к НАЧАЛУ строки: «молоко …» — это
 * молочное, а вот «крем-сода» в середине названия ловилась бы как косметика.
 * Детское проверяем первым: подгузники подходят и под гигиену.
 * Про границу слова: в JS кириллица не считается словесным символом, поэтому
 * «сок\b» НЕ срабатывает на «Сок Добрый» — границы там не возникает. Пишем
 * «сок(?![а-яё])»: дальше не буква. На этом уже спотыкались в разборе 1С. */
const NAME_RULES = [
  [/^(подгуз|пюре детск|смесь детск|каш[аи] детск|соск|бутылочк|пустышк|погремушк)/, 'Детское'],
  [/^(молок|кефир|смета|творог|творож|йогурт|сырок|сыр(?![а-яё])|ряженк|простокваш|сливк|масло сливоч|сгущ|яйц)/, 'Молочное'],
  [/^(хлеб|батон|булоч|булк|лаваш|багет|сухар|пирож|пирог|торт|кекс|рулет|слойк|круасс|пицц|самса|чебурек|хачапур|блин)/, 'Хлеб и выпечка'],
  [/^(вода|сок(?![а-яё])|нектар|лимонад|напит|квас|морс|кофе|чай(?![а-яё])|какао|энергет|компот|сироп|минерал)/, 'Напитки'],
  [/^(конфет|шоколад|мармелад|зефир|пастил|печен|пряник|вафл|халв|козинак|леденц|драже|карамел|батончик|м[её]д(?![а-яё])|варень|джем|повидл|жеват|ирис|щербет|рахат)/, 'Сладости'],
  [/^(чипс|сн[еэ]к|попкорн|семечк|арахис|фисташк|орех|миндал|кешью|сухофрукт|хлебц|мюсли|хлопь|кукурузн палоч|гренк)/, 'Снеки'],
  [/^(колбас|сосиск|сардельк|ветчин|бекон|карбонад|мясо|фарш|курин|куриц|говядин|свинин|индейк|баранин|рыба|сельд|скумбри|горбуш|л[оа]сос|икра|креветк|краб|кальмар|паштет|шпик|сало|окорок|шашлык)/, 'Мясо и рыба'],
  [/^(мороженое|мороженно|заморож|пельмен|вареник|наггетс|хингал|манты|котлет заморож|лед пищев)/, 'Заморозка'],
  [/^(шампун|бальзам|кондиционер для волос|мыло|зубн|дезодор|антиперспирант|крем для|гель для душа|пена для|станк|бритв|прокладк|тампон|салфетк влаж|ватн|туалетная вода|духи|лак для|краск[аи] для волос|шапочк для душа)/, 'Красота и гигиена'],
  [/^(порошок стир|гель для стир|кондиционер для бел|средство для|чистящ|отбелив|освежит|мешк|пакет|перчатк|губк|тряпк|швабр|ведр|щетк|туалетная бумага|полотенц бумаж|фольг|пл[её]нк|батарейк|лампочк|свеч|зажигалк|спичк|скотч|клей|салфетк бумаж|прищепк|веник|совок)/, 'Дом и химия'],
  [/^(овощ|фрукт|яблок|банан|апельсин|лимон|мандарин|картоф|морков|лук(?![а-яё])|капуст|огурц|помидор|томат свеж|зелень|укроп|петрушк|гриб|виноград|груш|киви|ананас|арбуз|дын|перец свеж|чеснок|свекл|редис|кабач|баклаж|зелен[ьи])/, 'Овощи и фрукты'],
  [/^(мука|сахар|соль(?![а-яё])|сода|дрожж|макарон|лапш|спагетти|верм[иеё]шел|греч|рис(?![а-яё])|пшено|перловк|манк|булгур|крупа|горох|фасол|чечевиц|масло подсолн|масло растит|масло оливк|уксус|соус|кетчуп|майонез|специ|приправ|консерв|тушенк|паштет консерв|крахмал|разрыхлит|желатин|панировк)/, 'Бакалея'],
];

// категория по САМОМУ названию товара; null — не распознали
// Набор правил под отрасль магазина. 'none' — своих правил нет: разделы
// берутся из групп 1С как есть (так каталог годится любому магазину, а не
// только продуктовому).
const useNameRules = () => (CFG.CATEGORIES || 'grocery') !== 'none';

function categoryByName(name) {
  if (!useNameRules()) return null;
  const n = norm(name);
  if (!n) return null;
  for (const [re, cat] of NAME_RULES) if (re.test(n)) return cat;
  return null;
}

export function categoryOf(groupName) {
  const key = groupName || '';
  if (key in catCache) return catCache[key];
  const n = norm(key);
  let cat = OTHER_CAT.name;
  for (const c of CATEGORIES) if (c.re.test(n)) { cat = c.name; break; }
  catCache[key] = cat;
  return cat;
}
export const catIcon = (name) => ic(name, 'ic-cat');
/* Какие разделы показывать на экране «Категории». У продуктового магазина это
 * наш готовый список; у любого другого — те разделы, что реально получились из
 * групп 1С (иначе экран был бы пустым: наших названий там нет). */
export function catalogSections(counts) {
  if (useNameRules()) return [...CATEGORIES, OTHER_CAT].filter((c) => counts[c.name]);
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((name) => ({ name }));
}
// Считаем при первом обращении, а не при загрузке модуля: список категорий
// живёт в соседнем модуле, и на момент загрузки он может быть ещё не готов.
let _catNames = null;
const CAT_NAMES = { has: (n) => (_catNames || (_catNames = new Set([...CATEGORIES.map((c) => c.name), OTHER_CAT.name]))).has(n) };
// Результат кладём в служебное поле _cat: на 17 000 товаров прогонять тринадцать
// правил при каждой отрисовке — заметно. Сбрасывается в buildIndex().
export function productCategory(p) {
  if (!p) return null;
  if (p._catGen === gen && p._cat !== undefined) return p._cat;
  p._catGen = gen;
  // Магазин не продуктовый: своих правил нет, раздел — это группа 1С как есть.
  if (!useNameRules()) {
    const g = p.category ? null : groupById(p.group_id);
    p._cat = p.category || (g ? g.name : null);
    return p._cat;
  }
  let cat = null;
  if (p.category && CAT_NAMES.has(p.category)) cat = p.category;   // правка вручную или из интернета
  if (!cat) cat = categoryByName(p.name);                          // само название товара
  if (!cat) { const g = groupById(p.group_id); if (g) cat = categoryOf(g.name); }
  p._cat = cat || null;
  return p._cat;
}

export const fmtPrice = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
// число без единицы: 24 → «24», 2.5 → «2,5» (как принято в России)
export const fmtNum = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
// цена с единицей: у весовых показываем «/кг», чтобы было понятно
export const fmtRetail = (p) => fmtPrice(p.retail_price) + (p.is_weighted ? '/кг' : '');
// Пустая дата (в файле её могло не быть) раньше превращалась в «undefined.undefined.ll».
// Теперь возвращаем пустую строку — вызывающий сам решает, что показать.
export const fmtDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : '';
};
// цена старше этого срока считается устаревшей: нового поступления давно не было,
// цена у поставщика могла измениться — не помечаем такую как «выгодную»
export const STALE_PRICE_DAYS = 30;
export const priceAgeDays = (d) => Math.floor((Date.now() - new Date(String(d).slice(0, 10) + 'T00:00:00').getTime()) / 86400000);
export const isFreshPrice = (row) => row && priceAgeDays(row.price_date) <= STALE_PRICE_DAYS;
export const telHref = (phone) => 'tel:' + String(phone).replace(/[^+\d]/g, '');
export const waHref = (phone) => {
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  return 'https://wa.me/' + d;
};

/* ── Умный поиск ──────────────────────────────── */

export function bigrams(s) {
  const set = [];
  const str = ` ${s} `;
  for (let i = 0; i < str.length - 1; i++) set.push(str.slice(i, i + 2));
  return set;
}

export function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const bCopy = [...b];
  let hits = 0;
  for (const g of a) {
    const i = bCopy.indexOf(g);
    if (i !== -1) { hits++; bCopy.splice(i, 1); }
  }
  return (2 * hits) / (a.length + b.length);
}

/* ── Поисковый индекс ────────────────────────────────────────────────────
 * Раньше при загрузке каталога для КАЖДОГО из 17 000 товаров сразу считались
 * полтора десятка производных строк (транслит, «пословный» вид, вид без
 * знаков…). На бюджетном Android это была одна задача почти на три секунды:
 * приложение открылось, но не отзывалось на нажатия. Плюс лишние сотни
 * тысяч строк в памяти — телефон начинал тормозить и на прокрутке.
 *
 * Теперь производные строки считаются ЛЕНИВО — только для тех товаров, до
 * которых реально дошёл поиск, и запоминаются до следующей загрузки данных.
 * «Поколение» (gen) заменяет обход всех товаров: увеличили число — всё
 * посчитанное раньше считается устаревшим и пересчитается по требованию. */
let gen = 0;
export function buildIndex() {
  gen++;      // всё посчитанное раньше устарело, пересчитается по требованию
}

// Коды и штрихкоды товара (нужны поиску по цифрам)
function codeFields(p) {
  if (p._cgen === gen) return p;
  p._codes = [p.code, p.article, p.department, ...(p.barcodes || [])].map(norm).filter(Boolean);
  p._codesLoose = p._codes.map(stripPunct).filter(Boolean);
  p._cgen = gen;
  return p;
}

// Название, группа, примечание во всех видах, нужных сравнению
function textFields(p) {
  if (p._tgen === gen) return p;
  const name = norm(p.name);
  p._name = name;
  p._nameT = translit(name);
  p._nameW = wordy(name);
  p._nameWT = wordy(p._nameT);
  p._hasLat = /[a-z]/.test(name);
  p._nameLoose = stripPunct(name);
  const sup = (p.supplier_ids || []).map((id) => supplierById(id)?.name).filter(Boolean).join(' ');
  p._sup = norm(sup);
  p._supT = translit(p._sup);
  p._grp = norm(groupById(p.group_id)?.name || '');
  p._grpT = translit(p._grp);
  p._grpW = wordy(p._grp);
  p._grpWT = wordy(p._grpT);
  p._note = norm(p.note || '');
  p._noteW = wordy(p._note);
  p._tgen = gen;
  return p;
}

/* Указатель «начало слова → товары». Ключ — первые три буквы слова, поэтому
 * запрос «просток» сразу даёт короткий список кандидатов вместо перебора всех
 * 17 000 товаров. Кладём и слова названия, и их транслит (чтобы «сникерс»
 * находил Snickers), и примечание, и коды. Строится один раз на поколение и
 * только при первом поиске словом — открытие каталога он не задерживает. */
const KEY = 3;
function addKey(map, word, i) {
  if (!word) return;
  const k = word.slice(0, KEY);
  let arr = map.get(k);
  if (!arr) map.set(k, arr = []);
  if (arr[arr.length - 1] !== i) arr.push(i);
}

function indexOne(map, p, i) {
  const name = norm(p.name);
  for (const w of name.split(/[^a-zа-я0-9]+/)) {
    if (!w) continue;
    addKey(map, w, i);
    // для ключа хватает начала слова — транслитерировать слово целиком
    // (а это 85 000 замен на каталог) незачем
    const head = w.slice(0, KEY + 1);
    const t = translit(head);
    if (t !== head) addKey(map, t, i);
  }
  if (p.note) for (const w of norm(p.note).split(/[^a-zа-я0-9]+/)) addKey(map, w, i);
  if (p.code) addKey(map, norm(p.code), i);
  if (p.article) addKey(map, norm(p.article), i);
  for (const bc of (p.barcodes || [])) addKey(map, norm(bc), i);
}

/* Указатель строится ПОРЦИЯМИ. Одним куском на 17 000 товаров это была задача
 * почти на секунду — на бюджетном телефоне заметная заминка. Порция в тысячу
 * товаров укладывается в сотую долю секунды, и между порциями телефон успевает
 * отрисовать кадр и ответить на нажатие. */
let wi = { map: null, gen: -1, done: 0 };
function indexStep(n) {
  if (!wi.map || wi.gen !== gen) wi = { map: new Map(), gen, done: 0 };
  const list = state.products;
  const end = Math.min(list.length, wi.done + n);
  for (let i = wi.done; i < end; i++) indexOne(wi.map, list[i], i);
  wi.done = end;
  return wi.done >= list.length;
}

// нужен прямо сейчас — дособираем оставшееся, не дожидаясь свободной минуты
function wordIndex() {
  while (!indexStep(4000));
  return wi.map;
}

/* Собрать указатель заранее, в свободную минуту. Сам по себе он ленивый и
 * построится при первом поиске, но тогда первое слово ждало бы лишнюю секунду.
 * Зовём после загрузки каталога, когда телефону нечем заняться. */
export function warmSearchIndex() {
  const later = (fn) => (typeof requestIdleCallback === 'function'
    ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 60));
  const step = () => {
    try { if (indexStep(1000)) return; } catch (e) { return; /* построится при поиске */ }
    later(step);
  };
  later(step);
}

/* Кандидаты на запрос: товары, у которых есть слово (или код), начинающееся
 * так же. Короткий запрос (1–2 буквы) собираем по всем подходящим ключам —
 * их тысячи, а не 17 000 товаров, поэтому это всё равно быстро. */
function candidates(tokens) {
  const map = wordIndex();
  const list = state.products;
  const out = new Set();
  for (const t of tokens) {
    for (const v of t.qVars) {
      if (!v) continue;
      if (v.length >= KEY) {
        const arr = map.get(v.slice(0, KEY));
        if (arr) for (const i of arr) out.add(list[i]);
      } else {
        for (const [k, arr] of map) {
          if (k.startsWith(v)) for (const i of arr) out.add(list[i]);
        }
      }
    }
  }
  return out;
}

// Товары групп, чьё название подходит под запрос: по «молочные» находятся
// товары этой группы, даже если самого слова в названии товара нет.
function groupCandidates(qVars, out) {
  const hit = new Set();
  for (const g of state.groups) {
    const n = norm(g.name);
    const nT = translit(n);
    const w = wordy(n); const wT = wordy(nT);
    if (matchPre(n, nT, qVars, [45, 42, 0], w, wT, true)) hit.add(g.id);
  }
  if (!hit.size) return;
  for (const p of state.products) if (hit.has(p.group_id)) out.add(p);
}

// «пословный» вид строки: все знаки (дефисы, точки, скобки) → пробелы,
// по краям тоже пробелы. Нужен, чтобы искать начало любого слова: ' дог '
// найдётся в «хот-дог», но «рис» НЕ найдётся в «ирис».
const wordy = (s) => ' ' + String(s).replace(/[^a-zа-я0-9]+/g, ' ').trim() + ' ';

// Сравнение текста с запросом (с учётом транслитерации рус ↔ англ).
// Веса: [0] — строка начинается с запроса, [1] — с запроса начинается любое
// слово, [2] — запрос попал ВНУТРЬ слова (слабый сигнал, только для длинных
// запросов: иначе «сок» лез в «Высокобелковый», а «рис» — в «Ирис»).
const MIDWORD_MIN = 5;
// Транслитерация «съедает» буквы: «водяной» → vodanoi, и тогда запрос «вода»
// ложно совпадает с началом слова. Поэтому сравниваем через транслит только
// когда языки букв разные (искали латиницей, а название русское, или наоборот).
// Если и запрос, и название чисто русские — сравниваем напрямую.
function matchPre(text, textT, qVars, w, textW, textWT, useT) {
  if (!text) return 0;
  let s = 0;
  const tvs = (text === textT || useT === false) ? [[text, textW]] : [[text, textW], [textT, textWT]];
  for (const [tv, tw] of tvs) {
    for (const qv of qVars) {
      // Целое слово важнее куска слова: по запросу «вода» сначала «Вода 0,5л»,
      // и только потом «Водолей». +10 — «слово стоит в начале названия».
      if (tw && tw.includes(' ' + qv + ' ')) s = Math.max(s, w[1] + (tv.startsWith(qv) ? 20 : 10));
      else if (tv.startsWith(qv)) s = Math.max(s, w[0]);
      else if (tw && tw.includes(' ' + qv)) s = Math.max(s, w[1]);
      else if (w[2] && qv.length >= MIDWORD_MIN && tv.includes(qv)) s = Math.max(s, w[2]);
    }
  }
  return s;
}

// нечёткое совпадение — прощает опечатки («хатдок» найдёт «хот-дог», «сникерс» — Snickers)
function fuzzyScore(name, nameT, qVars) {
  let best = 0;
  const nvs = name === nameT ? [name] : [name, nameT];
  for (const nv of nvs) {
    const clean = nv.replace(/[^a-zа-я0-9 ]/g, '');
    const words = clean.split(/\s+/).filter(Boolean);
    for (const qv of qVars) {
      const qWords = qv.replace(/[^a-zа-я0-9 ]/g, '').split(/\s+/).filter((w) => w.length >= 3);
      if (!qWords.length) continue;
      let total = 0;
      for (const qw of qWords) {
        const qb = bigrams(qw);
        let b = dice(qb, bigrams(clean.replace(/\s+/g, '')));
        for (const w of words) b = Math.max(b, dice(qb, bigrams(w)));
        total += b;
      }
      best = Math.max(best, total / qWords.length);
    }
  }
  return best;
}

// счёт одного слова запроса по товару (имя, коды/штрихкоды, поставщик, группа)
function scoreToken(p, q, qVars, allowFuzzy = true) {
  codeFields(p); textFields(p);   // посчитается один раз на товар
  let s = 0;
  for (const c of (p._codes || [])) {
    if (c === q) return 120;
    if (c.startsWith(q)) s = Math.max(s, 95);
    else if (c.includes(q)) s = Math.max(s, 70);
  }
  // поиск без учёта знаков/пробелов: «арт8816» найдёт «арт. 8816», «0.5» → «0,5»
  if (s < 95) {
    const qL = stripPunct(q);
    if (qL) {
      for (const c of (p._codesLoose || [])) {
        if (c === qL) return 118;
        if (c.startsWith(qL)) s = Math.max(s, 92);
        else if (c.includes(qL)) s = Math.max(s, 68);
      }
      if (qL.length >= MIDWORD_MIN && (p._nameLoose || '').includes(qL)) s = Math.max(s, 78);
    }
  }
  // латиница есть в запросе или в названии → транслит нужен; иначе только «как есть»
  const useT = p._hasLat || /[a-z]/.test(q);
  s = Math.max(s, matchPre(p._name, p._nameT, qVars, [92, 90, 55], p._nameW, p._nameWT, useT));
  // Поставщика в свободном поиске НЕ учитываем: иначе, набрав название товара,
  // можно получить чужие товары того же поставщика (напр. поставщик «Адреналин»).
  // Искать по поставщику — отдельным чипом «Поставщики».
  if (p._grp) s = Math.max(s, matchPre(p._grp, p._grpT, qVars, [45, 42, 0], p._grpW, p._grpWT, useT));
  if (p._note) s = Math.max(s, matchPre(p._note, p._note, qVars, [38, 36, 0], p._noteW, p._noteW));
  if (p.is_weighted && ('весовой'.startsWith(q) || 'весовые'.startsWith(q) || q === 'вес')) {
    s = Math.max(s, 45);
  }
  // нечёткий поиск — только если точного совпадения не нашлось (прощает опечатки)
  // Нечёткий поиск (прощает опечатки) — только для запросов от 4 букв.
  // На коротких словах похожесть по буквосочетаниям врёт: «рис» так «находил»
  // Rich и Ирис. Длину проверяем, а сам порог похожести оставляем мягким,
  // иначе перестают находиться настоящие опечатки вроде «хатдок» → «хот-дог».
  if (allowFuzzy && s < 60 && q.length >= 4) {
    const fuzzy = fuzzyScore(p._name, useT ? p._nameT : p._name, useT ? qVars : [q]);
    if (fuzzy >= 0.4) s = Math.max(s, Math.round(65 * fuzzy));
  }
  return s;
}

// умный поиск: либо вся фраза подряд (как раньше), либо КАЖДОЕ слово в любом
// порядке (напр. «печенье яшкино» найдёт «Яшкино Печенье…»). Берём лучшее —
// ничего из прежнего поведения не теряем.
/* allowFuzzy — считать ли похожесть по буквосочетаниям (разбор опечаток).
 * Она дорогая, и кандидатам из указателя обычно не нужна: они и так совпали
 * началом слова. Опечатки разбираются отдельным проходом — см. visibleProducts. */
export function scoreProduct(p, q, qVars, tokens, allowFuzzy = true) {
  const whole = scoreToken(p, q, qVars, allowFuzzy);
  if (!tokens || tokens.length <= 1) return whole;
  let total = 0;
  for (const tok of tokens) {
    const s = scoreToken(p, tok.q, tok.qVars, allowFuzzy);
    if (s <= 0) { total = 0; break; } // слово не найдено → товар не подходит
    total += s;
  }
  const multi = total ? Math.round(total / tokens.length) : 0;
  return Math.max(whole, multi);
}

const hasRetail = (p) => p.retail_price != null && p.retail_price !== '';

// дата поступления берётся СТРОГО из файла «Цены поставщиков» (колонка «Период» —
// дата последнего обновления цены). Нет даты — товар не попадает в фильтр по
// поступлению (не подменяем датой добавления, иначе результат врёт).
const arrivalDate = (p) => String(p.arrival_at || '').slice(0, 10);
// есть ли в базе колонка (по загруженным товарам). Если новой колонки ещё нет —
// не пишем её, чтобы импорт/сохранение не падали; после SQL заполнится.
const hasProductCol = (c) => (state.products.length ? (c in state.products[0]) : true);
const arrivalColExists = () => hasProductCol('arrival_at');
// местная календарная дата (не UTC) — чтобы «сегодня» совпадало с датами из файла
const localISO = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const todayISO = () => localISO(new Date());
export const daysAgoISO = (n) => localISO(new Date(Date.now() - n * 86400000));
// есть ли у товара хотя бы одно НЕПУСТОЕ фото (пустые строки не считаются)
export const hasPhoto = (p) => (p.photos || []).some((u) => u && String(u).trim());

// предикаты быстрых фильтров
export const QUICK = {
  withprice: (p) => hasRetail(p),
  barcode: (p) => (p.barcodes || []).length > 0,
  nophoto: (p) => !hasPhoto(p),
  noprice: (p) => !hasRetail(p),
  nobarcode: (p) => !(p.barcodes || []).length,
};

// сортировка готового списка по выбранному порядку
function sortList(list, scored) {
  const price = (p) => (hasRetail(p) ? Number(p.retail_price) : null);
  const byName = (a, b) => cmpRu(a.name, b.name);
  // «новые» = позже поступившие (дата из файла цен; если её нет — дата добавления)
  const when = (p) => p.arrival_at || p.created_at || '';
  switch (state.sort) {
    case 'name': return list.slice().sort(byName);
    case 'cheap': return list.slice().sort((a, b) => {
      const x = price(a); const y = price(b);
      if (x == null && y == null) return byName(a, b);
      if (x == null) return 1; if (y == null) return -1;
      return x - y || byName(a, b);
    });
    case 'expensive': return list.slice().sort((a, b) => {
      const x = price(a); const y = price(b);
      if (x == null && y == null) return byName(a, b);
      if (x == null) return 1; if (y == null) return -1;
      return y - x || byName(a, b);
    });
    case 'new': return list.slice().sort((a, b) => cmpStr(String(when(b)), String(when(a))) || byName(a, b));
    case 'popular': {
      // по продажам: порядок из списка популярного (buildPopularIds); нет продаж — по просмотрам
      const rank = new Map((state.popularIds || []).map((id, i) => [id, i]));
      return list.slice().sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : 1e9;
        const rb = rank.has(b.id) ? rank.get(b.id) : 1e9;
        return (ra - rb) || (popViews(b.id) - popViews(a.id)) || byName(a, b);
      });
    }
    default: // relevance: при поиске порядок уже по совпадению; без поиска — по названию
      return scored ? list : list.slice().sort(byName);
  }
}

// Предикат «товар подходит под выбранные категории/подгруппы».
// Ключевая логика: если внутри выбранной категории отмечены КОНКРЕТНЫЕ подгруппы —
// показываем только их (сужение), а не всю категорию. Так подкатегории реально
// работают вместе с категорией, а не «тонут» в объединении.
export function catGroupPredicate() {
  const { selCats, selGroups } = state;
  const active = selCats.length > 0 || selGroups.length > 0;
  const realGroups = new Set(selGroups.filter((g) => g !== 'none' && g !== 'weighted'));
  const noneSel = selGroups.includes('none');
  const weightedSel = selGroups.includes('weighted');
  const catSet = new Set(selCats);
  // категории, у которых выбрана хотя бы одна своя подгруппа → показываем только подгруппы
  const catsWithSub = new Set();
  realGroups.forEach((gid) => { const g = groupById(gid); if (g) { const c = categoryOf(g.name); if (c) catsWithSub.add(c); } });
  return (p) => {
    if (!active) return true;
    if (noneSel && !p.group_id) return true;
    if (weightedSel && p.is_weighted) return true;
    if (p.group_id && realGroups.has(p.group_id)) return true; // прямое совпадение по подгруппе
    const pc = productCategory(p);
    // вся категория — только если у неё НЕ выбраны отдельные подгруппы
    if (pc && catSet.has(pc) && !catsWithSub.has(pc)) return true;
    return false;
  };
}

export function visibleProducts() {
  let list = state.products;
  const { selCats, selGroups, selSuppliers, quick } = state;
  // фильтр по группам/категориям (с сужением до подгрупп — см. catGroupPredicate)
  if (selCats.length || selGroups.length) {
    list = list.filter(catGroupPredicate());
  }
  // фильтр по поставщикам — объединение (товар от любого отмеченного)
  if (selSuppliers.length) {
    list = list.filter((p) => (p.supplier_ids || []).some((id) => selSuppliers.includes(id)));
  }
  // только избранное (сердечко) — по локальному списку устройства
  if (state.favOnly) { const f = new Set(favorites()); list = list.filter((p) => f.has(p.id)); }
  // быстрые фильтры — каждый отмеченный обязателен (И)
  if (quick.length) {
    list = list.filter((p) => quick.every((k) => (QUICK[k] ? QUICK[k](p) : true)));
  }
  // тип товара: весовой / штучный (сотрудникам)
  if (state.selType === 'weighted') list = list.filter((p) => p.is_weighted);
  else if (state.selType === 'piece') list = list.filter((p) => !p.is_weighted);
  // поступление: произвольный диапазон дат «с … по …» (по дате завоза)
  if (state.arrivalFrom) list = list.filter((p) => { const d = arrivalDate(p); return d && d >= state.arrivalFrom; });
  if (state.arrivalTo) list = list.filter((p) => { const d = arrivalDate(p); return d && d <= state.arrivalTo; });
  // диапазон цены
  if (state.priceMin != null) list = list.filter((p) => hasRetail(p) && Number(p.retail_price) >= state.priceMin);
  if (state.priceMax != null) list = list.filter((p) => hasRetail(p) && Number(p.retail_price) <= state.priceMax);

  const q = norm(state.query);
  if (!q) return sortList(list, false);
  // Запрос из одних цифр — это код или штрихкод, самый частый случай у кассы.
  // Полная оценка всех 17 тысяч товаров на такой запрос занимала на телефоне
  // около секунды НА КАЖДУЮ НАЖАТУЮ ЦИФРУ, и каталог казался зависшим.
  // Цифры ищем напрямую по кодам — без транслита и разбора опечаток.
  if (/^\d{2,}$/.test(q)) return sortList(searchByCode(list, q), true);
  const qT = translit(q);
  const qVars = q === qT ? [q] : [q, qT];
  // слова запроса — каждое ищется отдельно (в любом порядке)
  const tokens = q.split(/\s+/).filter(Boolean).map((w) => {
    const wt = translit(w);
    return { q: w, qVars: w === wt ? [w] : [w, wt] };
  });
  /* Считаем не все 17 000 товаров, а только кандидатов из указателя «начало
     слова → товары». Оценка у кандидата та же, что была, поэтому выдача не
     меняется — меняется время: на бюджетном Android поиск словом занимал
     около трёх секунд НА КАЖДУЮ БУКВУ, и каталог казался зависшим. */
  const pool = candidateList(list, tokens, qVars);
  let hits = pool
    .map((p) => ({ p, s: scoreProduct(p, q, qVars, tokens, false) }))
    .filter((x) => x.s >= SEARCH_THRESHOLD);
  /* Опечатки. Товар с опечаткой в кандидаты не попадает («хатдок» и «хот-дог»
     начинаются по-разному), поэтому если по указателю почти ничего не нашлось —
     проходим по всему списку, но с дешёвой отбраковкой: у названия должны
     совпасть хотя бы два буквосочетания запроса. Полная (дорогая) оценка
     достаётся считанным товарам вместо всех. */
  if (hits.length < 20 && q.length >= 4) {
    const seen = new Set(hits.map((x) => x.p));
    for (const p of fuzzyPool(list, q, qVars, seen)) {
      const sc = scoreProduct(p, q, qVars, tokens);
      if (sc >= SEARCH_THRESHOLD) hits.push({ p, s: sc });
    }
  }
  // Отсекаем «хвост» слабых совпадений: если нашлось что-то хорошее, показывать
  // заодно всё отдалённо похожее — это и есть тот самый мусор в выдаче.
  if (hits.length) {
    const best = hits.reduce((m, x) => Math.max(m, x.s), 0);
    const floor = Math.max(SEARCH_THRESHOLD, best * RELATIVE_CUTOFF);
    hits = hits.filter((x) => x.s >= floor);
  }
  const scored = hits
    .sort((a, b) => b.s - a.s || cmpRu(a.p.name, b.p.name))
    .map((x) => x.p);
  return sortList(scored, true);
}

/* Кандидаты: товары из указателя плюс товары подходящих групп. Если запрос
 * ничего не дал (например, ищут только по группе), кандидатов просто нет —
 * дальше сработает разбор опечаток. Когда список уже сужен фильтрами
 * (категория, поставщик, цена), кандидатов пересекаем с ним. */
function candidateList(list, tokens, qVars) {
  const set = candidates(tokens);
  groupCandidates(qVars, set);
  if (list === state.products) return [...set];
  const allowed = new Set(list);
  return [...set].filter((p) => allowed.has(p));
}

// название без знаков и пробелов — считается один раз на товар
function looseName(p) {
  if (p._nlGen !== gen) { p._nl = stripPunct(norm(p.name)); p._nlGen = gen; }
  return p._nl;
}

/* Дешёвая отбраковка перед разбором опечаток: берём буквосочетания запроса и
 * проверяем обычным поиском подстроки. Это в десятки раз дешевле, чем считать
 * похожесть каждому товару. */
function fuzzyPool(list, q, qVars, seen) {
  const grams = [];
  for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
  const gramsT = [];
  const qT = qVars[1];
  if (qT) for (let i = 0; i < qT.length - 1; i++) gramsT.push(qT.slice(i, i + 2));
  const out = [];
  for (const p of list) {
    if (seen.has(p)) continue;
    // сравниваем с названием БЕЗ знаков: «хатдок» ловит «хот-дог» только так —
    // с дефисом буквосочетание «тд» в названии не встречается
    const name = looseName(p);
    let m = 0;
    for (const g of grams) if (name.includes(g) && ++m >= 2) break;
    if (m < 2 && gramsT.length) {
      m = 0;
      for (const g of gramsT) if (name.includes(g) && ++m >= 2) break;
    }
    if (m >= 2) out.push(p);
  }
  return out;
}

/* Быстрый поиск по цифрам. Оценки берутся те же, что и в общем поиске
 * (код: точно 120, начало 95, внутри 70; без знаков: 118/92/68; название —
 * через общий matchPre), поэтому выдача совпадает — меняется только скорость:
 * полная оценка 17 тысяч товаров занимала около секунды НА КАЖДУЮ НАЖАТУЮ
 * ЦИФРУ, и каталог у кассы казался зависшим. Нечёткий поиск для цифр не нужен:
 * код — вещь точная, «похожий» код хуже, чем честное «ничего не нашлось». */
function searchByCode(list, q) {
  const hits = [];
  for (const p of list) {
    codeFields(p);
    let s = 0;
    for (const c of (p._codes || [])) {
      if (c === q) { s = 120; break; }
      if (c.startsWith(q)) { if (s < 95) s = 95; }
      else if (c.includes(q)) { if (s < 70) s = 70; }
    }
    if (s < 118) {
      for (const c of (p._codesLoose || [])) {
        if (c === q) { s = Math.max(s, 118); break; }
        if (c.startsWith(q)) { if (s < 92) s = 92; }
        else if (c.includes(q)) { if (s < 68) s = 68; }
      }
    }
    // цифры в названии («Молоко 1234 отборное», «Кола 0,5») — теми же правилами,
    // что и обычный поиск по названию
    if (s < 112) s = Math.max(s, matchPre(p._name, p._name, [q], [92, 90, 55], p._nameW, p._nameW, false));
    if (s >= SEARCH_THRESHOLD) hits.push({ p, s });
  }
  if (!hits.length) return [];
  const best = hits.reduce((m, x) => Math.max(m, x.s), 0);
  const floor = Math.max(SEARCH_THRESHOLD, best * RELATIVE_CUTOFF);
  return hits.filter((x) => x.s >= floor)
    .sort((a2, b2) => b2.s - a2.s || cmpRu(a2.p.name, b2.p.name))
    .map((x) => x.p);
}

// слова запроса для подсветки (только буквенно-цифровые, длиннее 1 символа)
export function queryHlTokens() {
  return norm(state.query).split(/\s+/).map((w) => w.replace(/[^0-9a-zа-я]/g, '')).filter((w) => w.length >= 2);
}
