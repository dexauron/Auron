// Покупатель: что видит человек, зашедший по ссылке без пароля

/* Каталог открыт по ссылке, и заходят в него двое разных людей: сотрудник,
 * который вот-вот введёт пароль, и обычный покупатель. Раньше им показывали
 * одно и то же. Теперь без пароля человек видит ровно то, что и так написано
 * на ценнике в зале: название, код, цену, есть ли товар и когда его завезли.
 * Всё внутреннее — закупки, поставщики, остаток числом, продажи, рабочие
 * списки — не просто закрыто правами, а не показывается вовсе.
 *
 * И обратная связь: покупатель может написать в магазин (WhatsApp или звонок)
 * и подсказать цену из другого магазина. Сервера нет, поэтому подсказки
 * копятся у него на телефоне и уходят владельцу одним сообщением. */

import { $, CFG, state, ui } from './store.js';
import { attachMoneyInput, closeSheet, esc, moneyNum, openSheet, toast } from './core.js';
import { fmtDate, fmtPrice, todayISO, updatedText } from './catalog.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { buzz, wolfSay } from './mascot.js';
import { sendWhatsApp, storeWa } from './whatsapp.js';

const KEY = 'wm_guest_prices_v1';
const MAX = 50;

const isGuest = () => !state.session;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* нет места */ }
}

/* ── Экран «Магазин» ───────────────────────────────────────────────────── */
export function openStore() {
  renderStore();
  openSheet('storeSheet');
}

function renderStore() {
  const box = $('storeBody');
  if (!box) return;
  const list = read();
  const wa = storeWa();
  const phone = CFG.STORE_PHONE || '';
  const rows = list.map((x, i) => `<div class="ios-row">
    <span class="ios-row-title">${esc(x.name)}
      <span class="ord-sub">${esc(x.store || 'магазин не указан')}${x.code ? ' · код ' + esc(x.code) : ''} · ${fmtDate(x.at)}</span></span>
    <span class="ios-row-value">${fmtPrice(x.price)}</span>
    <button class="rst-rm" data-rep-rm="${i}" aria-label="Убрать">${ic('close', 'ic-xs')}</button>
  </div>`).join('');

  /* Карточка магазина: адрес, часы, маршрут. Спрашивают обычно именно это, а
   * в каталоге этого не было вовсе. Пустые поля не показываем — другой магазин
   * поставит свои в js/config.js, и лишних пустых строк у него не будет. */
  const addr = CFG.STORE_ADDRESS || '';
  const hours = CFG.STORE_HOURS || '';
  const map = CFG.STORE_MAP || (addr ? 'https://yandex.ru/maps/?text=' + encodeURIComponent(addr) : '');
  const upd = updatedText();
  /* Обещание магазина. Для Грозного «весь товар халяльный» — не украшение
     и не реклама, а первое, что человек хочет знать. Сетевые магазины такого
     не пишут никогда, потому что за всю сеть этого не пообещать. */
  const promise = CFG.STORE_PROMISE || '';
  const about = (addr || hours) ? `<div class="ios-group">
      ${addr ? `<a class="ios-row ios-row-link" id="storeMap" href="${esc(map)}" target="_blank" rel="noopener">
        <span class="ios-row-title">Адрес<span class="ord-sub">${esc(addr)}</span></span>
        <span class="ios-row-value">Маршрут</span></a>` : ''}
      ${hours ? `<div class="ios-row"><span class="ios-row-title">Часы работы</span>
        <span class="ios-row-value">${esc(hours)}</span></div>` : ''}
    </div>` : '';

  box.innerHTML = `
    ${about}
    ${promise ? `<div class="store-promise">${ic('check', 'ic-xs')} ${esc(promise)}</div>` : ''}
    ${upd ? `<p class="ios-note">Цены и наличие обновлены <b>${esc(upd)}</b>. Данные приходят
      из магазина раз в день — если товар нужен наверняка, лучше позвонить.</p>` : ''}
    <p class="ios-note">Ошибка в цене, чего-то не хватает на полке, есть пожелание —
    напиши прямо в магазин, ответит владелец.</p>
    <div class="ios-group">
      ${wa ? `<a class="ios-row ios-row-link" id="storeWa" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">
        <span class="ios-row-title">Написать в WhatsApp</span><span class="ios-row-value">${esc(phone)}</span></a>` : ''}
      ${phone ? `<a class="ios-row ios-row-link" id="storeTel" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">
        <span class="ios-row-title">Позвонить</span><span class="ios-row-value">${esc(phone)}</span></a>` : ''}
    </div>

    <div class="ios-group">
      <button class="ios-row ios-row-link" id="storeAsk">
        <span class="ios-row-title">Спросить про товар<span class="ord-sub">не нашёл в каталоге — спроси, бывает ли он у нас</span></span>
      </button>
    </div>

    <div class="ios-group-title">Цены в других магазинах</div>
    ${list.length
    ? `<div class="ios-group">${rows}</div>
       <p class="ios-note">${list.length} ${plural(list.length, 'подсказка', 'подсказки', 'подсказок')} —
       хранятся только на твоём телефоне, пока не отправишь.</p>`
    : `<p class="ios-note">Пока пусто. Открой товар и нажми «Видел дешевле в другом магазине» —
       подсказки соберутся здесь и уйдут владельцу одним сообщением.</p>`}`;

  $('storeSend').hidden = !(list.length && wa);
}

