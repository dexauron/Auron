// Проверка расчётов Модуля Розница из app/js/api.js:
// расхождение по смене, прогресс накоплений, оплачиваемые дни по табелю.
// Это места, где ошибка стоит денег, поэтому считаем их отдельно от сети.
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const sandbox = {
  window: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'k', addEventListener() {} },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  crypto: globalThis.crypto,
  navigator: { onLine: true },
  document: { addEventListener() {}, removeEventListener() {} },
  console,
  setTimeout, clearTimeout,
  fetch: async () => { throw new Error('сеть в тесте не нужна'); },
  AUTH: { getToken: () => 'token' }
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../app/js/api.js', import.meta.url), 'utf8'), sandbox);
const API = sandbox.window.API;

let fails = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` — ждали ${JSON.stringify(want)}`}`);
};

// ── Расхождение по смене ────────────────────────────────────────────
// Формула из 03-SCREENS.md: (факт + выплаты) − Z-отчёт.
// Выплаты уже покинули кассу, поэтому прибавляются к фактическому остатку.
console.log('\n── Расхождение по смене ──');

const shift = {
  z_cash_kopecks: 6200000, z_card_kopecks: 0, z_sbp_kopecks: 0,
  fact_cash_kopecks: 3850000, fact_card_kopecks: 0, fact_sbp_kopecks: 0
};
const withdrawals = [
  { amount_kopecks: 2000000, status: 'active' },  // инкассация 20 000 ₽
  { amount_kopecks: 350000,  status: 'active' }   // Иман 3 500 ₽
];

check('всё сошлось', API.shiftDiscrepancy(shift, withdrawals), 0);

check('недостача 300 ₽',
  API.shiftDiscrepancy({ ...shift, fact_cash_kopecks: 3820000 }, withdrawals), -30000);

check('излишек 500 ₽',
  API.shiftDiscrepancy({ ...shift, fact_cash_kopecks: 3900000 }, withdrawals), 50000);

check('отменённая выплата не считается',
  API.shiftDiscrepancy(shift, [...withdrawals, { amount_kopecks: 999999, status: 'cancelled' }]), 0);

check('без выплат', API.shiftDiscrepancy(shift, []), 3850000 - 6200000);
check('выплаты не переданы', API.shiftDiscrepancy(shift, null), 3850000 - 6200000);

// ── Оплачиваемые дни по табелю ──────────────────────────────────────
console.log('\n── Оплачиваемые дни ──');

check('полный день', API.salaryUnits([{ status: 'worked' }]), 1);
check('полдня', API.salaryUnits([{ status: 'half_day' }]), 0.5);
check('выходной', API.salaryUnits([{ status: 'day_off' }]), 0);
check('больничный не оплачивается', API.salaryUnits([{ status: 'sick' }]), 0);
check('отпуск не оплачивается', API.salaryUnits([{ status: 'vacation' }]), 0);
check('прогул', API.salaryUnits([{ status: 'absent' }]), 0);
check('коэффициент 0.75', API.salaryUnits([{ status: 'worked', coefficient: 0.75 }]), 0.75);
check('коэффициент на полдне', API.salaryUnits([{ status: 'half_day', coefficient: 0.5 }]), 0.25);
check('пустой табель', API.salaryUnits([]), 0);
check('табель не передан', API.salaryUnits(null), 0);
check('неизвестный статус не ломает', API.salaryUnits([{ status: 'что-то' }]), 0);

check('22 рабочих дня',
  API.salaryUnits(Array.from({ length: 22 }, () => ({ status: 'worked' }))), 22);

check('20 полных + 2 половины',
  API.salaryUnits([
    ...Array.from({ length: 20 }, () => ({ status: 'worked' })),
    { status: 'half_day' }, { status: 'half_day' }
  ]), 21);

// ── Прогресс накоплений ─────────────────────────────────────────────
console.log('\n── Накопления ──');

const p1 = API.goalProgress({ target_kopecks: 6000000, current_kopecks: 4200000 });
check('осталось 18 000 ₽', p1.left_kopecks, 1800000);
check('прогресс 70%', p1.percent, 70);

const done = API.goalProgress({ target_kopecks: 9000000, current_kopecks: 9000000 });
check('цель закрыта — 100%', done.percent, 100);
check('цель закрыта — остатка нет', done.left_kopecks, 0);

const over = API.goalProgress({ target_kopecks: 9000000, current_kopecks: 9500000 });
check('перевыполнение не даёт больше 100%', over.percent, 100);
check('перевыполнение не даёт отрицательный остаток', over.left_kopecks, 0);

const zero = API.goalProgress({ target_kopecks: 0, current_kopecks: 0 });
check('нулевой план не делит на ноль', zero.percent, 0);

// «Нужно в день» до дедлайна
const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const p2 = API.goalProgress({ target_kopecks: 6000000, current_kopecks: 4200000, deadline: soon });
check('осталось 10 дней', p2.days_left, 10);
check('нужно в день 1 800 ₽', p2.per_day_kopecks, 180000);

// В последний день остаток нужен целиком
const today = new Date().toISOString().slice(0, 10);
const p3 = API.goalProgress({ target_kopecks: 6000000, current_kopecks: 5200000, deadline: today });
check('последний день — 0 дней', p3.days_left, 0);
check('последний день — весь остаток сразу', p3.per_day_kopecks, 800000);

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛОВ: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
