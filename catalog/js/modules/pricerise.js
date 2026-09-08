// «Подорожало» — обратная сторона «Сегодня дешевле», только для своих

/* Покупателю каталог показывает, что подешевело. Владельцу и сотруднику нужно
 * ровно обратное, и по двум разным ценам:
 *   • ЗАКУПОЧНАЯ — сколько мы платим поставщику. Выросла — это прямо наши
 *     деньги, и видно, кто из поставщиков поднял и на сколько.
 *   • РОЗНИЧНАЯ — то, что на ценнике. Сотрудника у полки спрашивают «почему
 *     подорожало», и он должен знать ответ, не бегая к компьютеру.
 * Сотруднику показываем только ценник: закупка — не его дело (см. правило
 * приватности). Владельцу — обе цены рядом.
 *
 * Самое дорогое молчание, которое тут можно допустить: закупка выросла, а
 * ценник остался прежним. Товар продолжает продаваться, всё выглядит нормально,
 * а наценка тает. Такое помечаем отдельно.
 *
 * Считаем по истории цен: она наконец копится (rememberPrice ниже — до
 * 08.09.2026 выгрузка просто затирала вчерашнюю цену) и живёт месяц: старше
 * это уже не новость. Порога нет — владелец просил показывать ЛЮБОЕ
 * изменение, а от разрастания списка спасает тот же месячный срок. */

import { $, state, ui } from './store.js';
import { closeSheet, cmpStr, esc, openSheet, supplierById } from './core.js';
import { fmtPrice, todayISO } from './catalog.js';
import { priceParts } from './card.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { RETAIL_HIST_ROWS, priceStamp, pricesByProduct, pricesOf } from './data.js';

const RISE_DAYS = 30;          // окно новостей — месяц, как просил владелец
const RISE_ROWS = 6;           // столько строк в полосе на главной
const LIST_MAX = 200;          // длиннее список никто не листает

const edgeISO = () => new Date(Date.now() - RISE_DAYS * 86400000).toISOString().slice(0, 10);
const pct = (was, is) => Math.round(((is - was) / was) * 1000) / 10;

/* ── Память цен: почему её раньше не было ───────────────────────────────────
 * Выгрузка из 1С приходит каждый вечер, и до 08.09.2026 новая цена поставщика
 * просто затирала вчерашнюю. Место под историю в каталоге было (карточка её
 * показывает), но заполнить его было нечем: вчерашняя цена исчезала раньше,
 * чем кто-то успевал с ней сравнить. Отсюда и невозможность ответить на самый
 * нужный вопрос — «на сколько и когда подорожало».
 *
 * Указатель строк (idx) приходит снаружи: он строится один раз на весь файл.
 *
 * Теперь так: цена не изменилась — обновляем дату у той же записи (это тот же
 * ценник, просто привезли снова); изменилась — кладём НОВУЮ запись рядом, а
 * старая остаётся с её датой. Сколько таких записей хранить, решает tidyMemory
 * (восемь на поставщика), так что расти бесконечно память не может.
 *
 * Выгрузка задним числом (дата старее той, что уже лежит) историю не трогает:
 * иначе один случайно открытый старый файл переписал бы всё. */
export function rememberPrice(p, sid, info, idx) {
  const date = info.date || null;
  const key = p.id + '|' + sid;
  const rows = idx.get(key) || [];
  let last = null;
  for (const r of rows) if (!last || String(r.price_date || '') > String(last.price_date || '')) last = r;
  const add = () => {
    const row = { product_id: p.id, supplier_id: sid, price: info.price, price_date: date, unit: info.unit || null };
    state.prices.push(row);
    rows.push(row);
    idx.set(key, rows);
  };
  if (!last) { add(); return; }
  if (String(date || '') < String(last.price_date || '')) return;      // файл старее того, что уже знаем
  const same = Number(last.price) === Number(info.price) && (last.unit || '') === (info.unit || '');
  if (same) { last.price_date = date || last.price_date; return; }
  add();
}

/* Указатель для одной загрузки. Строится ОДИН раз на файл: искать нужную
 * строку перебором всего списка цен — значит на прайсе в 25 000 строк сделать
 * триста миллионов сравнений и подвесить телефон на всю вечернюю выгрузку. */