function removeReport(i) {
  const list = read();
  list.splice(Number(i), 1);
  write(list);
  renderStore();
  renderStoreBadge();
}

/* ── «Спросить про товар» ───────────────────────────────────────────────
 * Человек не нашёл товар в каталоге. Раньше он просто уходил, и магазин об
 * этом не узнавал. Теперь он одним касанием спрашивает — а владелец видит
 * живой спрос: что искали, но чего у него нет. */
function openAsk(query) {
  $('askText').value = query || '';
  $('askError').hidden = true;
  openSheet('askSheet');
}

function sendAsk() {
  const what = $('askText').value.trim();
  const err = $('askError');
  if (!what) { err.textContent = 'Напиши, что ищешь.'; err.hidden = false; return; }
  const wa = storeWa();
  if (!wa) { toast('Магазин не указал номер для связи'); return; }
  const text = `Здравствуйте! Ищу товар: ${what}. Бывает ли он у вас?`;
  sendWhatsApp(text, wa);
  closeSheet('askSheet');
}

/* ── «Цена на ценнике другая» ───────────────────────────────────────────────
 * Главная жалоба на все сетевые магазины во всех отзывах: на полке одна цена,
 * на кассе другая. Ни у одной сети нет способа сказать им об этом на месте —
 * человек либо ругается на кассе, либо молча уходит.
 *
 * У нас человек стоит у полки, сканирует товар и сразу видит нашу цену. Если
 * она не совпала с бумажным ценником — одна кнопка, и владельцу уходит
 * сообщение с кодом товара и обеими ценами. Копить такое нельзя: неверный
 * ценник надо править сегодня, поэтому уходит сразу, а не списком. */
export function openShelfReport(p) {
  if (!p) return;
  ui.shelfFor = p;
  $('shelfName').textContent = p.name || '';
  $('shelfOurs').textContent = (p.retail_price != null && p.retail_price !== '')
    ? fmtPrice(p.retail_price) + (p.is_weighted ? ' за кг' : '') : 'цена не указана';
  $('shelfPrice').value = '';
  $('shelfError').hidden = true;
  openSheet('shelfSheet');
}

