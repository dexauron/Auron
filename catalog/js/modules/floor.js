// Вход «Сотрудника зала»: читает публичный floor.enc и открывает кодом.
// Шифрование и состав данных — в floordata.js (общий чистый модуль).
// Публикацию floor.enc делает publish.js одним коммитом с каталогом владельца.

import { $, CFG, state } from './store.js';
import { buildIndex } from './catalog.js';
import { byName } from './data.js';
import { renderAll, viewChosen } from './render.js';
import { decryptFloor, FLOOR_FILE } from './floordata.js';
import { logSession } from './sessionlog.js';
import { saveSvAuth } from './publish.js';

// Разложить данные зала в приложение: роль zal, денег нет.
export function applyFloorSnapshot(data) {
  state.groups = data.groups || [];
  state.suppliers = [];
  state.products = (data.products || []).slice().sort(byName);
  state.prices = []; state.sales = []; state.contacts = {};
  state.competitors = []; state.compPrices = [];
  /* История РОЗНИЧНОГО ценника — чтобы «Подорожало» говорило правду: без неё
     экран уверял, что цены за месяц не менялись, хотя данных просто не было.
     Закупочных цен тут нет, их считает только роль с доступом к деньгам. */
  state.retailHist = data.retailHist || {};
  state.serverless = true;
  state.session = { user: { email: 'floor' }, serverless: true, floor: true };
  state.isAdmin = false; state.role = 'zal';
  state.canPurchase = false; state.canSales = false;   // деньги в UI скрыты этими флагами
  /* Сотрудник зала ищет КОД, а не разглядывает товар: плотный список с
     кодами ему удобнее плиток, и на экран влезает вдвое больше. Если он сам
     переключил вид на этом телефоне — не перебиваем. */
  if (!viewChosen()) state.view = 'list';
  buildIndex();
  renderAll();
  // Шапка должна показывать, что сотрудник ВОШЁЛ: иначе он видит кнопку
  // «Войти», хотя уже внутри, и думает, что вход не сработал.
  const fab = $('fabAdd'); if (fab) fab.hidden = true;            // добавлять товар он не может
  const ab = $('adminBtn'); if (ab) ab.classList.toggle('is-admin', true);
  const al = $('adminBtnLabel'); if (al) al.hidden = true;
}

/* Запомнить вход зала на этом устройстве. Раньше его НЕ запоминали вовсе:
 * владелец и бухгалтер входили один раз, а сотрудник зала набирал код у полки
 * заново при каждом открытии каталога — и просто переставал им пользоваться.
 * Код лежит на телефоне так же, как пароль владельца; размен осознанный, и в
 * самом `floor.enc` денег нет вовсе. «Выйти» стирает и запись, и данные. */
export function rememberFloor(code) {
  saveSvAuth('zal', code);
  logSession('in', 'zal');
}

function rawUrl() {
  return `https://raw.githubusercontent.com/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/${CFG.GITHUB_BRANCH || 'main'}/${CFG.DATA_PATH}/${FLOOR_FILE}`;
}

// Вход сотрудника по коду зала. Ошибки РАЗДЕЛЕНЫ:
//   NO_FLOOR  — файла ещё нет (владелец не задал код);
//   .code='load' — не удалось скачать (сеть/сервер) — это НЕ «неверный код»;
//   иначе — расшифровка не прошла → код действительно не подошёл.
export async function unlockFloor(code) {
  let r;
  try {
    r = await fetch(rawUrl() + '?t=' + Date.now(), { cache: 'no-store' });
  } catch (e) {
    const err = new Error('load'); err.code = 'load'; throw err;   // нет сети
  }
  if (r.status === 404) throw new Error('NO_FLOOR');
  if (!r.ok) { const err = new Error('load'); err.code = 'load'; throw err; }
  let text;
  try { text = await r.text(); } catch (e) { const err = new Error('load'); err.code = 'load'; throw err; }
  const data = await decryptFloor(text, code);   // неверный код → исключение расшифровки
  applyFloorSnapshot(data);
  return 'zal';
}
