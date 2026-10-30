// Разведка цен: другие магазины

import { $, state, ui } from './store.js';
import { closeSheet, esc, norm, openSheet, toast } from './core.js';
import { checkMark, ic } from './icons.js';
import { fmtDate, fmtPrice } from './catalog.js';
import { ghConfigured, publishFull } from './publish.js';
import { parsePriceNum } from './imports.js';

/* ── Разведка цен: сравнение с другими магазинами ──────
 * Любой вошедший сотрудник может внести розничную цену товара в чужом
 * магазине. В карточке видно нашу цену и цены конкурентов с датой. */

function competitorById(id) { return state.competitors.find((c) => c.id === id) || null; }
function competitorName(id) { const c = competitorById(id); return c ? c.name : 'Магазин'; }
// «1 цена / 2 цены / 5 цен» — по-русски
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Фильтр цен магазинов внутри карточки товара (свой для каждого открытия)
function compRowsFor(pid) {
  return (state.compPrices || [])
    .filter((r) => r.product_id === pid)
    .filter((r) => !ui.compFilter.store || r.competitor_id === ui.compFilter.store)
    .filter((r) => !ui.compFilter.from || String(r.observed_at || '') >= ui.compFilter.from)
    .filter((r) => !ui.compFilter.to || String(r.observed_at || '') <= ui.compFilter.to)
    .slice()
    .sort((a, b) => Number(a.price) - Number(b.price));
}

// Итог сравнения одной понятной строкой: раньше цены конкурентов лежали
// столбиком и сравнивать приходилось глазами. По каждому магазину берём
// САМУЮ СВЕЖУЮ запись — цена, записанная полгода назад, ничего не значит.
function compVerdict(our, all) {
  if (our == null || !all.length) return '';
  const latest = new Map();
  for (const r of all) {
    const cur = latest.get(r.competitor_id);
    if (!cur || String(r.observed_at || '') > String(cur.observed_at || '')) latest.set(r.competitor_id, r);
  }
  const list = [...latest.values()].filter((r) => Number(r.price) > 0);
  if (!list.length) return '';
  const cheap = list.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  const cp = Number(cheap.price);
  const who = esc(competitorName(cheap.competitor_id));
  const d = fmtDate(cheap.observed_at);
  const n = list.length;
  const sub = `<span class="comp-v-sub">сравнили с ${n} ${plural(n, 'магазином', 'магазинами', 'магазинами')}${d ? ` · запись от ${d}` : ''}</span>`;
  if (cp > our) return `<div class="comp-verdict comp-v-good">${ic('check', 'ic-xs')} У нас дешевле всех — на ${esc(fmtPrice(cp - our))} дешевле, чем в магазине «${who}» ${sub}</div>`;
  if (cp === our) return `<div class="comp-verdict">У нас цена как у самых дешёвых — в магазине «${who}» столько же ${sub}</div>`;
  return `<div class="comp-verdict comp-v-bad">${ic('warn', 'ic-xs')} Дешевле в магазине «${who}» — ${esc(fmtPrice(cp))}, это на ${esc(fmtPrice(our - cp))} меньше нашей ${sub}</div>`;
}

