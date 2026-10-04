// Экран входа «Сотрудника зала» и настройка кода зала (владелец).
// Разметка — в index.html; без неё обработчики просто не вешаются.

import { $, CFG, state, ui } from './store.js';
import { closeSheet, openSheet, toast } from './core.js';
import { publishFull } from './publish.js';
import { rememberFloor, unlockFloor } from './floor.js';
import { buildFloorData, encryptFloor, decryptFloor } from './floordata.js';

/* Доступ для проверок: сборка данных зала и шифрование живут в чистом модуле,
   но тестам нужен вход со страницы. Отдельное окно, чтобы не зависеть от
   порядка сборки window.WM_PUBLISH в app.js. */
if (typeof window !== 'undefined') window.WM_FLOOR = { buildFloorData, encryptFloor, decryptFloor };

/* Денежные пункты меню — не для сотрудника зала: ходовые товары (выручка),
   залежавшиеся, разведка цен конкурентов. Он видит только то, что нужно для
   кассы. Заказы и «закончилось на полке» переехали на вкладку «Работа», где
   у каждой роли показывается своё. */
const MONEY_MENU = ['menuTop', 'menuStale', 'menuCompStores'];
function applyRoleMenu() {
  for (const id of MONEY_MENU) { const el = $(id); if (el) el.hidden = !state.canPurchase; }
}

/* Форма входа владельца/бухгалтера. Живёт здесь, рядом с остальными дверями
 * входа: лист выбора открывает либо её, либо форму кода зала. */
function openOwnerLogin() {
  // email виден сразу, только если служебные аккаунты не настроены в config.js
  $('loginEmailWrap').hidden = !!(CFG.STAFF_EMAIL || (CFG.SERVICE_EMAILS && CFG.SERVICE_EMAILS.length));
  $('loginError').hidden = true;
  openSheet('loginSheet');
}

export function bindFloorUI() {
  ui.openLogin = openOwnerLogin;
  // меню пересобирается при каждом открытии — там же прячем денежные пункты
  const adminBtn = $('adminBtn');
  if (adminBtn) adminBtn.addEventListener('click', applyRoleMenu);
  /* Одна дверь входа: «Войти» спрашивает, кто пришёл, и открывает нужную
     форму. Сами формы прежние — меняется только то, как до них дойти. */
  const chFloor = $('entryChoiceFloor');
  if (chFloor) chFloor.addEventListener('click', () => { closeSheet('entryChoiceSheet'); openSheet('floorLoginSheet'); });
  const chOwner = $('entryChoiceOwner');
  if (chOwner) chOwner.addEventListener('click', () => { closeSheet('entryChoiceSheet'); openOwnerLogin(); });
  const floorForm = $('floorLoginForm');
  if (floorForm) floorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = ($('floorLoginCode').value || '').trim();
    const err = $('floorLoginError'); const btn = $('floorLoginSubmit');
    const orig = btn ? btn.textContent : '';   // вернём исходную надпись кнопки
    if (err) err.hidden = true;
    if (!code) { if (err) { err.textContent = 'Введите код.'; err.hidden = false; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Входим…'; }
    try {
      await unlockFloor(code);
      rememberFloor(code);          // больше не спрашиваем код каждый раз
      $('floorLoginCode').value = '';
      closeSheet('floorLoginSheet');
      toast('Вход сотрудника зала');
    } catch (e2) {
      // различаем: файла нет / сбой загрузки (НЕ «неверный код») / неверный код
      let msg;
      if (e2 && e2.message === 'NO_FLOOR') msg = 'Владелец ещё не задал код для сотрудников.';
      else if (e2 && (e2.code === 'load' || e2.name === 'TypeError')) msg = 'Не удалось загрузить данные — проверьте интернет и попробуйте ещё раз.';
      else msg = 'Код не подошёл.';
      if (err) { err.textContent = msg; err.hidden = false; }
    } finally { if (btn) { btn.disabled = false; btn.textContent = orig; } }
  });
  // Владелец задаёт/меняет код зала
  const floorCodeMenu = $('menuFloorCode');
  if (floorCodeMenu) floorCodeMenu.addEventListener('click', () => { closeSheet('adminMenuSheet'); openSheet('floorCodeSheet'); });
  const floorCodeForm = $('floorCodeForm');
  if (floorCodeForm) floorCodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = ($('floorCodeNew').value || '').trim();
    const again = ($('floorCodeAgain').value || '').trim();
    const err = $('floorCodeError'); const btn = $('floorCodeSubmit');
    const orig = btn ? btn.textContent : '';
    if (err) err.hidden = true;
    if (code.length < 8) { if (err) { err.textContent = 'Код сотрудника — минимум 8 символов (лучше короткая фраза).'; err.hidden = false; } return; }
    if (code !== again) { if (err) { err.textContent = 'Коды не совпали.'; err.hidden = false; } return; }
    if (!ui.secretPw) { if (err) { err.textContent = 'Задать код может только владелец.'; err.hidden = false; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }
    const prevFloor = state.floorPassword;
    try {
      state.floorPassword = code;
      // Одна атомарная публикация: каталог владельца + floor.enc уезжают
      // ОДНИМ коммитом (floor.enc собирается внутри publishFull). Нет окна, где
      // старый floor.enc ещё открывается прежним кодом.
      await publishFull(ui.secretPw);
      closeSheet('floorCodeSheet');
      toast('Код сотрудника зала сохранён');
    } catch (e2) {
      state.floorPassword = prevFloor;   // публикация не прошла — код не меняем
      if (err) { err.textContent = (e2 && e2.friendly) || 'Не удалось опубликовать. Старый код пока действует.'; err.hidden = false; }
    } finally { if (btn) { btn.disabled = false; btn.textContent = orig; } }
  });
}