function sendShelfReport() {
  const p = ui.shelfFor;
  const err = $('shelfError');
  if (!p) return;
  const price = moneyNum($('shelfPrice').value);
  if (!(price > 0)) { err.textContent = 'Напиши цену с ценника — по ней владелец и проверит.'; err.hidden = false; return; }
  const wa = storeWa();
  if (!wa) { toast('Магазин не указал номер для связи'); return; }
  const ours = (p.retail_price != null && p.retail_price !== '') ? fmtPrice(p.retail_price) : 'нет цены';
  const text = `Цена на ценнике не совпадает\n${p.name}${p.code ? ` (код ${p.code})` : ''}\n`
    + `На ценнике: ${fmtPrice(price)}\nВ каталоге: ${ours}`;
  sendWhatsApp(text, wa);
  closeSheet('shelfSheet');
  toast('Спасибо! Владелец проверит ценник');
}

/* ── «Видел дешевле в другом магазине» ─────────────────────────────────── */
function openPriceReport(p) {
  const prod = p || ui.currentProduct;
  if (!prod) return;
  ui.reportProduct = prod;
  $('repName').textContent = prod.name;
  $('repPrice').value = '';
  $('repStore').value = '';
  $('repError').hidden = true;
  openSheet('priceReportSheet');
}

function savePriceReport() {
  const prod = ui.reportProduct;
  if (!prod) return;
  const price = moneyNum($('repPrice').value);
  const err = $('repError');
  if (!(price > 0)) { err.textContent = 'Напиши цену, которую видел.'; err.hidden = false; return; }
  const list = read();
  list.push({
    id: prod.id, name: prod.name, code: prod.code || '',
    price, store: $('repStore').value.trim(), at: todayISO(),
  });
  write(list);
  closeSheet('priceReportSheet');
  buzz();
  wolfSay('Спасибо! Подсказка сохранена — отправь её в разделе «Магазин»', { ms: 4200 });
  renderStoreBadge();
}

/* Одним сообщением: владельцу приходит готовый список, ничего переписывать
 * руками не нужно. Отправленное больше не копится. */
function sendReports() {
  const list = read();
  const wa = storeWa();
  if (!list.length || !wa) return;
  const text = 'Здравствуйте! Заметил цены в других магазинах:\n'
    + list.map((x) => `— ${x.name}${x.code ? ' (код ' + x.code + ')' : ''}: ${fmtPrice(x.price)}`
      + (x.store ? `, ${x.store}` : '')).join('\n');
  sendWhatsApp(text, wa);
  write([]);
  renderStore();
  renderStoreBadge();
}

// сколько подсказок ждёт отправки — кружок на вкладке «Магазин»
function renderStoreBadge() {
  const el = $('tabStoreCount');
  if (!el) return;
  const n = isGuest() ? read().length : 0;
  el.textContent = n > 99 ? '99+' : n;
  el.hidden = !n;
}

/* Разделение «покупатель / сотрудник» на уровне всего оформления: класс на
 * странице. Через него прячется всё рабочее, а каталог показывается списком
 * без фотографий — как решил владелец. */
function applyGuestMode() {
  ui.applyGuestMode = applyGuestMode;   // звать из общей перерисовки без встречного импорта
  try { document.documentElement.classList.toggle('guest', isGuest()); } catch (e) { /* некритично */ }
  renderStoreBadge();
}

// Обработчики покупательских экранов — здесь же, рядом с их логикой
export function bindGuest() {
  $('shelfSend').addEventListener('click', sendShelfReport);
  attachMoneyInput($('shelfPrice'));
  $('btnReportPrice').addEventListener('click', () => openPriceReport(ui.currentProduct));
  $('repSave').addEventListener('click', savePriceReport);
  $('storeSend').addEventListener('click', sendReports);
  $('askSend').addEventListener('click', sendAsk);
  $('emptyAsk').addEventListener('click', () => openAsk(state.query));
  $('storeBody').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rep-rm]');
    if (rm) { removeReport(rm.dataset.repRm); return; }
    if (e.target.closest('#storeAsk')) openAsk('');
  });
  attachMoneyInput($('repPrice'));
  applyGuestMode();
}