// Цены в других магазинах. Видят ВСЕ (в том числе покупатель без входа),
// вносит любой вошедший — владелец или сотрудник.
export function renderCompetitors(p) {
  const box = $('sheetCompetitors');
  if (!box) return;
  // Цены чужих магазинов — внутренняя разведка магазина, а не витрина.
  // Покупателю их показывать нельзя: каталог прямым текстом сообщал ему,
  // где тот же товар дешевле, и отправлял к конкуренту.
  if (!state.session) { box.innerHTML = ''; return; }
  const our = (p.retail_price != null && p.retail_price !== '') ? Number(p.retail_price) : null;
  const all = (state.compPrices || []).filter((r) => r.product_id === p.id);
  const rows = compRowsFor(p.id);
  const canAdd = !!state.session; // вошедший сотрудник или владелец

  const ourRow = `<div class="comp-row comp-ours">
    <span class="comp-store">Наш магазин</span>
    <span class="comp-price">${our != null ? esc(fmtPrice(our)) : '<span class="muted" style="margin:0">цена не указана</span>'}</span>
  </div>`;

  // выпадающий список магазинов — только те, по которым есть записи об этом товаре
  const storeIds = [...new Set(all.map((r) => r.competitor_id))];
  const filterBar = storeIds.length > 1 || all.length > 1 ? `<div class="comp-filter">
    <select class="input comp-f-store" id="compFStore" aria-label="Магазин">
      <option value="">Все магазины</option>
      ${storeIds.map((id) => `<option value="${esc(id)}"${ui.compFilter.store === id ? ' selected' : ''}>${esc(competitorName(id))}</option>`).join('')}
    </select>
    <div class="comp-filter-dates">
      <input type="date" class="input" id="compFFrom" value="${esc(ui.compFilter.from)}" aria-label="Записано с">
      <span class="price-dash">—</span>
      <input type="date" class="input" id="compFTo" value="${esc(ui.compFilter.to)}" aria-label="Записано по">
    </div>
  </div>` : '';

  let list;
  if (!all.length) {
    list = '<p class="muted" style="margin:6px 0 0">Цен других магазинов пока никто не записал.</p>';
  } else if (!rows.length) {
    list = '<p class="muted" style="margin:6px 0 0">По этому фильтру записей нет — поменяй магазин или даты.</p>';
  } else {
    list = rows.map((r) => {
      const price = Number(r.price);
      let diff = '';
      if (our != null) {
        if (price < our) diff = `<span class="comp-diff comp-cheaper">у них дешевле на ${esc(fmtPrice(our - price))}</span>`;
        else if (price > our) diff = `<span class="comp-diff comp-dearer">у них дороже на ${esc(fmtPrice(price - our))}</span>`;
        else diff = '<span class="comp-diff">такая же цена</span>';
      }
      return `<div class="comp-row">
        <span class="comp-store">${esc(competitorName(r.competitor_id))}<span class="comp-date">записано ${esc(fmtDate(r.observed_at))}</span></span>
        <span class="comp-price">${esc(fmtPrice(price))}${diff}</span>
      </div>`;
    }).join('');
  }

  box.innerHTML = `<div class="comp-block">
    <div class="comp-title">Цены в других магазинах</div>
    ${compVerdict(our, all)}${filterBar}${ourRow}${list}
    ${canAdd ? '<button class="btn btn-secondary btn-block" id="compAddBtn">Записать цену магазина</button>' : ''}
  </div>`;
}

// ── Экран «Цены других магазинов»: сводка по магазинам и цены одного магазина ──
export function renderCompStores() {
  const box = $('compStoresList');
  if (!box) return;
  const prices = state.compPrices || [];
  if (!prices.length) {
    box.innerHTML = '<p class="muted">Пока никто не записал ни одной цены. Открой любой товар и нажми «Записать цену магазина».</p>';
    return;
  }
  const byStore = new Map();
  for (const r of prices) {
    const cur = byStore.get(r.competitor_id) || { n: 0, last: '' };
    cur.n++;
    if (String(r.observed_at || '') > cur.last) cur.last = String(r.observed_at || '');
    byStore.set(r.competitor_id, cur);
  }
  const rows = [...byStore.entries()].sort((a, b) => b[1].n - a[1].n);
  box.innerHTML = rows.map(([id, st]) => `<button type="button" class="btn btn-secondary btn-block comp-store-btn" data-comp-view="${esc(id)}">
      <span class="comp-store">${esc(competitorName(id))}<span class="comp-date">последняя запись ${esc(fmtDate(st.last))}</span></span>
      <span class="comp-store-n">${st.n} ${plural(st.n, 'цена', 'цены', 'цен')}</span>
    </button>`).join('');
}