export function priceIndexForImport() {
  const idx = new Map();
  for (const r of (state.prices || [])) {
    const key = r.product_id + '|' + r.supplier_id;
    const cur = idx.get(key);
    if (cur) cur.push(r); else idx.set(key, [r]);
  }
  return idx;
}

/* Ценник менялся — запоминаем прежнюю цену и день, когда мы увидели новую.
 * Даты смены ценника в 1С нет ни в одном файле, поэтому берём день выгрузки:
 * владелец выгружает каждый вечер, значит ошибка — не больше суток. */
export function rememberRetail(p, price) {
  const was = p.retail_price;
  p.retail_price = price;
  if (was == null || was === '' || Number(was) === Number(price) || !(Number(was) > 0)) return;
  state.retailHist = state.retailHist || {};
  const list = state.retailHist[p.id] || [];
  list.unshift({ price: Number(was), at: todayISO() });
  state.retailHist[p.id] = list.slice(0, RETAIL_HIST_ROWS);
}

/* ── Закупка ────────────────────────────────────────────────────────────────
 * Сравниваем ЗА ШТУКУ: поставщик мог перейти со штук на упаковки, тогда само
 * число в прайсе меняется, а цена — нет. Берём поставщика, у которого рост
 * больше всех: именно с ним и предстоит разговор.
 *
 * Строки цен ПРИХОДЯТ ГОТОВЫМИ — только по этому товару. Сама функция по
 * общему списку цен не ходит: в нём двадцать пять тысяч строк, и один такой
 * проход на каждый из двенадцати тысяч товаров вешал приложение намертво
 * (см. «Скорость» в docs/ОШИБКИ.md). */
function costRise(p, rows) {
  if (!p || !rows || rows.length < 2) return null;
  const from = edgeISO();
  const bySup = new Map();
  for (const r of rows) {
    if (!bySup.has(r.supplier_id)) bySup.set(r.supplier_id, []);
    bySup.get(r.supplier_id).push(r);
  }
  let best = null;
  for (const [sid, list] of bySup) {
    if (list.length < 2) continue;
    list.sort((a, b) => cmpStr(String(b.price_date || ''), String(a.price_date || '')));
    const at = String(list[0].price_date || '').slice(0, 10);
    if (!at || at < from) continue;                        // новость старше месяца — не новость
    const now = priceParts(p, list[0]);
    if (!now || !(now.piece > 0)) continue;
    // прежняя цена — первая, что отличается за штуку
    let prev = null;
    for (let i = 1; i < list.length && !prev; i++) {
      const q = priceParts(p, list[i]);
      if (q && q.piece > 0 && q.piece !== now.piece) prev = q;
    }
    if (!prev || prev.piece >= now.piece) continue;        // подешевело — это не наша новость
    const item = { was: prev.piece, is: now.piece, at, pct: pct(prev.piece, now.piece), sid };
    if (!best || item.pct > best.pct) best = item;
  }
  if (best) best.sup = (supplierById(best.sid) || {}).name || '';
  return best;
}

/* ── Ценник ─────────────────────────────────────────────────────────────────
 * История ценника пишется при выгрузке из 1С: там даты смены цены нет, поэтому
 * датой считаем день выгрузки. Владелец выгружает каждый вечер — ошибка не
 * больше суток. */
function retailRise(p) {
  if (!p) return null;
  const is = Number(p.retail_price);
  if (!(is > 0)) return null;
  const rows = (state.retailHist || {})[p.id] || [];
  const from = edgeISO();
  const row = rows.find((r) => Number(r.price) > 0 && Number(r.price) !== is && String(r.at || '') >= from);
  if (!row || Number(row.price) >= is) return null;
  return { was: Number(row.price), is, at: String(row.at).slice(0, 10), pct: pct(Number(row.price), is) };
}

/* ── Наценка тает ───────────────────────────────────────────────────────────
 * Закупка выросла, ценник прежний. Считаем наценку до и после — в этом вся
 * суть: «было 22%, стало 9%» понятнее, чем «закупка +14%».
 * Готовые cost и retail передаются внутрь: пересчитывать их здесь заново — та
 * же лишняя работа, помноженная на весь каталог. */
function marginSqueeze(p, cost, retail) {
  if (!cost || retail) return null;                        // ценник тоже подняли — всё честно
  const sell = Number(p && p.retail_price);
  if (!(sell > 0) || sell <= cost.is) return null;
  return { wasPct: Math.round(((sell - cost.was) / cost.was) * 100), isPct: Math.round(((sell - cost.is) / cost.is) * 100) };
}

