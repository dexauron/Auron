// Проверка ядра платформы (app/js/state.js): шина событий, движок прав,
// сборка навигации. Соответствие docs/03-SCREENS.md (матрица «экран ↔ роль»,
// правило пяти вкладок) и docs/05-ARCHITECTURE.md.
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const winListeners = {};
const sandbox = {
  window: {
    addEventListener: (e, h) => { winListeners[e] = h; },
    removeEventListener: () => {}
  },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  navigator: { onLine: true },
  console: { ...console, error: () => {} },   // ошибки слушателей глушим намеренно
  Date, JSON, Map, Set, Number, String, Object, Array
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../app/js/state.js', import.meta.url), 'utf8'), sandbox);
const S = sandbox.window.STATE;

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` — ждали ${JSON.stringify(want)}`}`);
};

// ── Шина событий ────────────────────────────────────────────────────
console.log('\n── Шина событий ──');

let got = null;
const offA = S.on('shift.closed', p => { got = p; });
S.emit('shift.closed', { id: 7 });
check('слушатель получил событие', got, { id: 7 });

got = null;
offA();
S.emit('shift.closed', { id: 8 });
check('после отписки не приходит', got, null);

// Маска: 'shift.*' ловит все события кассы
let wildCount = 0;
const offW = S.on('shift.*', () => { wildCount++; });
S.emit('shift.closed', null);
S.emit('shift.opened', null);
S.emit('debt.added', null);        // чужой домен — не считается
check('маска ловит свой домен', wildCount, 2);
offW();

// Упавший слушатель не должен ронять остальных
let survived = false;
const off1 = S.on('boom', () => { throw new Error('падаю'); });
const off2 = S.on('boom', () => { survived = true; });
S.emit('boom', null);
check('ошибка в слушателе не мешает соседям', survived, true);
off1(); off2();

// ── Состояние ───────────────────────────────────────────────────────
console.log('\n── Состояние ──');

let changes = 0;
const offS = S.on('state.changed', () => { changes++; });
S.set({ screen: 'home' });
check('изменение шлёт событие', changes, 1);
S.set({ screen: 'home' });
check('то же значение события не шлёт', changes, 1);
S.set({ screen: 'kassa' });
check('новое значение шлёт снова', changes, 2);
offS();

// ── Права ───────────────────────────────────────────────────────────
console.log('\n── Права по ролям ──');

S.set({ role: 'accountant' });
check('бухгалтер ведёт кассу',        S.can('edit_cash'), true);
check('бухгалтер платит поставщикам', S.can('edit_debts'), true);
check('бухгалтер закрывает месяц',    S.can('close_month'), true);
check('бухгалтер НЕ управляет доступом', S.can('manage_access'), false);

S.set({ role: 'owner' });
check('владелец видит кассу',      S.can('view_cash'), true);
check('владелец НЕ правит кассу',  S.can('edit_cash'), false);
check('владелец ставит цели',      S.can('edit_goals'), true);
check('владелец управляет доступом', S.can('manage_access'), true);

S.set({ role: 'admin' });
check('администратор создаёт заказы',       S.can('create_order'), true);
check('администратор записывает выплату',   S.can('schedule_payment'), true);
check('администратор НЕ проводит оплаты',   S.can('edit_debts'), false);
check('администратор НЕ видит табель',      S.can('view_staff'), false);

S.set({ role: 'staff' });
check('сотрудник зала видит товары',   S.can('view_products'), true);
check('сотрудник зала НЕ видит кассу', S.can('view_cash'), false);
check('сотрудник зала НЕ видит долги', S.can('view_debts'), false);

S.set({ role: null });
check('без роли прав нет', S.can('view_home'), false);

// Владелец собирает свою роль из нужных ключей
S.defineRole('senior_admin', ['view_home', 'view_debts', 'edit_debts', 'create_order']);
S.set({ role: 'senior_admin' });
check('своя роль работает',        S.can('edit_debts'), true);
check('своя роль ограничена набором', S.can('edit_cash'), false);

// ── Навигация из модулей ────────────────────────────────────────────
console.log('\n── Навигация ──');

S.set({ role: 'accountant' });
S.registerModule({ key: 'home',      title: 'Главная',    order: 1, requires: 'view_home' });
S.registerModule({ key: 'kassa',     title: 'Касса',      order: 2, requires: 'view_cash' });
S.registerModule({ key: 'suppliers', title: 'Поставщики', order: 3, requires: 'view_debts' });
S.registerModule({ key: 'finance',   title: 'Финансы',    order: 4, requires: 'view_reports' });
S.registerModule({ key: 'staff',     title: 'Персонал',   order: 5, requires: 'view_staff' });
S.registerModule({ key: 'journal',   title: 'Операции',   order: 6 });

check('бухгалтер видит все 6 разделов', S.navItems().length, 6);

// На телефоне максимум 5: четыре вкладки и «Ещё»
const phone = S.navLayout(false);
check('на телефоне 4 вкладки',      phone.tabs.length, 4);
check('остальное ушло в «Ещё»',     phone.more.length, 2);
check('порядок вкладок соблюдён',   phone.tabs.map(t => t.key), ['home', 'kassa', 'suppliers', 'finance']);

// На широком экране ограничения нет
const desktop = S.navLayout(true);
check('на компьютере все сразу', desktop.tabs.length, 6);
check('«Ещё» пустое',            desktop.more.length, 0);

// Сотрудник зала: касса и долги в навигацию не попадают
S.set({ role: 'staff' });
check('у сотрудника зала только доступное', S.navItems().map(m => m.key), ['home', 'journal']);

// Выключенный модуль исчезает у всех
S.set({ role: 'accountant' });
S.setModuleEnabled('staff', false);
check('выключенный модуль скрыт', S.navItems().some(m => m.key === 'staff'), false);
S.setModuleEnabled('staff', true);
check('включённый вернулся', S.navItems().some(m => m.key === 'staff'), true);

// ── Флаги функций ───────────────────────────────────────────────────
console.log('\n── Флаги ──');

check('неизвестный флаг выключен',   S.flag('ai_insights'), false);
check('запасное значение работает',  S.flag('ai_insights', true), true);
S.setFlag('ai_insights', true);
check('флаг включился',              S.flag('ai_insights'), true);

// ── Трекинг ─────────────────────────────────────────────────────────
console.log('\n── Трекинг ──');

const events = S.takeEvents();
check('события копились', events.length > 0, true);
check('после выемки буфер пуст', S.takeEvents().length, 0);

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛОВ: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
