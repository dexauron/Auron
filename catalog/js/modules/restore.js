/* Запомненный вход: поднять роль при запуске каталога
 *
 * Человек входит один раз, а не каждое утро. Раньше это работало только для
 * владельца и бухгалтера — сотрудник зала набирал код у полки заново при
 * каждом открытии каталога, то есть «каталог не помнил, когда зашли».
 * Теперь путь один на все роли, а особенности каждой — внутри.
 */

import { safely } from './core.js';
import { renderAll } from './render.js';
import { SV_AUTH_KEY, applyServerless, applyStaff, clearSvAuth, unlockAny } from './publish.js';
import { unlockFloor } from './floor.js';

/* after — что доделать, когда полный каталог доехал: проверить свежесть
 * витрины и новости. Эти проверки живут в app.js, поэтому приходят доводом,
 * а не импортом: модулю входа про них знать незачем. */
export function restoreLogin(after) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SV_AUTH_KEY) || 'null'); } catch (e) { return false; }
  if (!saved || !saved.pw) return false;

  if (saved.role === 'zal') {
    /* Данные зала — отдельный публичный файл, открываемый кодом.
       Код СМЕНИЛИ — запомненный вход снимаем. Нет связи или файла ещё нет —
       оставляем как есть: иначе сотрудник, у которого в зале пропал
       интернет, выпал бы из каталога и набирал код заново. */
    unlockFloor(saved.pw).catch((e) => {
      const offline = e && (e.code === 'load' || e.message === 'NO_FLOOR' || e.name === 'TypeError');
      if (!offline) clearSvAuth();
    });
    return true;
  }

  /* Права поднимаем сразу по запомненной роли (данные — из кэша), но
     окончательное слово за каталогом: владелец мог сменить пароль
     сотрудника, и тогда роль другая. */
  if (saved.role === 'staff') applyStaff(saved.pw); else applyServerless(saved.pw);
  unlockAny(saved.pw).then((role) => {
    if (role === 'staff') applyStaff(saved.pw); else applyServerless(saved.pw);
    renderAll();
    if (after) safely('после входа', after)();
  }).catch((err) => {
    /* Нет сети — оставляем запомненный вход и работаем по кэшу. Но если
       свежий файл ключей прочитан и пароль ЯВНО отвергнут, значит владелец
       его сменил: держать старые права нельзя (находка GPT). */
    if (err && err.message === 'BAD_PASSWORD') { clearSvAuth(); location.reload(); }
  });
  return true;
}