/* Кому что видно: сотруднику — только ценник, владельцу — обе цены.
 * Это то же правило, по которому сотруднику не показывают закупку нигде. */
const seesCost = () => !!state.canPurchase;

function riseOf(p, rows) {
  const retail = retailRise(p);
  const cost = seesCost() ? costRise(p, rows || pricesOf(p.id)) : null;
  if (!retail && !cost) return null;
  const squeeze = marginSqueeze(p, cost, retail);
  // «когда» — по самому свежему из двух событий
  const at = [retail && retail.at, cost && cost.at].filter(Boolean).sort().pop();
  return { p, retail, cost, squeeze, at, pct: Math.max(retail ? retail.pct : 0, cost ? cost.pct : 0) };
}

/* ── Список: считаем один раз на каталог ───────────────────────────────────
 * Прежняя редакция обходила ВСЕ товары и для каждого просматривала весь список
 * цен. На настоящем магазине (12 000 товаров, 25 000 строк цен) это давало
 * тридцать пять секунд на одну перерисовку — каталог у вошедшего владельца
 * попросту вис. Теперь два правила, оба из «Скорости» в скиле:
 *   • цены раскладываются по товарам ОДИН раз (указатель), а не ищутся заново;
 *   • кандидаты берутся из самих данных — товар без второй цены и без
 *     изменения ценника в список даже не заглядывает.
 * Ответ помнится, пока не приехал новый каталог: сверяем по тем же ссылкам на
 * массивы, что и остальной кэш приложения. */
let riseCache = { stamp: -1, products: null, retail: null, session: null, can: null, list: [] };

function refreshRise() {
  /* Держим один и тот же объект, а не создаём новый пустой при каждом вызове:
     иначе сверка «те же данные?» не совпадала бы никогда и всё считалось бы
     заново на каждой перерисовке — ровно та беда, от которой этот кэш и есть. */
  if (!state.retailHist) state.retailHist = {};
  if (riseReady()) return;
  const retail = state.retailHist;
  const byId = pricesByProduct();
  const out = [];
  if (state.session) {
    // кандидаты: у кого есть вторая цена либо менялся ценник — остальных не трогаем
    const ids = new Set(Object.keys(retail));
    if (seesCost()) for (const [id, rows] of byId) if (rows.length > 1) ids.add(id);
    for (const p of state.products) {
      if (!ids.has(p.id)) continue;
      const r = riseOf(p, byId.get(p.id) || []);
      if (r) out.push(r);
    }
    out.sort((a, b) => b.pct - a.pct);
  }
  riseCache = { stamp: priceStamp(), products: state.products, retail, session: !!state.session, can: seesCost(), list: out.slice(0, LIST_MAX) };
}

/* Первый расчёт после нового каталога — не на горячем пути. Он занимает
 * заметную долю секунды на бюджетном телефоне, а полоса «Подорожало» не
 * настолько срочная, чтобы ради неё замирал главный экран: посчитаем в
 * свободную минуту и дорисуем. Там, где ответ нужен прямо сейчас (экран
 * «Подорожало», карточка товара), считаем сразу — человек сам туда нажал. */
let riseIdle = 0;
function riseWhenIdle(after) {
  if (riseIdle) return;
  const run = () => { riseIdle = 0; refreshRise(); after(); };
  riseIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 60);
}

const riseReady = () => riseCache.stamp === priceStamp()
  && riseCache.products === state.products
  && riseCache.retail === state.retailHist
  && riseCache.session === !!state.session
  // роль решает, видно ли закупку: сменился вход — список нужно пересобрать
  && riseCache.can === seesCost();

function risenList() {
  refreshRise();
  return riseCache.list;
}

export const riseCount = () => risenList().length;

// одна строка «было → стало, дата» — общий вид для полосы, списка и карточки
function riseText(kind, r) {
  return `${kind}: ${fmtPrice(r.was)} → ${fmtPrice(r.is)} (+${String(r.pct).replace('.', ',')}%) · ${whenText(r.at)}`;
}

/* Дата словами: «сегодня», «вчера», иначе числом. У полки человек думает
 * днями, а не датами. */
