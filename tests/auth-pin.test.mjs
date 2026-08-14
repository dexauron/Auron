// Проверка лестницы защиты PIN из docs/03-SCREENS.md (Экран 0б):
// попытки 1–5 без пауз, 6–10 пауза 30 сек, 11–15 пауза 5 мин, с 16-й блокировка.
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const listeners = {};
const sandbox = {
  window: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'k', dispatchEvent() {}, addEventListener() {} },
  localStorage,
  crypto: globalThis.crypto,
  TextEncoder,
  document: { addEventListener() {}, removeEventListener() {} },
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
  setTimeout, clearTimeout, setInterval, clearInterval,
  console, fetch: async () => { throw new Error('нет сети'); }
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../app/js/auth.js', import.meta.url), 'utf8'), sandbox);
const AUTH = sandbox.window.AUTH;

let fails = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '✗'} ${name}: получили ${JSON.stringify(got)}${ok ? '' : `, ждали ${JSON.stringify(want)}`}`);
};

await AUTH.setupPIN('1234');

// Верный PIN не должен пройти без сессии, но и не должен считаться ошибкой ввода
try { await AUTH.verifyPIN('1234'); } catch (e) {
  check('верный PIN без сессии', e.message, 'SESSION_EXPIRED');
}

// Попытки 1–5: обычная ошибка, паузы нет
for (let i = 1; i <= 5; i++) {
  try { await AUTH.verifyPIN('0000'); check(`попытка ${i}`, 'прошла', 'ошибка'); }
  catch (e) { check(`попытка ${i}`, e.message, `WRONG:${5 - i}`); }
}
check('паузы после 5 попыток нет', AUTH.cooldownLeft(), 0);

// Попытка 6: включается пауза 30 сек
try { await AUTH.verifyPIN('0000'); check('попытка 6', 'прошла', 'ошибка'); }
catch (e) { check('попытка 6 даёт паузу', e.message, 'COOLDOWN:30'); }
check('пауза 30 сек активна', AUTH.cooldownLeft() > 0 && AUTH.cooldownLeft() <= 30, true);

// Во время паузы ввод отклоняется, счётчик попыток не растёт
try { await AUTH.verifyPIN('1234'); check('ввод во время паузы', 'прошёл', 'отклонён'); }
catch (e) { check('ввод во время паузы отклонён', e.message.startsWith('COOLDOWN:'), true); }

// Промотать паузу и дойти до 11-й попытки — пауза должна стать 5 мин
const skip = () => store.delete('auron_pin_cooldown_until');
for (let i = 7; i <= 10; i++) {
  skip();
  try { await AUTH.verifyPIN('0000'); } catch (e) {
    check(`попытка ${i} пауза 30 сек`, e.message, 'COOLDOWN:30');
  }
}
skip();
try { await AUTH.verifyPIN('0000'); } catch (e) {
  check('попытка 11 пауза 5 минут', e.message, 'COOLDOWN:300');
}

// Дойти до 15-й — всё ещё пауза 5 минут, блокировки быть не должно
for (let i = 12; i <= 15; i++) {
  skip();
  try { await AUTH.verifyPIN('0000'); } catch (e) {
    check(`попытка ${i} пауза 5 минут`, e.message, 'COOLDOWN:300');
  }
}
check('после 15 попыток блокировки ещё нет', AUTH.isBlocked(), false);

// 16-я попытка — блокировка
skip();
try { await AUTH.verifyPIN('0000'); check('попытка 16', 'прошла', 'блокировка'); }
catch (e) { check('попытка 16 блокирует', e.message, 'BLOCKED'); }
check('признак блокировки', AUTH.isBlocked(), true);

// Верный PIN после блокировки не помогает
try { await AUTH.verifyPIN('1234'); check('верный PIN после блокировки', 'прошёл', 'BLOCKED'); }
catch (e) { check('верный PIN после блокировки отклонён', e.message, 'BLOCKED'); }

// Восстановление снимает блокировку и счётчики
AUTH.unblock();
check('после восстановления блокировки нет', AUTH.isBlocked(), false);
check('после восстановления паузы нет', AUTH.cooldownLeft(), 0);

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛОВ: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
