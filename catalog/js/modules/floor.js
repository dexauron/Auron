// Вход «Сотрудника зала»: читает публичный floor.enc и открывает кодом.
// Шифрование и состав данных — в floordata.js (общий чистый модуль).
// Публикацию floor.enc делает publish.js одним коммитом с каталогом владельца.

import { CFG, state } from './store.js';
import { buildIndex } from './catalog.js';
import { byName } from './data.js';
import { renderAll } from './render.js';
import { decryptFloor, FLOOR_FILE } from './floordata.js';

// Разложить данные зала в приложение: роль zal, денег нет.
export function applyFloorSnapshot(data) {
  state.groups = data.groups || [];
  state.suppliers = [];
  state.products = (data.products || []).slice().sort(byName);
  state.prices = []; state.sales = []; state.contacts = {};
  state.competitors = []; state.compPrices = [];
  state.serverless = true;
  state.session = { user: { email: 'floor' }, serverless: true, floor: true };
  state.isAdmin = false; state.role = 'zal';
  state.canPurchase = false; state.canSales = false;   // деньги в UI скрыты этими флагами
  buildIndex();
  renderAll();
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