function whenText(at) {
  const d = new Date(String(at) + 'T00:00:00');
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - d.getTime()) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/* ── Строка в карточке товара ───────────────────────────────────────────── */
export function riseHtml(p) {
  const r = riseOf(p);
  if (!r) return '';
  const lines = [];
  if (r.retail) lines.push(riseText('Ценник', r.retail));
  if (r.cost) lines.push(riseText(`Закупка${r.cost.sup ? ' · ' + r.cost.sup : ''}`, r.cost));
  if (r.squeeze) lines.push(`Ценник не меняли — наценка упала с ${r.squeeze.wasPct}% до ${r.squeeze.isPct}%`);
  return `<div class="rise-box">${ic('warn', 'ic-xs')}<div>${lines.map((t) => `<div>${esc(t)}</div>`).join('')}</div></div>`;
}

/* ── Полоса на главной ──────────────────────────────────────────────────────
 * Ровно там же, где у покупателя «Сегодня дешевле», и по тем же правилам:
 * прячется, как только человек начал искать или фильтровать — иначе она лезет
 * в глаза поверх результата. */
export function renderRiseStrip() {
  ui.renderRiseStrip = renderRiseStrip;
  const box = $('riseStrip');
  if (!box) return;
  const show = state.session && state.tab === 'catalog' && !state.query && !state.favOnly && !ui.anyFilter();
  if (!state.retailHist) state.retailHist = {};
  if (show && !riseReady()) { riseWhenIdle(renderRiseStrip); box.hidden = true; return; }
  const list = show ? risenList() : [];
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  const rows = list.slice(0, RISE_ROWS).map((r) => {
    const main = r.cost || r.retail;
    return `<button class="arr-row" data-similar="${esc(r.p.id)}">
      <span class="arr-name">${esc(r.p.name)}</span>
      <span class="arr-price rise-up">+${String(main.pct).replace('.', ',')}%
        <span class="card-was">${esc(fmtPrice(main.was))}</span></span></button>`;
  }).join('');
  box.innerHTML = `<div class="arr-head">
      <span class="arr-title">Подорожало</span>
      <span class="arr-when">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')}</span>
    </div>
    <div class="arr-list">${rows}</div>`;
  box.hidden = false;
}

/* ── Отдельный экран во вкладке «Работа» ────────────────────────────────── */
function renderRisen() {
  const box = $('risenBody');
  if (!box) return;
  const list = risenList();
  if (!list.length) {
    box.innerHTML = `<p class="ios-note">За месяц цены не менялись — ни на ценнике, ни у поставщиков.
      Список заполнится сам после ближайшей выгрузки из 1С.</p>`;
    return;
  }
  const squeezed = list.filter((r) => r.squeeze).length;
  box.innerHTML = `
    <div class="ord-total">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')} подорожало за месяц${
  squeezed ? ` · у ${squeezed} ${plural(squeezed, 'него', 'них', 'них')} ценник не меняли` : ''}</div>
    <div class="ios-group">${list.map((r) => {
    const lines = [];
    if (r.retail) lines.push(riseText('Ценник', r.retail));
    if (r.cost) lines.push(riseText(`Закупка${r.cost.sup ? ' · ' + r.cost.sup : ''}`, r.cost));
    if (r.squeeze) lines.push(`наценка упала с ${r.squeeze.wasPct}% до ${r.squeeze.isPct}%`);
    const main = r.cost || r.retail;
    return `<button class="ios-row ios-row-link" data-rise-open="${esc(r.p.id)}">
        <span class="ios-row-title">${esc(r.p.name)}
          <span class="ord-sub">${esc(lines.join(' · '))}</span></span>
        <span class="ios-row-value rise-up">+${String(main.pct).replace('.', ',')}%</span>
      </button>`;
  }).join('')}</div>
    <p class="ios-note">Сверху то, что подорожало сильнее. Даты берутся из выгрузок 1С;
    история хранится месяц, потом стирается сама.</p>`;
}

function openRisen() {
  renderRisen();
  openSheet('risenSheet');
}

export function bindPriceRise(openProduct) {
  ui.workActions = ui.workActions || {};
  ui.workActions.risen = openRisen;
  $('risenBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rise-open]');
    if (!b) return;
    closeSheet('risenSheet');
    const p = state.products.find((x) => x.id === b.dataset.riseOpen);
    if (p) openProduct(p);
  });
}
