// Карточка товара: цены, остаток, калькулятор, поставщики

import { $, state, ui } from './store.js';
import { closeSheet, esc, groupById, norm, openSheet, supplierById, toast, moneyNum } from './core.js';
import { ic, warnMark } from './icons.js';
import { STALE_PRICE_DAYS, fmtDate, fmtNum, fmtPrice, fmtRetail, hasPhoto, isFreshPrice, isTopSeller, priceAgeDays, telHref, updatedText } from './catalog.js';
import { waHref } from './whatsapp.js';
import { isFav, pushRecentProduct, renderNewProducts, stockLabel } from './render.js';
import { ratingText, reviewsHtml } from './reviews.js';
import { trackView } from './device.js';
import { ghConfigured } from './publish.js';
import { plural, renderCompetitors } from './competitors.js';
import { inCompare, renderCompareBar } from './compare.js';
import { inRestock } from './restock.js';
import { syncShopButton } from './shopping.js';
import { syncWaitButton } from './news.js';
import { feature } from './brand.js';
import { daysBetween } from './admin.js';
import { barcodeSortKey, fmtBarcodeUnit, parseBarcodeUnit, svSaveAndPublish } from './imports.js';

/* ── Карточка товара ──────────────────────────── */

export function updateFavButton(p) {
  const b = $('btnFav');
  if (!b) return;
  const on = isFav(p.id);
  b.classList.toggle('is-fav', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Убрать из избранного' : 'В избранное';
}

export function openProduct(p) {
  ui.currentProduct = p;
  pushRecentProduct(p.id);
  trackView(p); // анонимный учёт: товар открыли (для «Популярного»)
  { const b = $('btnCompareAdd'); if (b) b.textContent = inCompare(p.id) ? 'Убрать из сравнения' : 'К сравнению'; }
  { const b = $('btnRestock'); if (b) b.textContent = inRestock(p.id) ? 'Убрать из списка пополнения' : 'Закончилось на полке'; }
  syncShopButton(p);            // «в список покупок» / «убрать» — для покупателя
  syncWaitButton(p);            // «сообщить, когда появится» — если товара нет
  renderCompareBar();
  renderNewProducts();   // обновляем ленту под шторкой
  updateFavButton(p);
  $('sheetName').textContent = p.name;

  // Покупателю (тот, кто не вводил пароль) фотографии не показываем: решение
  // владельца — у него каталог списком, только нужные сведения.
  const photos = state.session ? (p.photos || []).filter((u) => u && String(u).trim()) : [];
  $('sheetPhotos').hidden = !state.session;
  $('sheetDots').hidden = !state.session;
  $('sheetPhotos').innerHTML = photos.length
    ? photos.map((u) => `<img src="${esc(u)}" alt="" onerror="wmImgFail(this)">`).join('')
    : `<div class="photo-placeholder">${ic('box', 'ic-ph')}</div>`;
  $('sheetDots').innerHTML = photos.length > 1
    ? photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')
    : '';
  $('sheetPhotos').scrollLeft = 0;

  // без входа (обычный покупатель) — показываем только «магазинные» метки:
  // категорию и «весовой/продаётся». Внутренние (штрихкода нет и т.п.) — сотрудникам.
  const badges = [];
  const g = groupById(p.group_id);
  if (g) badges.push(`<span class="tag">${esc(g.name)}</span>`);
  // наличие — первым: покупателю это важнее всего остального
  const sl = stockLabel(p);
  if (sl) badges.unshift(`<span class="tag ${sl.cls}">${sl.txt}</span>`);
  if (p.is_weighted) badges.push(`<span class="tag">${ic('scale', 'ic-xs')} Весовой товар</span>`);
  // «часто берут» — подсказка покупателю, чем выбирают соседи. Без цифр
  if (!state.session && isTopSeller(p)) badges.push('<span class="tag tag-hit">Часто берут</span>');
  if (p.unit && norm(p.unit) !== 'шт') badges.push(`<span class="tag">Продаётся: ${esc(p.unit)}</span>`);
  const barcodes = p.barcodes || [];
  if (state.session && !barcodes.length) badges.push(`<span class="tag tag-nobarcode">${ic('warn', 'ic-xs')} Штрихкода нет — пробивать по коду</span>`);
  /* Когда данные обновились. Владелец выгружает из 1С раз в день вечером,
     значит утром человек смотрит на вчерашние остатки. Пишем прямо — пусть
     сам решит, доверять ли наличию. Есть только у покупателя: у вошедшего
     каталог берётся не из витрины, а из своего файла. */
  // оценка соседей — первой после наличия: по ней выбирают
  const rt = ratingText(p);
  if (rt) badges.splice(1, 0, `<span class="tag tag-rating">${ic('star', 'ic-xs')} ${esc(rt)}</span>`);
  const upd = updatedText();
  if (upd) badges.push(`<span class="tag tag-when">Обновлено ${esc(upd)}</span>`);
  $('sheetBadges').innerHTML = badges.join('');

  // описание товара (под названием, видно всем — как в витрине магазина)
  const desc = $('sheetDescription');
  if (p.description && String(p.description).trim()) { desc.textContent = p.description; desc.hidden = false; }
  else { desc.textContent = ''; desc.hidden = true; }

  // поставщики и цены — единым списком ниже (renderProductPrices); отдельный блок не нужен
  $('sheetSupplier').innerHTML = '';

  const rows = [];
  // розничная цена (цена на полке) — видна всем, крупно вверху
  if (p.retail_price != null && p.retail_price !== '') {
    rows.push(`<div class="field-hero"><span class="field-hero-val">${esc(fmtRetail(p))}</span></div>`);
  }
  // коды кассы/артикул/штрихкод/отдел/примечание — это внутренние данные магазина,
  // покупателям без входа их не показываем
  // код товара виден всем — по нему покупатель объяснит кассиру, что берёт
  if (p.code) rows.push(fieldRow('Код товара', p.code, false, true));
  // когда товар завезли — видно всем: покупателю это говорит о свежести
  if (p.arrival_at) rows.push(fieldRow('Поступил', fmtDate(p.arrival_at)));
  if (state.session) {
    if (p.article) rows.push(fieldRow('Артикул', p.article, false, true));
    // У товара может быть несколько штрихкодов: на штуку, на упаковку, на блок.
    // Подписываем каждый по-человечески («упаковка — 24 шт»), штучный — первым.
    const bcOrdered = barcodes.slice().sort((x, y) => {
      const a = barcodeSortKey(p, x); const b2 = barcodeSortKey(p, y);
      return a[0] - b2[0] || a[1] - b2[1];
    });
    bcOrdered.forEach((b, i) => {
      const label = fmtBarcodeUnit((p.barcode_units || {})[b]);
      rows.push(fieldRow(label ? `Штрихкод · ${label}` : (bcOrdered.length > 1 ? `Штрихкод ${i + 1}` : 'Штрихкод'), b, false, true));
    });
    // Фасовки отдельной строкой НЕ показываем: те же «штука» и «упаковка — 48 шт»
    // уже подписаны у штрихкодов. Строка нужна, только если штрихкодов нет вовсе.
    const packs = (p.pack_units || []).filter((u) => u && u.unit);
    if (!bcOrdered.length && packs.length > 1) {
      const list = packs.map((u) => fmtBarcodeUnit(u.unit)).filter(Boolean).join(' · ');
      if (list) rows.push(fieldRow('Фасовки', list));
    }
    if (p.department) rows.push(fieldRow('Отдел', p.department));
    if (p.note) rows.push(`<div class="field-row"><span class="field-key">Примечание</span><span class="field-val" style="font-weight:400;font-size:14px">${esc(p.note)}</span></div>`);
  }
  if (!rows.length && state.session) rows.push('<div class="field-row"><span class="field-key">Коды не указаны</span></div>');
  $('sheetFields').innerHTML = rows.join('');

  $('sheetAdminActions').hidden = !state.isAdmin;
  // фото пока грузятся только на сервере — в бесплатном режиме кнопки прячем
  $('btnFindPhoto').hidden = !(state.isAdmin && !hasPhoto(p));
  $('sheetMarkup').innerHTML = '';
  ui.cardSuppliers = {}; ui.cardSales = null;
  renderStock(p, null);   // остаток виден сразу; продажи дорисуют «сколько заказать»
  renderProductSales(p);
  renderProductPrices(p);
  ui.compFilter = { store: '', from: '', to: '' };
  renderCompetitors(p);
  // отзывы соседей — под всем остальным: сначала цена и наличие, потом слова
  const rev = $('sheetReviews');
  if (rev) rev.innerHTML = reviewsHtml(p);
  renderSimilar(p);
  openSheet('productSheet');
}

/* ── Поделиться товаром + похожие + ссылка на товар ── */
const productLink = (p) => `${location.origin}${location.pathname}#p=${encodeURIComponent(p.id)}`;

export async function shareProduct(p) {
  const url = productLink(p);
  const priceTxt = (p.retail_price != null && p.retail_price !== '') ? `\n${fmtRetail(p)}` : '';
  try {
    if (navigator.share) { await navigator.share({ title: p.name, text: `${p.name}${priceTxt}`, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; /* пользователь закрыл — не ошибка */ }
  try { await navigator.clipboard.writeText(url); toast('Ссылка на товар скопирована'); }
  catch (e) { toast('Ссылка: ' + url); }
}

// Похожие товары — ПО НАЗВАНИЮ: совпадают слова в наименовании, особенно
// первое слово (обычно бренд): «Агуша …» → другие «Агуша …».
const nameWords = (n) => norm(n || '').split(/[^0-9a-zа-яё]+/i).filter((w) => w.length >= 3);
function renderSimilar(p) {
  const box = $('sheetSimilar');
  if (box && !state.session) { box.innerHTML = ''; return; }   // лента с фото — не для покупателя
  if (!box) return;
  const pw = nameWords(p.name);
  if (!pw.length) { box.innerHTML = ''; return; }
  const pset = new Set(pw);
  const first = pw[0];
  const scored = [];
  for (const x of state.products) {
    if (x.id === p.id) continue;
    const xw = nameWords(x.name);
    if (!xw.length) continue;
    let shared = 0;
    for (const w of xw) if (pset.has(w)) shared++;
    if (!shared) continue; // нет общих слов названия — не похож
    let score = shared;
    if (xw[0] === first) score += 5; // совпал бренд/первое слово — сильно ближе
    scored.push({ x, score });
  }
  // по близости названия, затем сначала с фото
  scored.sort((a, b) => (b.score - a.score) || ((hasPhoto(b.x) ? 1 : 0) - (hasPhoto(a.x) ? 1 : 0)));
  const list = scored.slice(0, 12).map((s) => s.x);
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="similar-title">Похожие товары</div><div class="similar-row">'
    + list.map((x) => {
      const ph = (x.photos || []).find((u) => u && String(u).trim());
      const price = (x.retail_price != null && x.retail_price !== '') ? `<span class="similar-price">${esc(fmtRetail(x))}</span>` : '';
      return `<button class="similar-card" data-similar="${esc(x.id)}">
        <span class="similar-photo${ph ? '' : ' no-photo'}">${ph ? `<img src="${esc(ph)}" loading="lazy" alt="" onerror="wmImgFail(this)">` : ic('box', 'ic-ph')}</span>
        <span class="similar-name">${esc(x.name)}</span>${price}</button>`;
    }).join('') + '</div>';
}

// открыть товар по ссылке вида …/#p=<id> (после загрузки каталога)
export function openFromHash() {
  const m = String(location.hash || '').match(/[#&]p=([^&]+)/);
  if (!m) return;
  const id = decodeURIComponent(m[1]);
  // уже открыт нужный товар — ничего не делаем (защита от повторов)
  if (ui.currentProduct && ui.currentProduct.id === id && !$('productSheet').hidden) return;
  const p = state.products.find((x) => x.id === id);
  if (p) openProduct(p);
}
// если ссылку открыли, уже находясь в каталоге (меняется только #hash, без
// перезагрузки страницы) — тоже показываем товар
window.addEventListener('hashchange', openFromHash);

/* ── Продажи товара в карточке (для заказа) ────────
 * После входа: сколько штук продано за 7 и 30 дней и в среднем в день —
 * помогает решить, сколько заказывать. Деньги не показываем — только штуки. */

const SALES_CACHE_KEY = 'wm_sales_cache_v1';

function renderSalesBox(p, s, stale) {
  const u = p.unit || 'шт';
  const round = (n) => (n % 1 ? Math.round(n * 10) / 10 : n);
  const days = daysBetween(s.period_from, s.period_to);
  const perDay = round(Number(s.qty) / days);
  $('sheetSales').innerHTML = `<div class="sales-block">
    <div class="sec-title">Продажи · ${fmtDate(s.period_from)} — ${fmtDate(s.period_to)}${stale ? ' <span class="sales-stale">· без связи</span>' : ''}</div>
    <div class="sales-line"><span><b>${fmtNum(round(Number(s.qty)))}</b> ${esc(u)}</span><span><b>${fmtNum(perDay)}</b> ${esc(u)} в день</span></div>
  </div>`;
  // продажи известны — пересобираем остаток уже с подсказкой «сколько заказать»
  ui.cardSales = { perDay: Number(s.qty) / days, periodTo: s.period_to };
  renderStock(p, ui.cardSales);
}

/* ── Калькулятор цены поставщика ───────────────────
 * Пришёл новый поставщик и обещает выгодную цену. Считать в уме мешает то,
 * что цены у всех в разных единицах: у одного за штуку, у другого за
 * коробку, третий обещает «минус 5%». Калькулятор приводит предложение к
 * цене за штуку и сразу показывает разницу со всеми, кто уже есть,
 * наценку при нашей рознице и выгоду за месяц по нашим продажам. */

function calcBase(p) { return p && p.is_weighted ? 'кг' : (p && p.unit ? p.unit : 'шт'); }

export function openPriceCalc(p) {
  ui.calcProduct = p;
  const mp = mainPack(p);
  const base = calcBase(p);
  $('calcProductName').textContent = p.name;
  $('calcUnitPieceLabel').textContent = base === 'кг' ? 'За кг' : 'За штуку';
  $('calcPackLabel').textContent = base === 'кг' ? 'Кг в упаковке' : 'Штук в упаковке';
  $('calcPrice').value = '';
  $('calcDiscount').value = '';
  $('calcPackQty').value = mp ? mp.qty : '';
  // если упаковка известна — обычно её цену и называют; иначе считаем за штуку
  const want = mp ? 'pack' : 'piece';
  for (const r of document.querySelectorAll('input[name="calcUnit"]')) r.checked = (r.value === want);
  renderCalcResult();
  openSheet('calcSheet');
  setTimeout(() => $('calcPrice').focus(), 250);
}

// Чистый расчёт: что получится из введённого предложения.
export function calcOffer(raw, perPack, packQty, discount) {
  // сумма может прийти из поля с разделителями: «1 850» — это 1850
  const price = typeof raw === 'number' ? raw : moneyNum(raw);
  if (!Number.isFinite(price) || price <= 0) return null;
  const disc = Number(discount);
  const net = price * (1 - (Number.isFinite(disc) && disc > 0 && disc < 100 ? disc / 100 : 0));
  const q = Number(packQty);
  const hasPack = Number.isFinite(q) && q > 0;
  if (perPack) {
    if (!hasPack) return null;                 // «за упаковку», но сколько в ней — не сказано
    return { piece: net / q, pack: net, packQty: q, net };
  }
  return { piece: net, pack: hasPack ? net * q : null, packQty: hasPack ? q : null, net };
}

export function renderCalcResult() {
  const box = $('calcResult');
  const p = ui.calcProduct;
  if (!box || !p) return;
  const perPack = (document.querySelector('input[name="calcUnit"]:checked') || {}).value === 'pack';
  $('calcPackWrap').hidden = false; // количество в упаковке нужно в обоих режимах
  const o = calcOffer($('calcPrice').value, perPack, $('calcPackQty').value, $('calcDiscount').value);
  if (!o) {
    box.innerHTML = perPack && $('calcPrice').value
      ? '<p class="muted calc-hint">Укажи, сколько штук в упаковке — иначе цену за штуку не посчитать.</p>'
      : '<p class="muted calc-hint">Введи цену — покажу разницу со всеми поставщиками.</p>';
    return;
  }
  const base = calcBase(p);
  const parts = [];

  const packTxt = o.packQty ? ` · <b>${esc(fmtPrice(o.pack))}</b> за упаковку (${fmtNum(o.packQty)} ${esc(base)})` : '';
  parts.push(`<div class="calc-out calc-main"><b>${esc(fmtPiecePrice(o.piece))}</b> за ${esc(base)}${packTxt}</div>`);

  // С кем сравниваем: ТОЛЬКО свежие цены. Цена без поступления больше месяца
  // — это уже не цена, а воспоминание: поставщик её давно мог поменять, и
  // сравнивать с ней новое предложение значит обманывать себя.
  const mine = Object.values(ui.cardSuppliers || {}).filter((e) => e && e.parts && e.prod === p);
  const toRow = (e) => ({ name: e.sup.name, piece: e.parts.piece, date: e.last ? e.last.price_date : null });
  const rivals = mine.filter((e) => e.fresh).map(toRow).sort((a, b) => a.piece - b.piece);
  const stale = mine.filter((e) => !e.fresh).map(toRow).sort((a, b) => a.piece - b.piece);
  const best = rivals.length ? rivals[0] : null;

  if (best) {
    const diff = o.piece - best.piece;
    const pct = Math.round((Math.abs(diff) / best.piece) * 1000) / 10;
    if (diff < 0) {
      parts.push(`<div class="calc-out calc-good">${ic('check', 'ic-xs')} Дешевле лучшей цены на <b>${esc(fmtPiecePrice(-diff))}</b> за ${esc(base)} (−${fmtNum(pct)}%)<span class="calc-sub">сейчас лучшая — «${esc(best.name)}», ${esc(fmtPiecePrice(best.piece))}</span></div>`);
    } else if (diff > 0) {
      parts.push(`<div class="calc-out calc-bad">${ic('close', 'ic-xs')} Дороже лучшей цены на <b>${esc(fmtPiecePrice(diff))}</b> за ${esc(base)} (+${fmtNum(pct)}%)<span class="calc-sub">сейчас лучшая — «${esc(best.name)}», ${esc(fmtPiecePrice(best.piece))}</span></div>`);
    } else {
      parts.push(`<div class="calc-out">Ровно как у «${esc(best.name)}» — разницы нет</div>`);
    }
    // выгода за месяц по нашим продажам — понятнее, чем копейки со штуки
    if (ui.cardSales && ui.cardSales.perDay > 0 && diff !== 0) {
      const perMonth = Math.abs(diff) * ui.cardSales.perDay * 30;
      parts.push(`<div class="calc-line">Продаём ${fmtNum(Math.round(ui.cardSales.perDay * 100) / 100)} ${esc(base)} в день → ${diff < 0 ? 'экономия' : 'переплата'} примерно <b>${esc(fmtPrice(perMonth))}</b> в месяц</div>`);
    }
  }

  // наценка при нашей розничной цене
  if (p.retail_price != null && p.retail_price !== '') {
    const retail = Number(p.retail_price);
    if (Number.isFinite(retail) && retail > 0) {
      const abs = retail - o.piece;
      const pct = Math.round((abs / o.piece) * 100);
      parts.push(`<div class="calc-line${abs < 0 ? ' calc-bad-text' : ''}">${abs < 0 ? warnMark + 'Продаём в убыток: ' : 'Наценка при рознице '}${esc(fmtPrice(retail))}: <b>${abs > 0 ? '+' : ''}${esc(fmtPrice(abs))}</b> (${abs > 0 ? '+' : ''}${pct}%)</div>`);
    }
  }

  if (rivals.length) {
    parts.push(`<div class="sec-title">Кто сейчас поставляет · цены за ${STALE_PRICE_DAYS} дней</div>`
      + rivals.map((r) => {
        const d = r.piece - o.piece;
        const tag = d > 0 ? `<span class="calc-worse">дороже на ${esc(fmtPiecePrice(d))}</span>`
          : d < 0 ? `<span class="calc-better">дешевле на ${esc(fmtPiecePrice(-d))}</span>`
            : '<span>столько же</span>';
        const dt = fmtDate(r.date);
        return `<div class="calc-row"><span>${esc(r.name)}${dt ? `<span class="calc-date">поступление ${dt}</span>` : ''}</span><span>${esc(fmtPiecePrice(r.piece))} <span class="calc-tag">${tag}</span></span></div>`;
      }).join(''));
  } else if (stale.length) {
    parts.push(`<p class="muted calc-hint">Сравнивать не с чем: у всех поставщиков поступлений не было больше ${STALE_PRICE_DAYS} дней. Старые цены — ниже, в истории.</p>`);
  } else {
    parts.push('<p class="muted calc-hint">У этого товара пока нет цен поставщиков — сравнить не с чем, но цену за штуку и наценку посчитал.</p>');
  }

  // Устаревшие цены не выбрасываем — они полезны как история, просто в
  // сравнении не участвуют. Показываем с датой поступления.
  if (stale.length) {
    parts.push(`<div class="sec-title">Не сравниваем — поступлений давно не было</div>`
      + stale.map((r) => {
        const dt = fmtDate(r.date);
        return `<div class="calc-row calc-row-old"><span>${esc(r.name)}<span class="calc-date">${dt ? `${ic('warn', 'ic-xs')} цена от ${dt}` : 'дата неизвестна'}</span></span><span>${esc(fmtPiecePrice(r.piece))}</span></div>`;
      }).join(''));
  }

  // Полная история поступлений по всем поставщикам — чтобы перед разговором
  // было видно, как цена менялась и кто когда привозил.
  const hist = [];
  for (const e of mine) {
    for (const h of (e.hist || [])) {
      const q = priceParts(p, h);
      if (q) hist.push({ date: h.price_date, name: e.sup.name, piece: q.piece });
    }
  }
  hist.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (hist.length > 1) {
    parts.push(`<details class="calc-hist"><summary>История цен и поступлений (${hist.length})</summary>`
      + hist.slice(0, 40).map((h) => {
        const dt = fmtDate(h.date);
        return `<div class="calc-row"><span>${dt || 'дата неизвестна'} · ${esc(h.name)}</span><span>${esc(fmtPiecePrice(h.piece))}</span></div>`;
      }).join('') + '</details>');
  }

  box.innerHTML = parts.join('');
}

/* ── Остаток и «сколько заказать» ──────────────────
 * Считаем по общепринятой схеме управления запасами (точка заказа +
 * уровень пополнения), а не «на глазок»:
 *
 *   d   — средний дневной спрос = продано ÷ дней в периоде отчёта
 *   L   — доставка: сколько дней идёт товар от поставщика
 *   R   — периодичность: как часто мы вообще делаем заказ
 *   SS  — страховой запас в днях: подушка на всплеск спроса и задержку
 *
 *   Точка заказа  ROP = d × (L + SS)     ← остаток упал до неё → заказывать
 *   Уровень до    S   = d × (L + R + SS) ← до какого запаса дозаказываем
 *   Сколько взять Q   = S − остаток      ← округляем ВВЕРХ до упаковок
 *
 * Почему точка заказа, а не «осталось меньше N дней»: заказывать надо не
 * когда мало, а когда остатка хватит ровно до приезда следующей поставки.
 * Если поставщик едет 1 день — рано морозить деньги в запасе; если 10 —
 * ждать «пока мало» уже поздно, товар кончится до приезда.
 *
 * L, R и SS каталог знать не может — их задаёт владелец («Правила заказа»).
 * Значения по умолчанию: доставка 3 дня, заказ раз в 7 дней, запас 3 дня.
 *
 * Чего расчёт НЕ знает (и об этом честно пишем в карточке):
 *   — товар в пути (уже заказанный) — учёта заказов у нас нет;
 *   — упущенные продажи: если товара не было на полке, «продано» занижено,
 *     и реальный спрос выше расчётного. */

const ORDER_RULES_KEY = 'wm_order_rules_v1';
const ORDER_RULES_DEFAULT = { lead: 3, cycle: 7, safety: 3 };
const SALES_STALE_DAYS = 45;   // отчёт продаж старше — предупреждаем, что цифры устарели

export function orderRules() {
  const r = state.orderRules || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    lead: num(r.lead, ORDER_RULES_DEFAULT.lead),
    cycle: Math.max(1, num(r.cycle, ORDER_RULES_DEFAULT.cycle)),
    safety: num(r.safety, ORDER_RULES_DEFAULT.safety),
  };
}
export function loadOrderRules() {
  if (state.orderRules) return;
  try { state.orderRules = JSON.parse(localStorage.getItem(ORDER_RULES_KEY)) || null; } catch (e) { state.orderRules = null; }
}

// Чистый расчёт заказа — без вёрстки, чтобы его можно было проверить отдельно.
// d — средний дневной спрос, qty — остаток, packQty — штук в упаковке.
export function orderPlan(d, qty, packQty) {
  const { lead, cycle, safety } = orderRules();
  // Продаж не знаем — советовать нечего. Без этой оговорки расчёт выдавал
  // «пора заказывать» на любой товар с нулём на складе и нулём продаж,
  // да ещё и «заказать 0» рядом — совет, который сам себе противоречит.
  if (!(d > 0)) return { lead, cycle, safety, rop: null, upTo: null, need: 0, packs: 0, total: 0, due: false };
  const rop = d * (lead + safety);              // точка заказа
  const upTo = d * (lead + cycle + safety);     // до какого уровня пополняем
  const need = Math.max(0, upTo - Math.max(qty, 0));
  const packs = packQty > 0 ? Math.ceil(need / packQty) : 0;
  return {
    lead, cycle, safety, rop, upTo, need,
    packs, total: packs * (packQty || 0),
    due: qty <= rop,                            // пора заказывать
  };
}

export function openOrderRules() {
  const r = orderRules();
  $('orLead').value = r.lead;
  $('orCycle').value = r.cycle;
  $('orSafety').value = r.safety;
  $('orError').hidden = true;
  renderOrderRulesExample();
  openSheet('orderRulesSheet');
}

// Живой пример на понятных числах: правила абстрактные, а так сразу видно,
// что они означают для конкретного товара.
export function renderOrderRulesExample() {
  const box = $('orExample');
  if (!box) return;
  const n = (id, d) => { const v = Number($(id).value); return Number.isFinite(v) && v >= 0 ? v : d; };
  const lead = n('orLead', 3); const cycle = Math.max(1, n('orCycle', 7)); const safety = n('orSafety', 3);
  const d = 5; // пример: продаём 5 шт в день
  const rop = Math.ceil(d * (lead + safety));
  const upTo = Math.ceil(d * (lead + cycle + safety));
  box.innerHTML = `Например, товар продаётся по <b>${d}</b> шт в день:<br>
    заказывать, когда останется <b>${fmtNum(rop)}</b> шт — это ${lead} ${plural(lead, 'день', 'дня', 'дней')} доставки + ${safety} ${plural(safety, 'день', 'дня', 'дней')} запаса;<br>
    пополнять до <b>${fmtNum(upTo)}</b> шт — чтобы хватило до следующего заказа.`;
}

export async function saveOrderRules() {
  const n = (id) => Number($(id).value);
  const lead = n('orLead'); const cycle = n('orCycle'); const safety = n('orSafety');
  const bad = (m) => { const e = $('orError'); e.textContent = m; e.hidden = false; };
  if (![lead, cycle, safety].every((v) => Number.isFinite(v) && v >= 0)) return bad('Впиши числа во все три поля');
  if (cycle < 1) return bad('Заказ не может быть реже, чем раз в 1 день');
  if (lead > 90 || cycle > 90 || safety > 90) return bad('Больше 90 дней — похоже на опечатку');
  state.orderRules = { lead, cycle, safety };
  try { localStorage.setItem(ORDER_RULES_KEY, JSON.stringify(state.orderRules)); } catch (e) { /* приватный режим */ }
  $('orError').hidden = true;
  if (!$('productSheet').hidden && ui.currentProduct) renderStock(ui.currentProduct, ui.cardSales);
  closeSheet('orderRulesSheet');
  // правила общие для магазина — кладём их в каталог, чтобы у сотрудников были те же
  if (state.serverless && state.isAdmin && ghConfigured()) await svSaveAndPublish('Правила заказа сохранены');
  else toast('Правила заказа сохранены');
}

export function renderStock(p, sales) {
  const box = $('sheetStock');
  if (!box) return;
  box.innerHTML = '';
  if (!feature('stock')) return;                    // выключено в настройках магазина
  if (!state.session) return;                       // остаток — внутренние данные магазина
  const qty = p.stock != null ? Number(p.stock) : (p.stock_qty != null ? Number(p.stock_qty) : null);
  if (qty == null || !Number.isFinite(qty)) return; // остатки не загружали — блока нет
  const u = p.unit || 'шт';
  const at = fmtDate(p.stock_at);
  const d = sales && sales.perDay > 0 ? sales.perDay : 0;

  let head; let cls = '';
  if (qty <= 0) { head = 'Закончился'; cls = ' stock-out'; }
  else head = `<b>${fmtNum(qty)}</b> ${esc(u)} на складе`;

  const lines = [];
  if (d > 0) {
    const mp = mainPack(p);
    const plan = orderPlan(d, qty, mp ? mp.qty : 0);
    const rop = Math.ceil(plan.rop);
    if (qty > 0) {
      const days = qty / d;
      lines.push(`<div class="stock-line">Хватит на <b>${fmtNum(Math.round(days * 10) / 10)}</b> ${plural(Math.round(days), 'день', 'дня', 'дней')}</div>`);
    }
    if (plan.due) {
      lines.push(`<div class="stock-line stock-warn">${ic('warn', 'ic-xs')} Пора заказывать — точка заказа ${fmtNum(rop)} ${esc(u)}</div>`);
    } else {
      lines.push(`<div class="stock-line">Заказывать, когда останется ${fmtNum(rop)} ${esc(u)}</div>`);
    }
    if (plan.need > 0) {
      const amount = plan.packs > 0
        ? `<b>${fmtNum(plan.packs)}</b> ${plural(plan.packs, 'упаковку', 'упаковки', 'упаковок')} (${fmtNum(plan.total)} ${esc(u)})`
        : `<b>${fmtNum(Math.ceil(plan.need))}</b> ${esc(u)}`;
      lines.push(`<div class="stock-line">Заказать ${amount}</div>`);
      lines.push(`<details class="stock-why"><summary>Откуда это число</summary>
        <div class="stock-why-body">
          Продаём <b>${fmtNum(Math.round(d * 100) / 100)}</b> ${esc(u)} в день.<br>
          Доставка ${plan.lead} ${plural(plan.lead, 'день', 'дня', 'дней')} · заказ раз в ${plan.cycle} ${plural(plan.cycle, 'день', 'дня', 'дней')} · страховой запас ${plan.safety} ${plural(plan.safety, 'день', 'дня', 'дней')}.<br>
          Запас нужен на ${plan.lead + plan.cycle + plan.safety} ${plural(plan.lead + plan.cycle + plan.safety, 'день', 'дня', 'дней')} — это ${fmtNum(Math.ceil(plan.upTo))} ${esc(u)}. Есть ${fmtNum(Math.max(qty, 0))} → не хватает ${fmtNum(Math.ceil(plan.need))} ${esc(u)}.<br>
          <span class="stock-note">Товар в пути каталог не знает — если уже заказал, вычти сам. Сроки меняются в «Правилах заказа».</span>
        </div></details>`);
    }
    // честные оговорки: молчать о них опаснее, чем показать «красивое» число
    if (qty <= 0) lines.push(`<div class="stock-note">${ic('warn', 'ic-xs')} Товара нет на полке — значит, продажи в отчёте занижены, а спрос выше расчётного.</div>`);
    if (sales.periodTo && priceAgeDays(sales.periodTo) > SALES_STALE_DAYS) {
      lines.push(`<div class="stock-note">${ic('warn', 'ic-xs')} Продажи за старый период (по ${fmtDate(sales.periodTo)}) — расчёт мог устареть, загрузи свежий отчёт.</div>`);
    }
  } else if (qty > 0) {
    lines.push('<div class="stock-note">Загрузи отчёт продаж — каталог посчитает, на сколько хватит и сколько заказать.</div>');
  }

  box.innerHTML = `<div class="sales-block${cls}">
    <div class="sec-title">Остаток${at ? ` · на ${at}` : ''}</div>
    <div class="stock-head">${head}</div>
    ${lines.join('')}
  </div>`;
}

async function renderProductSales(p) {
  const box = $('sheetSales');
  box.innerHTML = '';
  if (!state.session || !state.canSales) return; // продажи/«Ходовые» — только владелец
  // серверлес: продажи берём из памяти (по коду/названию — как в отчёте 1С)
  if (state.serverless) {
    const mine = (state.sales || []).filter((r) => (p.code && r.code === p.code) || norm(r.name || '') === norm(p.name));
    const s = mine.sort((a, b) => String(b.period_to || '').localeCompare(String(a.period_to || '')))[0];
    if (s && ui.currentProduct === p) renderSalesBox(p, { period_from: s.period_from, period_to: s.period_to, qty: s.qty }, false);
    return;
  }
}

// общий кэш карточек (цены/продажи) на телефоне

/* ── Цена за штуку и цена за упаковку ──────────────
 * В прайсе 1С у каждой строки своя единица: у одного поставщика цена стоит
 * за штуку, у другого — сразу за упаковку (колонка «Ед.»). Раньше число
 * брали как есть, поэтому цена коробки сравнивалась с розничной ценой за
 * штуку: «выгоднее» доставалось не тому поставщику, а наценка врала в разы.
 * Теперь любую цену приводим к базовой единице (штука или кг) и отдельно
 * считаем, сколько стоит целая упаковка. Сравниваем всегда за штуку. */

// сколько базовых единиц в одной такой единице измерения: «упак (48)» → 48,
// «шт» → 1. Не знаем — null (тогда считаем цену как есть, как раньше).
function unitQty(p, unitStr) {
  const str = String(unitStr || '').trim();
  if (!str) return null;
  const key = norm(str);
  // справочник единиц этого товара — самый надёжный источник
  const hit = ((p && p.pack_units) || []).find((u) => u && norm(u.unit) === key);
  if (hit && Number(hit.coef) > 0) return Number(hit.coef);
  const u = parseBarcodeUnit(str);
  if (!u) return null;
  if (u.qty > 0) return u.qty;
  if (u.isPack) return null;               // «упаковка» без числа — сколько в ней, неизвестно
  return 1;                                 // «шт», «кг», «л» — базовая единица
}

// Основная упаковка товара: самая мелкая, где больше одной штуки.
// Берём из справочника единиц, а если его нет — из единиц штрихкодов.
function mainPack(p) {
  let best = null;
  const consider = (unitStr) => {
    const q = unitQty(p, unitStr);
    if (!(q > 1)) return;
    if (!best || q < best.qty) best = { unit: String(unitStr), qty: q };
  };
  for (const u of (p.pack_units || [])) if (u && u.unit) consider(u.unit);
  if (!best) for (const v of Object.values(p.barcode_units || {})) consider(v);
  return best;
}

// Цена поставщика в двух видах: за базовую единицу и за упаковку.
// row.unit — единица из прайса. В режиме с базой её нет: тогда считаем, что
// цена указана за штуку (как работало раньше), а упаковку домножаем сами.
export function priceParts(p, row) {
  const raw = row ? Number(row.price) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const rowQty = unitQty(p, row.unit);
  // цена в файле указана за упаковку — делим на количество в ней
  if (rowQty > 1) return { piece: raw / rowQty, pack: raw, packQty: rowQty, packUnit: row.unit, fromPack: true };
  const mp = mainPack(p);
  if (mp) return { piece: raw, pack: raw * mp.qty, packQty: mp.qty, packUnit: mp.unit, fromPack: false };
  return { piece: raw, pack: null, packQty: null, packUnit: null, fromPack: false };
}

// «0,9 ₽» читается хуже, чем «0,90 ₽» — у мелких цен показываем копейки
const fmtPiecePrice = (n) => Number(n).toLocaleString('ru-RU',
  { minimumFractionDigits: Number(n) < 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' ₽';

// «за упаковку · 48 шт», «за блок · 10 шт»
function packLabel(p, parts) {
  if (!parts || !parts.packQty) return '';
  const b = (parseBarcodeUnit(parts.packUnit) || {}).base || '';
  const word = /^блок/.test(b) ? 'блок' : (/^кор/.test(b) ? 'коробку' : 'упаковку');
  return `за ${word} · ${fmtNum(parts.packQty)} ${p.is_weighted ? 'кг' : 'шт'}`;
}

/* ── Поставщики и цены в карточке ──────────────────
 * Единый список: все поставщики товара, у каждого — цена и дата последнего
 * поступления по этой цене. Строка кликабельна → открывается карточка
 * поставщика с контактами и кнопками «Позвонить» / «WhatsApp». Цены и
 * контакты — только после входа (доступ закрыт правами базы). */

async function renderProductPrices(p) {
  const box = $('sheetPrices');
  if (!state.session) { box.innerHTML = ''; return; }
  const baseSupIds = [...new Set(p.supplier_ids || [])];
  // покупатель без входа не видит поставщиков вовсе (никаких намёков на «вход
  // для сотрудников»); кассир видит только розничную цену
  if (!state.session || !state.canPurchase) { box.innerHTML = ''; return; }
  // серверлес: цены поставщиков берём из памяти (расшифрованный каталог)
  if (state.serverless) {
    const rows = (state.prices || []).filter((r) => r.product_id === p.id)
      .sort((a, b) => String(b.price_date || '').localeCompare(String(a.price_date || '')));
    renderCardSuppliers(p, rows, baseSupIds, {});
    return;
  }
}

// строит единый список поставщиков товара (с ценами, если есть) и запоминает
// данные для карточки поставщика
function renderCardSuppliers(p, priceRows, baseSupIds, opt) {
  const box = $('sheetPrices');
  // группируем историю цен по поставщику (строки уже от новых к старым)
  const bySup = new Map();
  for (const r of priceRows) {
    if (!bySup.has(r.supplier_id)) bySup.set(r.supplier_id, []);
    bySup.get(r.supplier_id).push(r);
  }
  // объединяем поставщиков товара и тех, у кого есть цена
  const ids = [...new Set([...baseSupIds, ...bySup.keys()])];
  ui.cardSuppliers = {};
  const entries = ids.map((id) => {
    const sup = supplierById(id);
    if (!sup) return null;
    const hist = bySup.get(id) || [];
    const last = hist[0] || null;
    const parts = priceParts(p, last);
    // «предыдущая цена» — первая, что отличается ЗА ШТУКУ: если поставщик
    // перешёл со штук на упаковки, само число меняется, а цена — нет
    const prev = parts ? hist.find((h) => { const q = priceParts(p, h); return q && q.piece !== parts.piece; }) || null : null;
    const e = { sup, hist, last, prev, parts, prod: p };
    ui.cardSuppliers[id] = e;
    return e;
  }).filter(Boolean);

  if (!entries.length) {
    // ничего не показать молча — плохо: пользователь думает, что «сломалось».
    // Объясняем словами, что делать.
    if (opt.locked) {
      box.innerHTML = '<div class="price-block"><button class="btn btn-secondary btn-block" id="pricesLoginBtn">Цены и контакты — вход для сотрудников</button></div>';
    } else if (opt.stale) {
      box.innerHTML = `<div class="price-block"><p class="muted price-hint">${esc(opt.stale)}</p></div>`;
    } else {
      box.innerHTML = '<div class="price-block"><div class="price-title">Поставщики и цены</div>'
        + '<p class="muted price-hint">У этого товара пока нет цен. Загрузи прайс поставщиков через «Импорт из 1С» — цены появятся здесь.</p></div>';
    }
    return;
  }

  // свежесть цены: старше STALE_PRICE_DAYS — поступления давно не было
  for (const e of entries) e.fresh = isFreshPrice(e.last);
  // сортировка: свежие с ценой (дешёвые выше), потом устаревшие с ценой, потом без цены
  entries.sort((a, b) => {
    const rank = (e) => (e.last ? (e.fresh ? 0 : 1) : 2);
    const ra = rank(a); const rb = rank(b);
    if (ra !== rb) return ra - rb;
    // сравниваем цену за штуку, а не число из файла: у кого-то там упаковка
    if (a.parts && b.parts) return a.parts.piece - b.parts.piece;
    return a.sup.name.localeCompare(b.sup.name, 'ru');
  });
  // «выгоднее» считаем ТОЛЬКО среди свежих цен — старую цену без нового
  // поступления нельзя считать актуальной
  const freshPriced = entries.filter((e) => e.fresh && e.parts);
  const best = freshPriced.length ? Math.min(...freshPriced.map((e) => e.parts.piece)) : null;

  // Наценка (только админ/аналитик): розничная − лучшая свежая закупочная и %
  renderMarkup(p, best);

  const chevron = '<span class="sup-chevron">›</span>';
  const rowsHtml = entries.map((e) => {
    const c = state.contacts[e.sup.id];
    const hasContact = state.session && c && c.phone;
    const isBest = e.fresh && e.parts && freshPriced.length > 1 && e.parts.piece === best;
    let right = '';
    if (e.last && e.parts) {
      let trend = '';
      if (e.prev) {
        const was = priceParts(p, e.prev).piece;
        const diff = ((e.parts.piece - was) / was) * 100;
        const pct = Math.abs(diff) >= 10 ? Math.round(Math.abs(diff)) : Math.round(Math.abs(diff) * 10) / 10;
        trend = diff > 0 ? `<span class="price-up">↑ ${pct}%</span>` : `<span class="price-down">↓ ${pct}%</span>`;
      }
      // устаревшая цена: помечаем и НЕ даём как выгодную
      // даты в файле может не быть — тогда про неё просто молчим
      const d = fmtDate(e.last.price_date);
      const dateLabel = !d
        ? '<span class="price-date">дата неизвестна</span>'
        : (e.fresh
          ? `<span class="price-date">поступление ${d}</span>`
          : `<span class="price-date price-old">${ic('warn', 'ic-xs')} цена от ${d} · поступления не было</span>`);
      // сверху — цена за штуку (её и сравниваем с розницей), снизу — за упаковку
      const per = p.is_weighted ? 'кг' : 'шт';
      const packLine = e.parts.packQty
        ? `<span class="price-pack"><b>${fmtPrice(e.parts.pack)}</b> ${esc(packLabel(p, e.parts))}</span>`
        : '';
      right = `<span class="price-val${e.fresh ? '' : ' price-val-old'}">${fmtPiecePrice(e.parts.piece)}<span class="price-per"> / ${per}</span></span>
        ${packLine}
        <span class="price-meta">${isBest ? `<span class="price-badge">${ic('check', 'ic-xs')} выгоднее</span>` : ''}${trend}${dateLabel}</span>`;
    } else {
      right = `<span class="price-noprice">${state.session ? 'цена не указана' : ''}</span>`;
    }
    return `<button class="price-row${isBest ? ' price-best' : ''}${e.last && !e.fresh ? ' price-row-old' : ''}" data-supplier-view="${esc(e.sup.id)}">
      <span class="price-sup">${esc(e.sup.name)}${hasContact ? ` <span class="sup-hasphone">${ic('phone', 'ic-xs')}</span>` : ''}</span>
      ${right}
      ${chevron}
    </button>`;
  }).join('');

  let footer = '';
  if (opt.locked) footer = '<button class="btn btn-secondary btn-block" id="pricesLoginBtn">Цены и контакты — вход для сотрудников</button>';
  else if (opt.stale) footer = `<p class="muted price-hint">${esc(opt.stale)}</p>`;
  else if (!freshPriced.length && entries.some((e) => e.last)) footer = `<p class="muted price-hint">${warnMark}Все цены старше ${STALE_PRICE_DAYS} дней — поступлений давно не было, цены могли измениться. «Выгоднее» не показываем.</p>`;
  else footer = '<p class="muted price-hint">Нажми на поставщика — контакты, звонок и WhatsApp</p>';
  // предложение нового поставщика удобнее сравнивать рядом с текущими ценами
  if (state.canPurchase) footer += '<button class="btn btn-secondary btn-block" id="calcOpenBtn">Посчитать предложение поставщика</button>';

  box.innerHTML = `<div class="price-block"><div class="price-title">Поставщики и цены</div>${rowsHtml}${footer}</div>`;
}

// Наценка в карточке: розничная цена − лучшая свежая закупочная, в ₽ и %
function renderMarkup(p, bestCost) {
  const box = $('sheetMarkup');
  if (!box) return;
  if (!state.canPurchase || bestCost == null || !(p.retail_price != null && p.retail_price !== '')) { box.innerHTML = ''; return; }
  const retail = Number(p.retail_price);
  const cost = Number(bestCost);
  if (!Number.isFinite(retail) || !Number.isFinite(cost) || cost <= 0) { box.innerHTML = ''; return; }
  const abs = retail - cost;
  const pct = Math.round((abs / cost) * 100);
  const loss = abs < 0;
  const cls = loss ? 'markup-loss' : 'markup-ok';
  const sign = abs > 0 ? '+' : '';
  // закупку показываем за ту же единицу, что и розница, — за штуку (или кг)
  const per = p.is_weighted ? 'кг' : 'шт';
  box.innerHTML = `<div class="markup-line ${cls}">
    <span class="markup-val">${loss ? warnMark : ''}Наценка ${sign}${esc(fmtPrice(abs))} <span class="markup-pct">(${sign}${pct}%)</span></span>
    <span class="markup-sub">закупка ${esc(fmtPiecePrice(cost))} / ${per}</span>
  </div>`;
}

/* ── История розничной цены в карточке (item 16) ──── */

/* ── Карточка поставщика (контакты, звонок, WhatsApp) ── */

export function openSupplierView(id) {
  const sup = supplierById(id);
  if (!sup) return;
  const e = ui.cardSuppliers[id];
  const c = state.contacts[id];
  $('supViewName').textContent = sup.name;

  const parts = [];
  if (!state.session) {
    parts.push('<button class="btn btn-secondary btn-block" id="supViewLogin">Цены и контакты — вход для сотрудников</button>');
  } else if (c && c.phone) {
    if (c.contact_name) parts.push(`<div class="supview-person">${esc(c.contact_name)}</div>`);
    parts.push(`<div class="supview-actions">
      <a class="btn btn-primary supview-call" href="${esc(telHref(c.phone))}">Позвонить</a>
      <a class="btn supview-wa" href="${esc(waHref(c.phone))}" target="_blank" rel="noopener">WhatsApp</a></div>`);
    parts.push(`<div class="supview-phone">${esc(c.phone)}</div>`);
    if (c.note) parts.push(`<div class="supview-note">${esc(c.note)}</div>`);
  } else if (state.session) {
    parts.push('<div class="muted">Контакты поставщика ещё не заполнены.</div>');
  }

  // цена этого товара у поставщика + история
  if (state.session && e && e.last && e.parts) {
    const prod = e.prod || ui.currentProduct || {};
    const per = prod.is_weighted ? 'кг' : 'шт';
    const packLine = e.parts.packQty
      ? `<br><b>${fmtPrice(e.parts.pack)}</b> ${esc(packLabel(prod, e.parts))}` : '';
    const price = `<b>${fmtPiecePrice(e.parts.piece)}</b> / ${per}${packLine}`;
    const d = fmtDate(e.last.price_date);
    parts.push(!d
      ? `<div class="supview-price">Цена: ${price}<br><span class="price-date">дата неизвестна</span></div>`
      : (isFreshPrice(e.last)
        ? `<div class="supview-price">Цена: ${price}<br><span class="price-date">поступление ${d}</span></div>`
        : `<div class="supview-price supview-price-old">Цена: ${price}<br><span class="price-old">${ic('warn', 'ic-xs')} от ${d} · нового поступления не было, цена могла измениться</span></div>`));
    if (e.hist.length > 1) {
      parts.push('<div class="supview-hist-title">История цены (за ' + per + ')</div><div class="price-history">'
        + e.hist.slice(0, 12).map((h) => {
          const q = priceParts(prod, h);
          return `<div class="price-hist-row"><span>${fmtDate(h.price_date)}</span><span>${q ? fmtPiecePrice(q.piece) : fmtPrice(h.price)}</span></div>`;
        }).join('')
        + '</div>');
    }
  }

  parts.push(`<button class="btn btn-secondary btn-block" data-supplier-all="${esc(id)}">Показать все товары поставщика →</button>`);
  if (state.isAdmin) parts.push(`<button class="btn btn-ghost btn-block" id="supViewEdit" data-edit="${esc(id)}">Изменить контакты</button>`);

  $('supViewBody').innerHTML = parts.join('');
  openSheet('supplierViewSheet');
}

// Копирование в буфер. Отдельно, потому что копировать код нужно из двух мест:
// из карточки и прямо с плитки — сотруднику за кассой хватает одного кода.
export async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(String(text)); toast(okMsg || 'Скопировано'); }
  catch (e) { toast('Не удалось скопировать'); }
}

function fieldRow(key, val, main = false, copy = false) {
  const cls = main ? ' field-main' : '';
  const copyBtn = (copy || main)
    ? `<button class="copy-btn" data-copy="${esc(val)}">⧉</button>`
    : '';
  return `<div class="field-row${cls}"><span class="field-key">${esc(key)}</span><span class="field-val">${esc(val)}</span>${copyBtn}</div>`;
}