export function openCompStoreView(storeId) {
  const rows = (state.compPrices || []).filter((r) => r.competitor_id === storeId)
    .slice().sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')));
  $('compStoreViewTitle').textContent = competitorName(storeId);
  const body = $('compStoreViewBody');
  body.innerHTML = rows.length ? rows.map((r) => {
    const p = state.products.find((x) => x.id === r.product_id);
    const our = p && p.retail_price != null && p.retail_price !== '' ? Number(p.retail_price) : null;
    const price = Number(r.price);
    let diff = '';
    if (our != null) {
      if (price < our) diff = `<span class="comp-diff comp-cheaper">у них дешевле на ${esc(fmtPrice(our - price))}</span>`;
      else if (price > our) diff = `<span class="comp-diff comp-dearer">у них дороже на ${esc(fmtPrice(price - our))}</span>`;
      else diff = '<span class="comp-diff">такая же цена</span>';
    }
    return `<div class="comp-row">
      <span class="comp-store">${esc(p ? p.name : 'Товар удалён')}<span class="comp-date">записано ${esc(fmtDate(r.observed_at))}${our != null ? ' · у нас ' + esc(fmtPrice(our)) : ''}</span></span>
      <span class="comp-price">${esc(fmtPrice(price))}${diff}</span>
    </div>`;
  }).join('') : '<p class="muted">По этому магазину записей нет.</p>';
  openSheet('compStoreViewSheet');
}

export function openCompetitorAdd(p) {
  ui.compProduct = p;
  ui.compChosenId = null;
  $('compProductName').textContent = p.name;
  $('compStoreSearch').value = '';
  $('compPrice').value = '';
  $('compError').hidden = true;
  $('compChosen').hidden = true;
  renderCompStoreList();
  openSheet('competitorAddSheet');
}

export function showCompChosen() {
  const c = competitorById(ui.compChosenId);
  const box = $('compChosen');
  if (c) { box.textContent = 'Магазин: ' + c.name; box.hidden = false; }
  else box.hidden = true;
  renderCompStoreList();
  $('compPrice').focus();
}

export function renderCompStoreList() {
  const q = norm($('compStoreSearch').value);
  const typed = $('compStoreSearch').value.trim();
  const filtered = q ? state.competitors.filter((c) => norm(c.name).includes(q)) : state.competitors;
  let html = filtered.slice(0, 30).map((c) => {
    const on = ui.compChosenId === c.id;
    return `<button type="button" class="btn btn-secondary btn-block${on ? ' picked' : ''}" data-comp-store="${esc(c.id)}">
      ${on ? checkMark : ''}${esc(c.name)}</button>`;
  }).join('');
  // предложить создать новый магазин из введённого текста
  const exists = filtered.some((c) => norm(c.name) === q);
  if (typed && !exists) {
    html += `<button type="button" class="btn btn-secondary btn-block comp-new" data-comp-new="${esc(typed)}">Создать магазин «${esc(typed)}»</button>`;
  }
  if (!html) html = '<p class="muted">Начни вводить название магазина</p>';
  $('compStoreList').innerHTML = html;
}

export async function submitCompetitorPrice(e) {
  e.preventDefault();
  const btn = $('compSubmit');
  const price = parsePriceNum($('compPrice').value);
  if (price == null) { $('compError').textContent = 'Впиши цену числом'; $('compError').hidden = false; return; }
  if (!ui.compChosenId) { $('compError').textContent = 'Выбери или создай магазин'; $('compError').hidden = false; return; }
  btn.disabled = true;
  const record = {
    product_id: ui.compProduct.id,
    competitor_id: ui.compChosenId,
    price,
    observed_at: new Date().toISOString().slice(0, 10),
  };
  try {
    // Цену за сегодня по этому магазину перезаписываем, прошлые даты
    // остаются — так видно, как цена менялась.
    const i = (state.compPrices || []).findIndex((r) => r.product_id === record.product_id
      && r.competitor_id === record.competitor_id && r.observed_at === record.observed_at);
    if (i >= 0) state.compPrices[i] = record; else (state.compPrices = state.compPrices || []).push(record);
    if (!ghConfigured()) throw new Error('нет ключа публикации — открой «Публикация на GitHub» в меню и вставь ключ');
    // Цены чужих магазинов едут в зашифрованный каталог, а не в открытый файл.
    if (!ui.secretPw) throw new Error('сохранить цену магазина может владелец — у сотрудника нет доступа к публикации');
    await publishFull(ui.secretPw);
    closeSheet('competitorAddSheet');
    toast('Цена магазина сохранена');
    if (ui.currentProduct === ui.compProduct) renderCompetitors(ui.compProduct);
  } catch (err) {
    $('compError').textContent = 'Не удалось сохранить: ' + (err.message || err);
    $('compError').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// Покупатель без аккаунта предлагает фото — попадает в очередь на проверку,
// видно всем станет после одобрения сотрудником (защита витрины от плохих фото)
