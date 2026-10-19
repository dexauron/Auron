import { EXCEL_FIELDS, defaultExcelSettings, evaluateExcel } from '/worksheet.mjs';
import { normalizeAmount } from '/amount.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const roles = { owner: 'Владелец', administrator: 'Администратор', accountant: 'Бухгалтер', cashier: 'Кассир', employee: 'Сотрудник', representative: 'Представитель' };
const icons = { home: 'M3 10l9-7 9 7v11h-6v-7H9v7H3z', cash: 'M3 5h18v14H3z M3 9h18 M7 14h3', tasks: 'M8 6h13 M8 12h13 M8 18h13 M2 6l1 1 2-2 M2 12l1 1 2-2 M2 18l1 1 2-2', products: 'M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10', users: 'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 4a4 4 0 0 1 0 7 M22 21v-3a4 4 0 0 0-3-4', security: 'M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6' };
const svg = key => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS(s.namespaceURI, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', icons[key]); s.append(p); return s; };
const button = (title, fn, cls = 'secondary') => { const b = node('button', title, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
const rub = n => n == null ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
const signed = n => n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${rub(Math.abs(n))}`;
const time = n => new Date(n).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
const canCash = () => ['owner', 'accountant', 'cashier'].includes(user?.role);
const managesCash = () => ['owner', 'accountant'].includes(user?.role);
const managesTasks = () => ['owner', 'accountant', 'administrator'].includes(user?.role);
let csrf = '', user = null, configured = true, current = 'home', generation = 0, renderVersion = 0, dirty = false, pending = null;
let capabilities = {};
const backupAlert = $('backup-alert-template').content.firstElementChild.cloneNode(true); backupAlert.hidden = true; $('content').querySelector('header').before(backupAlert);
backupAlert.querySelector('button').addEventListener('click', () => render('backups'));
icons.backups = 'M4 5h16v14H4z M4 10h16 M8 15h3 M12 2v6 M9 5l3 3 3-3';
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('way-workspace-session') : null;
channel?.addEventListener('message', () => checkSession());
let noticeTimer;
class SessionChangedError extends Error {}
function notice(text) { $('notice').textContent = text; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000); }
function scrub() {
  generation++; renderVersion++; user = null; dirty = false; pending = null;
  $('modal').close(); $('modal-body').replaceChildren(); $('page').replaceChildren();
  $('navigation').replaceChildren(); $('mobile-navigation').replaceChildren(); $('profile-button').textContent = '';
  backupAlert.hidden = true; backupAlert.querySelector('span').textContent = '';
  $('app').hidden = true; $('entry').hidden = false; $('login-form').reset();
}
async function api(path, data) {
  const issued = generation;
  const r = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Way-Token': csrf, ...(user ? { 'X-Way-Account': user.id } : {}) }, body: JSON.stringify(data) });
  const result = await r.json();
  if (issued !== generation) throw new SessionChangedError('Сеанс изменён. Повторите действие после входа.');
  if (r.status === 401 && user) { scrub(); showEntry(); }
  if (!r.ok) throw new Error(result.error || 'Не удалось выполнить действие');
  return result;
}
function showEntry() {
  $('entry').hidden = false; $('app').hidden = true;
  $('entry-title').textContent = configured ? 'С возвращением' : 'Ваш Way Market';
  $('entry-subtitle').textContent = configured ? 'Войдите в свой рабочий кабинет.' : 'Создайте аккаунт владельца. Код находится в окне сервера.';
  $('setup-code-label').hidden = $('setup-name-label').hidden = configured;
  $('login-button').textContent = configured ? 'Войти' : 'Создать аккаунт';
  $('login-form').elements.password.autocomplete = configured ? 'current-password' : 'new-password';
}
function field(form, label, name, options = {}) {
  const l = node('label', label), input = node('input'); input.name = name;
  for (const [k, v] of Object.entries(options)) input[k] = v;
  l.append(input); form.append(l); return input;
}
function select(form, label, name, values, value) {
  const l = node('label', label), input = node('select'); input.name = name;
  for (const [id, caption] of values) { const o = node('option', caption); o.value = id; input.append(o); }
  if (value != null) input.value = value;
  l.append(input); form.append(l); return input;
}
function surface(title) { const s = node('section', null, 'surface'); if (title) s.append(node('h2', title)); return s; }
function modal(title, content) { $('modal-title').textContent = title; $('modal-body').replaceChildren(content); $('modal').showModal(); }
$('modal-close').addEventListener('click', () => $('modal').close());
function help(title, text) { return button('?', () => modal(title, node('p', text)), 'help'); }
function formSubmit(form, label, callback) {
  const message = node('p', '', 'error'), save = node('button', label, 'primary'); save.type = 'submit'; form.append(message, save);
  let running = false;
  form.addEventListener('submit', async e => { e.preventDefault(); if (running) return; running = true; save.disabled = true; message.textContent = ''; try { await callback(); } catch (error) { message.textContent = error.message; } finally { running = false; save.disabled = false; } });
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget; $('login-button').disabled = true; $('entry-error').textContent = '';
  const data = Object.fromEntries(new FormData(f));
  try {
    if (!configured) { await api('/api/bootstrap', data); configured = true; showEntry(); }
    await api('/api/login', data); f.reset(); channel?.postMessage('changed'); await checkSession(true);
  } catch (error) { $('entry-error').textContent = error.message; }
  finally { data.password = ''; $('login-button').disabled = false; }
});
async function checkSession(force = false) {
  try {
    const s = await api('/api/session'); csrf = s.csrf; configured = s.configured; capabilities = s.capabilities ?? {};
    if (!s.user) { if (user) scrub(); showEntry(); return; }
    if (user?.id !== s.user.id || user?.version !== s.user.version || force) {
      scrub(); user = s.user; $('entry').hidden = true; $('app').hidden = false; buildNavigation(); await render('home', true);
    }
    const warning = user?.role === 'owner' && s.backupHealth ? s.backupHealth.lastError || (s.backupHealth.scheduleNeedsUnlock ? 'Автокопии приостановлены: включите расписание заново.' : !s.backupHealth.hasSuccessfulCopy ? 'Резервная копия ещё не создана.' : '') : '';
    backupAlert.hidden = !warning; if (backupAlert.querySelector('span').textContent !== warning) backupAlert.querySelector('span').textContent = warning;
  } catch (error) { if (!(error instanceof SessionChangedError)) notice('Нет связи с сервером. Сохранение новых данных не подтверждено.'); }
}
function buildNavigation() {
  const pages = [['home', 'Главная'], ...(canCash() ? [['cash', 'Касса']] : []), ['tasks', 'Задачи'], ['products', 'Каталог']];
  if (user.role === 'owner') pages.push(['users', 'Сотрудники'], ['security', 'История']);
  if (user.role === 'owner' && capabilities.backups) pages.push(['backups', 'Резервные копии']);
  for (const [id, label] of pages) {
    const b = button('', () => render(id), ''); b.dataset.page = id; b.append(svg(id), node('span', label)); $('navigation').append(b);
    if (['home', 'cash', 'tasks', 'products'].includes(id)) { const mobile = button('', () => render(id), ''); mobile.dataset.page = id; mobile.append(svg(id), node('span', label)); $('mobile-navigation').append(mobile); }
  }
  $('profile-button').textContent = `${user.name} · ${roles[user.role]}`;
}
const titles = { home: ['Главная', 'Главное для вашей работы.'], cash: ['Касса', 'Сдача и приём денег — без лишних действий.'], tasks: ['Задачи', 'Поручения и результат работы.'], products: ['Каталог', 'Товары и розничные цены.'], users: ['Сотрудники', 'Личные аккаунты и полномочия.'], security: ['История действий', 'Кто, когда и что изменил.'] };
titles.backups = ['Резервные копии', 'Зашифрованные копии и проверка восстановления.'];
async function render(page = current, force = false) {
  if (pending) { notice('Дождитесь ответа сервера.'); return; }
  if (!user || (!force && dirty && !confirm('Покинуть ввод? Несохранённые изменения будут потеряны.'))) return;
  dirty = false; pending = null; current = page; const version = ++renderVersion;
  $('title').textContent = titles[page][0]; $('subtitle').textContent = titles[page][1];
  for (const b of document.querySelectorAll('[data-page]')) { b.classList.toggle('active', b.dataset.page === page); b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false'); }
  $('page').replaceChildren(node('p', 'Загружаем…', 'empty'));
  try {
    const content = await ({ home: homePage, cash: cashPage, tasks: tasksPage, products: productsPage, users: usersPage, security: securityPage, backups: backupsPage })[page]();
    if (version !== renderVersion || !user) return;
    $('page').replaceChildren(content); window.scrollTo(0, 0);
  } catch (error) { if (version === renderVersion && user) $('page').replaceChildren(node('p', error.message, 'error')); }
}
$('refresh').addEventListener('click', () => render());
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pageshow', () => checkSession());
window.addEventListener('pagehide', () => scrub());
window.addEventListener('focus', () => checkSession());
setInterval(() => { if (user && !document.hidden) checkSession(); }, 30000);

async function homePage() {
  const [tasks, cash] = await Promise.all([api('/api/tasks'), canCash() ? api('/api/cash') : []]);
  const root = node('div'), hello = surface(); hello.append(node('p', roles[user.role], 'eyebrow'), node('h2', `Здравствуйте, ${user.name}`), node('p', 'Откройте нужный раздел. Доступ определяется вашим аккаунтом.', 'fine')); root.append(hello);
  const metrics = node('div', null, 'metrics');
  const metric = (label, amount, detail, target) => { const b = button('', () => render(target), 'metric'); b.append(node('span', label), node('strong', String(amount)), node('small', detail)); metrics.append(b); };
  metric('Мои задачи', tasks.filter(t => t.status === 'open' && t.assigneeId === user.id).length, 'Ожидают выполнения', 'tasks');
  if (canCash()) metric('Ожидают приёма', cash.filter(c => c.status === 'submitted').length, 'Сдачи кассы', 'cash');
  metric('Рабочий каталог', '↗', 'Найти товар и цену', 'products'); root.append(metrics);
  const next = surface('С чего начать');
  if (user.role === 'owner') next.append(node('p', 'Создайте сотрудникам личные аккаунты и назначьте задачи. Для кассовой сдачи выберите кассира; бухгалтер принимает деньги отдельным действием.'), button('Управлять сотрудниками', () => render('users'), 'primary'));
  else if (user.role === 'cashier') next.append(node('p', 'Заполните отчёты своей смены и укажите, сколько передаёте. Фактически полученные деньги внесёт бухгалтер.'), button('Сдать кассу', () => render('cash'), 'primary'));
  else next.append(node('p', 'Задачи связывают участников работы. Каталог доступен без финансовых сведений других сотрудников.'), button('Открыть задачи', () => render('tasks'), 'primary'));
  next.append(node('p', 'Рабочая область включает аккаунты, кассу, задачи и ручной каталог. Резервные копии доступны владельцу в отдельном разделе. Закупки, табель, зарплатные начисления и ИИ ещё не подключены.', 'fine')); root.append(next); return root;
}
async function usersPage() {
  const users = await api('/api/users'), root = surface('Команда');
  root.append(button('Добавить сотрудника', () => {
    const f = node('form'); field(f, 'Имя', 'name', { required: true, maxLength: 100 }); field(f, 'Логин', 'login', { required: true, autoCapitalize: 'none', maxLength: 64, autocomplete: 'off' });
    field(f, 'Пароль-фраза · от 15 символов', 'password', { type: 'password', required: true, minLength: 15, maxLength: 128, autocomplete: 'new-password' }); select(f, 'Роль', 'role', Object.entries(roles), 'employee');
    formSubmit(f, 'Создать аккаунт', async () => { await api('/api/users', Object.fromEntries(new FormData(f))); f.reset(); $('modal').close(); notice('Аккаунт создан'); await render('users', true); }); modal('Новый сотрудник', f);
  }, 'primary'));
  for (const u of users) {
    const row = node('div', null, 'row'), text = node('div', null, 'row-main'); text.append(node('strong', u.name), node('small', `${roles[u.role]} · ${u.login} · ${u.active ? 'Доступ открыт' : 'Отключён'}`));
    row.append(text, button('Настроить', () => {
      const f = node('form'); field(f, 'Имя', 'name', { value: u.name, required: true, maxLength: 100 }); select(f, 'Роль', 'role', Object.entries(roles), u.role); select(f, 'Доступ', 'active', [['yes', 'Открыт'], ['no', 'Отключён']], u.active ? 'yes' : 'no'); field(f, 'Причина изменения', 'reason', { required: true, maxLength: 500 });
      formSubmit(f, 'Сохранить полномочия', async () => { const p = Object.fromEntries(new FormData(f)); await api('/api/users/update', { ...p, active: p.active === 'yes', id: u.id, expectedVersion: u.version }); $('modal').close(); notice('Изменение сохранено. Сеансы сотрудника завершены.'); channel?.postMessage('changed'); await checkSession(); if (user) await render('users', true); }); modal(u.name, f);
    })); root.append(row);
  } return root;
}
async function tasksPage() {
  const tasks = await api('/api/tasks'), root = surface('Рабочие поручения');
  if (managesTasks()) root.append(button('Назначить задачу', () => taskForm(), 'primary'));
  if (!tasks.length) root.append(node('p', 'Задач пока нет.', 'empty'));
  for (const task of tasks) {
    const row = node('div', null, 'row'), text = node('div', null, 'row-main'); text.append(node('strong', task.title), node('small', `${task.status === 'done' ? 'Выполнено' : 'Ожидает выполнения'} · ${time(task.at)}`));
    const toggle = button(task.status === 'done' ? 'Вернуть' : 'Выполнить', async () => {
      toggle.disabled = true;
      try { await api('/api/tasks', { ...task, expectedVersion: task.version, status: task.status === 'done' ? 'open' : 'done', requestId: crypto.randomUUID() }); await render('tasks', true); } catch (error) { notice(error.message); toggle.disabled = false; }
    }); row.append(text, toggle); root.append(row);
  } return root;
}
async function taskForm(relatedCash = null) {
  try {
    const directory = await api('/api/directory'), f = node('form'); field(f, 'Что нужно сделать', 'title', { required: true, maxLength: 200 }); select(f, 'Исполнитель', 'assigneeId', directory.map(u => [u.id, `${u.name} · ${roles[u.role]}`]), user.id);
    const requestId = crypto.randomUUID(); formSubmit(f, 'Назначить', async () => { await api('/api/tasks', { ...Object.fromEntries(new FormData(f)), expectedVersion: 0, status: 'open', relatedCash, requestId }); $('modal').close(); notice('Задача сохранена'); if (current === 'tasks') await render('tasks', true); }); modal('Новое поручение', f);
  } catch (error) { notice(error.message); }
}
async function productsPage() {
  const products = await api('/api/products'), root = surface('Товары'), editable = ['owner', 'administrator'].includes(user.role);
  const search = node('input'); search.type = 'search'; search.placeholder = 'Название или штрихкод'; search.setAttribute('aria-label', 'Поиск товара'); search.className = 'search'; root.append(search);
  if (editable) root.append(button('Добавить товар', () => productForm(), 'primary'));
  const list = node('div'); root.append(list);
  function fill() {
    list.replaceChildren(); const query = search.value.toLocaleLowerCase('ru'); const rows = products.filter(p => p.name.toLocaleLowerCase('ru').includes(query) || p.barcode.includes(query));
    if (!rows.length) list.append(node('p', 'Товары не найдены.', 'empty'));
    for (const p of rows) { const row = node('div', null, 'row'), title = node('div', null, 'row-main'); title.append(node('strong', p.name), node('small', p.barcode || 'Без штрихкода')); row.append(title, node('strong', rub(p.price), 'money')); if (editable) row.append(button('Изменить', () => productForm(p))); list.append(row); }
  } search.addEventListener('input', fill); fill(); return root;
}
function productForm(p) {
  const f = node('form'); field(f, 'Название', 'name', { value: p?.name ?? '', required: true, maxLength: 150 }); field(f, 'Штрихкод · необязательно', 'barcode', { value: p?.barcode ?? '', inputMode: 'numeric', maxLength: 32 }); field(f, 'Розничная цена, ₽', 'price', { value: p ? String(p.price / 100) : '', inputMode: 'decimal', required: true });
  const requestId = crypto.randomUUID(); formSubmit(f, 'Сохранить товар', async () => { const v = Object.fromEntries(new FormData(f)); await api('/api/products', { ...v, price: normalizeAmount(v.price), id: p?.id, expectedVersion: p?.version ?? 0, active: true, requestId }); $('modal').close(); await render('products', true); }); modal(p ? 'Изменить товар' : 'Новый товар', f);
}
async function securityPage() {
  const events = await api('/api/security'), root = surface('Журнал');
  const names = { 'owner.bootstrap': 'Создан владелец', 'account.created': 'Создан аккаунт', 'account.updated': 'Изменены права', 'login.succeeded': 'Вход', 'login.failed': 'Неудачный вход', 'login.throttled': 'Ограничены попытки входа', logout: 'Выход', 'password.changed': 'Изменён пароль', 'cash.submitted': 'Отправлена сдача', 'cash.accepted': 'Принята касса', 'task.changed': 'Изменена задача', 'product.changed': 'Изменён товар' };
  Object.assign(names, { 'backup.started': 'Начато резервирование', 'backup.completed': 'Создана проверенная копия', 'backup.failed': 'Ошибка резервирования', 'backup.downloaded': 'Скачана зашифрованная копия', 'backup.verified': 'Проверена резервная копия', 'backup.restored': 'Восстановлена отдельная база', 'backup.restore-checked': 'Проверено восстановление', 'backup.schedule-enabled': 'Включено расписание копий', 'backup.schedule-disabled': 'Отключено расписание копий' });
  Object.assign(names, { 'cash-draft.saved': 'Сохранён черновик кассы', 'cash-draft.discarded': 'Удалён черновик кассы', 'cash-draft.submitted': 'Черновик отправлен как сдача' });
  for (const e of events.reverse()) { const details = node('details'), s = node('summary', `${names[e.kind] ?? e.kind} · ${time(e.at_ms)}`); details.append(s, node('p', `Автор: ${e.actor_id ?? 'Неавторизованный вход'}`, 'fine'), node('pre', JSON.stringify(e.detail, null, 2))); root.append(details); } return root;
}
async function backupsPage() {
  const state = await api('/api/backups'), root = node('div'), actions = surface('Копия всей рабочей области');
  actions.append(node('p', 'Аккаунты, касса со всеми версиями, задачи, каталог и журнал. Копии защищены отдельным паролем и проверяются перед сохранением.', 'fine'));
  const buttons = node('div', null, 'button-row'); buttons.append(button('Создать копию', () => backupForm('create'), 'primary'), button('Настроить расписание', () => backupForm('schedule'))); actions.append(buttons);
  actions.append(help('Как хранить копии', 'Скачайте копию на другой физический носитель. Папка на том же SSD не защитит от его поломки. Запишите пароль копии отдельно: без него расшифровать файл нельзя. Копия не содержит действующих сеансов входа. Автоматическое удаление старых копий не включено.'));
  if (state.lastError) actions.append(node('p', state.lastError, 'error'));
  actions.append(node('p', state.busy ? 'Выполняется операция. Дождитесь завершения и обновите раздел.' : state.schedule ? `Автоматически каждые ${state.schedule.minutes} мин. Следующая попытка: ${time(state.schedule.nextAt)}` : state.scheduleNeedsUnlock ? 'Автокопии приостановлены. Введите пароль и включите расписание заново.' : 'Расписание не включено.', 'statusline'));
  if (state.lastSuccess) actions.append(node('p', `Последняя успешная копия: ${time(state.lastSuccess.at)}.${state.lastSuccessPresent ? '' : ' Файл больше не найден в папке — проверьте отдельный носитель.'}`, state.lastSuccessPresent ? 'fine' : 'error'));
  actions.append(node('p', 'Пароль расписания хранится только в памяти сервера. После перезапуска нужно включить расписание заново; автоматически оно не возобновится.', 'fine'));
  if (state.schedule) actions.append(button('Отключить расписание', () => backupForm('disable'), 'secondary'));
  const folders = node('details'); folders.append(node('summary', 'Папки на сервере'), node('p', state.directory, 'fine'), node('p', `Проверочные базы: ${state.restoreDirectory}`, 'fine')); actions.append(folders); root.append(actions);
  const list = surface('Сохранённые копии');
  if (!state.files.length) list.append(node('p', 'Копий пока нет.', 'empty'));
  for (const copy of state.files) {
    const row = node('div', null, 'row'), caption = node('div', null, 'row-main'); caption.append(node('strong', time(copy.at)), node('small', `${Math.ceil(copy.bytes / 1024)} КБ · зашифрованная копия`));
    row.append(caption, button('Действия', () => { const menu = node('div', null, 'backup-menu'); menu.append(node('p', copy.id, 'fine'), button('Скачать файл', () => backupForm('download', copy.id)), button('Проверить копию', () => backupForm('verify', copy.id)), button('Проверить восстановление', () => backupForm('restore', copy.id))); modal('Резервная копия', menu); })); list.append(row);
  }
  root.append(list); return root;
}
function backupForm(operation, id) {
  const labels = { create: ['Создать копию', 'Создать и проверить'], schedule: ['Автоматические копии', 'Создать копию и включить'], verify: ['Проверка копии', 'Проверить'], restore: ['Проверка восстановления', 'Восстановить отдельно'], download: ['Скачать копию', 'Скачать файл'], disable: ['Отключить расписание', 'Отключить'] };
  const f = node('form');
  if (['create', 'schedule', 'verify', 'restore'].includes(operation)) {
    field(f, 'Пароль резервной копии', 'password', { type: 'password', required: true, minLength: 15, maxLength: 128, autocomplete: ['create', 'schedule'].includes(operation) ? 'new-password' : 'off' });
    if (['create', 'schedule'].includes(operation)) field(f, 'Повторите пароль копии', 'passwordAgain', { type: 'password', required: true, minLength: 15, maxLength: 128, autocomplete: 'new-password' });
  }
  if (operation === 'schedule') { field(f, 'Период, минут · от 10 до 1440', 'minutes', { type: 'number', min: 10, max: 1440, step: 1, value: '60', required: true }); f.append(node('p', 'После остановки сервера пароль не сохраняется. Старые копии автоматически не удаляются.', 'fine')); }
  if (operation === 'restore') f.append(node('p', 'Создадим отдельную проверочную базу. Действующая база не заменяется. Старые сеансы входа не восстанавливаются.', 'fine'));
  field(f, 'Ваш текущий пароль для подтверждения', 'currentPassword', { type: 'password', required: true, maxLength: 128, autocomplete: 'current-password' });
  const progress = node('p', '', 'fine'); progress.setAttribute('role', 'status'); f.append(progress);
  formSubmit(f, labels[operation][1], async () => {
    const payload = { ...Object.fromEntries(new FormData(f)), ...(id ? { id } : {}) };
    if (operation === 'schedule') payload.minutes = Number(payload.minutes);
    if (payload.passwordAgain !== undefined && payload.passwordAgain !== payload.password) throw new Error('Пароли резервной копии не совпадают');
    progress.textContent = 'Обрабатываем и проверяем. Можно подождать; не закрывайте окно.';
    const fields = [...f.querySelectorAll('input,select')].map(e => [e, e.disabled]);
    for (const [e] of fields) e.disabled = true;
    try {
      if (operation === 'download') {
        const issued = generation, response = await fetch('/api/backups/download', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Way-Token': csrf }, body: JSON.stringify(payload) });
        if (!response.ok) { const result = await response.json(); if (response.status === 401) { scrub(); showEntry(); } throw new Error(result.error); }
        const blob = await response.blob(); if (issued !== generation) throw new Error('Сеанс изменён. Повторите скачивание после входа');
        const url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = id; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        f.reset(); $('modal').close(); notice('Файл передан браузеру. Сохраните на отдельный носитель.');
      } else {
        const result = await api(`/api/backups/${operation}`, payload); f.reset();
        if (operation === 'restore') {
          const done = node('div'); done.append(node('p', 'Отдельная база восстановлена и проверена. Действующая база не заменена.'), node('p', result.path, 'fine'), node('p', `Пользователей: ${result.stats.users}. Сдач: ${result.stats.cash}. Версий: ${result.stats.cashVersions}. Задач: ${result.stats.tasks}. Товаров: ${result.stats.products}.`, 'fine')); $('modal-body').replaceChildren(done);
        } else { $('modal').close(); notice(operation === 'verify' ? 'Копия расшифрована: структура, связи и расчёты прошли проверку.' : operation === 'disable' ? 'Расписание отключено.' : 'Копия создана и проверена.'); }
      }
      if (user) await checkSession();
      if (user && current === 'backups') await render('backups', true);
    } finally { payload.password = payload.passwordAgain = payload.currentPassword = ''; for (const [e, disabled] of fields) e.disabled = disabled; progress.textContent = ''; }
  }); modal(labels[operation][0], f);
}

async function cashPage() {
  const [records, drafts] = await Promise.all([api('/api/cash'), api('/api/cash-drafts')]), root = surface('Сдачи смен'); root.append(button('Новая сдача', () => cashForm(), 'primary'));
  if (drafts.length) {
    const saved = surface('Мои черновики'); saved.append(node('p', 'Это сохранённый ввод. Он не изменяет кассу и не подтверждает приём денег.', 'fine'));
    for (const draft of drafts) {
      const row = node('div', null, 'row draft-row'), caption = node('div', null, 'row-main'); caption.append(node('strong', draft.fields.shiftNo ? `Смена ${draft.fields.shiftNo}` : 'Новая сдача'), node('small', `${time(draft.at)}${draft.outdated ? ' · сдача уже изменена' : ''}`));
      const open = button('Продолжить', async () => { try { const record = draft.slot === 'new' ? undefined : await api(`/api/cash/${draft.slot}`); await cashForm(record, false, true); } catch (e) { notice(e.message); } });
      const discard = button('Удалить', async () => {
        if (!confirm('Удалить этот черновик? Сохранённые кассовые сдачи не изменятся.')) return;
        discard.disabled = true;
        try { await api('/api/cash-drafts', { slot: draft.slot, expectedVersion: draft.version, baseVersion: draft.baseVersion, fields: null, requestId: crypto.randomUUID() }); notice('Черновик удалён'); await render('cash', true); } catch (e) { notice(e.message); discard.disabled = false; }
      }); row.append(caption, open, discard); saved.append(row);
    } root.append(saved);
  }
  if (!records.length) root.append(node('p', 'Сдач пока нет. Сначала создайте аккаунты кассиров, затем заполните первую смену.', 'empty'));
  for (const c of records) {
    const row = button('', () => cashForm(c), 'row row-button'), text = node('div', null, 'row-main'); text.append(node('strong', `${c.input.cashier} · ${c.input.date.split('-').reverse().join('.')}`), node('small', `${c.input.register} · смена ${c.input.shiftNo} · версия ${c.version}`)); row.append(text, node('span', c.status === 'accepted' ? 'Принято' : 'На проверке', `badge ${c.status === 'accepted' ? 'ok' : ''}`)); root.append(row);
  } return root;
}
async function cashForm(record, viewOnly = false, recover = false) {
  try {
    if (pending) { notice('Дождитесь ответа сервера.'); return; }
    if (dirty && !confirm('Открыть другую сдачу? Несохранённые изменения будут потеряны.')) return;
    const opening = ++renderVersion;
    const slot = record?.id ?? 'new';
    const [directory, draft] = await Promise.all([api('/api/directory'), viewOnly ? null : api(`/api/cash-drafts/${slot}`)]);
    if (opening !== renderVersion || !user) return;
    if (draft?.fields && draft.outdated) {
      const content = node('div'); content.append(node('p', 'Сдача уже изменена после сохранения черновика. Ввод сохранён ниже для сверки. Автоматическое наложение на новую версию отключено.'));
      const captions = { date: 'Дата смены', shiftNo: 'Номер смены', cashierId: 'Кассир', cashBasis: 'Основа наличного отчёта', 'policy-cashReturns': 'Правило возвратов наличными', 'policy-bankReturns': 'Правило возвратов эквайринга', ownerKind: 'Чеки владельца', receipts: 'Количество чеков', documents: 'Количество ФД', reason: 'Причина исправления' };
      const choices = { collection: 'Инкассация: внесение включено', sales: 'Продажи: внесение отдельно', review: 'Нужно уточнить', included: 'Уже учтены в суммах', subtract: 'Вычитать отдельно', outside: 'Другой период', cash: 'Взял деньги', 'goods-in-cash': 'Товар включён в наличные', 'goods-outside': 'Товар вне наличных' };
      for (const [name, value] of Object.entries(draft.fields)) if (value) { const label = EXCEL_FIELDS.find(f => f.id === name)?.label ?? captions[name] ?? 'Дополнительная строка', display = name === 'cashierId' ? directory.find(u => u.id === value)?.name ?? 'Сотрудник' : ['cashBasis', 'ownerKind', 'policy-cashReturns', 'policy-bankReturns'].includes(name) ? choices[value] ?? value : value; content.append(node('p', `${label}: ${display}`)); }
      content.append(button('Вернуться к списку', () => { $('modal').close(); render('cash'); })); modal('Нужно сверить черновик', content); return;
    }
    if (draft?.fields && !recover && !confirm('Восстановить ваш сохранённый черновик этой сдачи? Для удаления черновика вернитесь к списку кассы.')) return;
    const settings = record ? structuredClone(record.input.worksheet.settings) : defaultExcelSettings();
    if (!record) { for (const id of ['claimed', 'retained']) { const row = settings.rows.find(r => r.id === id); row.enabled = row.visible = true; } }
    const input = record ? structuredClone(record.input) : { date: today(), register: settings.register, shiftNo: '', cashier: user.name, author: user.name, accountant: managesCash() ? user.name : 'Ожидает приёма', worksheet: { settings, values: Object.fromEntries(EXCEL_FIELDS.map(f => [f.id, ''])), counts: { receipts: '', documents: '' }, sourceNote: '' } };
    // The controls, preview and submitted snapshot must share the same rules.
    input.worksheet.settings = settings;
    if (managesCash() && !record) input.worksheet.values.received = '';
    const readonly = viewOnly || user.role === 'cashier' && record?.status === 'accepted';
    const form = node('form'), metadata = surface(), fields = node('div', null, 'fields'); metadata.append(fields);
    field(fields, 'Дата смены', 'date', { value: input.date, type: 'date', required: true, disabled: Boolean(record) }); field(fields, 'Номер смены из отчёта', 'shiftNo', { value: input.shiftNo, maxLength: 50, required: true, disabled: Boolean(record) });
    const cashiers = directory.filter(u => ['owner', 'accountant', 'cashier', 'employee'].includes(u.role));
    const cashier = select(fields, 'Кассир', 'cashierId', cashiers.map(u => [u.id, u.name]), record?.cashierId ?? user.id); cashier.disabled = Boolean(record) || user.role === 'cashier';
    metadata.append(node('p', `Автор ввода: ${user.name}. ${record ? `Версия ${record.version}.` : 'Новая сдача.'}`, 'fine')); form.append(metadata);
    const grid = node('div', null, 'grid'), cash = surface('Наличные'), bank = surface('Эквайринг'); grid.append(cash, bank); form.append(grid);
    const rules = node('details'); rules.append(node('summary', 'Правила отчётов и дополнительные сведения'));
    const financialInputs = new Map();
    for (const r of [...settings.rows, ...settings.custom]) {
      if (!r.enabled || r.id === 'received') continue;
      const def = EXCEL_FIELDS.find(f => f.id === r.id) ?? { group: 'cash', type: 'money' };
      const label = node('label', null, 'cash-label'), control = node('input'); label.append(node('span', r.label), control); control.name = r.id; control.inputMode = def.type === 'count' ? 'numeric' : 'decimal'; control.value = input.worksheet.values[r.id] ?? ''; control.placeholder = '—'; control.disabled = readonly; control.setAttribute('aria-label', `${def.group === 'bank' ? 'Эквайринг: ' : ''}${r.label}`); (def.type === 'count' ? rules : def.group === 'bank' ? bank : cash).append(label); financialInputs.set(r.id, control);
    }
    select(rules, 'Наличные в отчёте', 'cashBasis', [['collection', 'Инкассация: внесение включено'], ['sales', 'Продажи: внесение отдельно']], settings.cashBasis);
    for (const [key, label] of [['cashReturns', 'Возвраты наличными'], ['bankReturns', 'Возвраты эквайринга']]) select(rules, label, `policy-${key}`, [['review', 'Нужно уточнить при ненулевой сумме'], ['included', 'Уже учтены в суммах'], ['subtract', 'Вычитать отдельно'], ['outside', 'Другой период / накопительный итог']], settings[key]);
    select(rules, 'Чеки владельца', 'ownerKind', [['review', 'Нужно уточнить при ненулевой сумме'], ['cash', 'Взял деньги'], ['goods-in-cash', 'Взял товар: чек включён в наличные'], ['goods-outside', 'Взял товар: чек вне наличных']], settings.ownerKind);
    field(rules, 'Чеков за смену · необязательно', 'receipts', { inputMode: 'numeric', value: input.worksheet.counts.receipts }); field(rules, 'ФД за смену · необязательно', 'documents', { inputMode: 'numeric', value: input.worksheet.counts.documents }); form.append(rules);
    let received;
    if (managesCash()) { const fact = surface('Приём денег'); received = field(fact, 'Получено и пересчитано бухгалтером, ₽', 'received', { value: input.worksheet.values.received, inputMode: 'decimal', placeholder: 'Заполняется после пересчёта' }); fact.append(help('Независимый пересчёт', 'Это деньги, которые бухгалтер действительно получил и пересчитал. Заявление кассира и расчёт программы не заменяют этот факт.')); form.append(fact); }
    const report = surface('Итог'), total = node('div', null, 'amount'), lines = node('dl'), errors = node('p', '', 'error'); report.classList.add('cash-report'); report.append(total, lines, errors, help('Как считается', 'К передаче: наличные продажи после возвратов плюс фактическое начало и поступления, минус выполненные выплаты, предыдущие передачи и оставленные деньги. Инкассация, включающая внесение, очищается от него один раз. Один и тот же платёж нельзя вводить повторно. Плюс — излишек, минус — недостача относительно выбранной базы.')); form.append(report);
    let reason;
    if (record && !readonly) reason = field(form, 'Что исправлено и почему', 'reason', { maxLength: 500, required: true, placeholder: 'Для каждой новой версии' });
    const bar = node('div', null, 'save-bar'), state = node('small', record ? `Сохранено · версия ${record.version}` : 'Не сохранено'), actions = node('div', null, 'button-row'); bar.append(state, actions);
    const save = button('Отправить сдачу', () => submit(false), 'primary'), accept = button('Принять кассу', () => submit(true), 'primary');
    if (!readonly) actions.append(button('Сохранить черновик', () => saveDraft()));
    if (!readonly && (!record || record.status !== 'accepted')) actions.append(save); if (managesCash() && !readonly) actions.append(accept);
    if (readonly) bar.append(node('span', 'Версия открыта только для просмотра', 'fine'));
    if (record) actions.append(button('История', async () => {
      try { const versions = await api(`/api/cash/${record.id}/history`), list = node('div');
        for (const v of versions) { const row = node('div', null, 'row'), caption = node('div', null, 'row-main'); caption.append(node('strong', `Версия ${v.version} · ${v.input.author}`), node('small', `${time(v.at)} · ${v.reason || 'Первичное сохранение'}`)); row.append(caption, button('Просмотр', () => { $('modal').close(); cashForm(v, true); })); list.append(row); } modal('История сдачи', list);
      } catch (e) { notice(e.message); }
    }));
    if (record) actions.append(button('Печать', () => printCash(record)));
    if (record && managesCash()) actions.append(button('Задача по сдаче', () => taskForm(record.id)));
    form.append(bar); form.addEventListener('submit', e => e.preventDefault());
    form.addEventListener('keydown', e => { if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return; e.preventDefault(); const fields = [...form.querySelectorAll('input:not(:disabled),select:not(:disabled)')]; const index = fields.indexOf(e.target); fields[index + (e.shiftKey ? -1 : 1)]?.focus(); });
    function update() {
      input.date = fields.querySelector('[name=date]').value; input.shiftNo = fields.querySelector('[name=shiftNo]').value;
      for (const [id, control] of financialInputs) input.worksheet.values[id] = normalizeAmount(control.value, EXCEL_FIELDS.find(f => f.id === id)?.type ?? 'money');
      input.worksheet.values.received = received ? normalizeAmount(received.value) : '';
      settings.cashBasis = rules.querySelector('[name=cashBasis]').value; settings.ownerKind = rules.querySelector('[name=ownerKind]').value;
      for (const key of ['cashReturns', 'bankReturns']) settings[key] = rules.querySelector(`[name=policy-${key}]`).value;
      input.worksheet.counts = { receipts: rules.querySelector('[name=receipts]').value, documents: rules.querySelector('[name=documents]').value };
      lines.replaceChildren();
      try {
        const r = evaluateExcel(input); total.textContent = rub(r.expected); lines.append(...[['Эквайринг', rub(r.bankNet)], ['Разница эквайринга', signed(r.bankDifference)], ['Всего продаж по отчётам', rub(r.totalSales)], ['По подсчёту кассира', rub(r.values.claimed)], ...(managesCash() ? [['Факт минус расчёт', signed(r.difference)]] : [])].map(([label, value]) => { const row = node('div'); row.append(node('dt', label), node('dd', value)); return row; }));
        const diff = lines.lastChild?.querySelector('dd'); if (managesCash() && r.difference) diff.className = r.difference > 0 ? 'positive' : 'negative';
        errors.textContent = r.errors.length ? `${r.errors.length} ${r.errors.length === 1 ? 'поле требует' : 'полей требуют'} заполнения или уточнения. Если движения не было — укажите 0.` : '';
        return r;
      } catch (e) { errors.textContent = e.message; return null; }
    }
    let working = false, command = null, draftCommand = null, draftVersion = draft?.version ?? 0, hasDraft = Boolean(draft?.fields);
    function rawFields() { return Object.fromEntries([...form.querySelectorAll('input,select')].map(c => [c.name, c.value])); }
    async function saveDraft() {
      if (working || readonly) return;
      const issued = generation, savingView = renderVersion, operation = {};
      draftCommand ??= { slot, expectedVersion: draftVersion, baseVersion: record?.version ?? 0, fields: rawFields(), requestId: crypto.randomUUID() };
      const controls = [...form.querySelectorAll('input,select,button')].map(c => [c, c.disabled]);
      for (const [c] of controls) c.disabled = true;
      working = true; pending = operation; state.textContent = 'Сохраняем черновик…';
      try {
        const saved = await api('/api/cash-drafts', draftCommand);
        if (issued !== generation || savingView !== renderVersion) return;
        draftVersion = saved.version; hasDraft = true; draftCommand = null; command = null; dirty = false;
        state.textContent = `Черновик сохранён на сервере · ${time(saved.at)}. Изменения не применены к сдаче.`;
        notice('Черновик сохранён. Его можно продолжить после входа.');
      } catch (e) { if (issued === generation && savingView === renderVersion) state.textContent = e.message; }
      finally { working = false; if (pending === operation) pending = null; for (const [c, disabled] of controls) c.disabled = disabled; }
    }
    async function submit(isAccept) {
      if (working) return; const r = update();
      if (!r || r.errors.length) { const first = r?.errors[0]; errors.textContent = first?.message ?? errors.textContent; const target = first?.setting ? rules : financialInputs.get(first?.field); if (first?.setting) rules.open = true; target?.focus(); return; }
      if (!form.reportValidity()) return;
      command ??= { requestId: crypto.randomUUID(), id: record?.id, expectedVersion: record?.version ?? 0, cashierId: record?.cashierId ?? cashier.value, input: structuredClone(input), reason: reason?.value ?? '', accept: isAccept, ...(hasDraft ? { draft: { slot, version: draftVersion } } : {}) };
      if (command.accept !== isAccept) { notice('Повторите прежнее действие или измените данные. Результат предыдущей отправки может требовать проверки.'); return; }
      const savingView = renderVersion;
      const controls = [...form.querySelectorAll('input,select,button')].map(c => [c, c.disabled]);
      for (const [c] of controls) c.disabled = true;
      const operation = {}; pending = operation; working = true; state.textContent = 'Сохраняем…';
      try { const result = await api('/api/cash', command); notice(isAccept ? 'Касса принята. Версия сохранена.' : 'Сдача отправлена на проверку.'); if (savingView !== renderVersion) return; dirty = false; command = null; const saved = await api(`/api/cash/${result.id}`); if (pending === operation) pending = null; if (savingView === renderVersion) await cashForm(saved); }
      catch (e) { state.textContent = e.message; } finally { working = false; if (pending === operation) pending = null; for (const [c, disabled] of controls) c.disabled = disabled; }
    }
    form.addEventListener('input', () => { if (readonly) return; dirty = true; command = null; draftCommand = null; state.textContent = 'Есть несохранённые изменения. Можно сохранить черновик.'; update(); });
    form.addEventListener('change', () => { if (readonly) return; dirty = true; command = null; draftCommand = null; state.textContent = 'Есть несохранённые изменения. Можно сохранить черновик.'; update(); });
    if (draft?.fields && !readonly) {
      for (const control of form.querySelectorAll('input,select')) if (Object.hasOwn(draft.fields, control.name)) control.value = draft.fields[control.name];
      state.textContent = `Восстановлен черновик · ${time(draft.at)}. Изменения не применены к сдаче.`;
    }
    if (readonly) for (const c of form.querySelectorAll('input,select')) c.disabled = true;
    if (!user) return; dirty = false; pending = null; current = 'cash'; ++renderVersion; $('title').textContent = record ? `Смена ${input.shiftNo}` : 'Новая сдача'; $('subtitle').textContent = 'Заполнение и итог на одном экране.'; $('page').replaceChildren(form); update(); window.scrollTo(0, 0);
  } catch (error) { notice(error.message); }
}
function printCash(record) {
  // Use the captured server snapshot, never editable fields from the current form.
  document.getElementById('workspace-print')?.remove();
  const sheet = node('section', null, 'print-only'); sheet.id = 'workspace-print';
  sheet.append(node('h1', 'Сдача кассы'), node('p', `${record.input.date} · ${record.input.register} · смена ${record.input.shiftNo}`), node('p', `Кассир: ${record.input.cashier}. Автор: ${record.input.author}. Версия ${record.version}.`));
  const table = node('table');
  for (const row of [...record.input.worksheet.settings.rows, ...record.input.worksheet.settings.custom].filter(r => r.enabled)) { const tr = node('tr'); tr.append(node('td', row.label), node('td', record.input.worksheet.values[row.id] || 'Не указано')); table.append(tr); }
  sheet.append(table, node('p', `К передаче: ${rub(record.result.expected)}. Принято: ${rub(record.result.received)}. Расхождение: ${signed(record.result.receivedDifference)}.`), node('p', 'Передал: ____________________  Принял: ____________________'), node('p', 'Тестовый бланк. Подписи ставятся на бумаге.'));
  document.body.append(sheet); document.body.classList.add('printing');
  try { window.print(); } finally { document.body.classList.remove('printing'); sheet.remove(); }
}
$('profile-button').addEventListener('click', () => {
  const content = node('div'); content.append(node('p', `${user.name} · ${roles[user.role]}`));
  if (user.role === 'owner') content.append(button('Сотрудники', () => { $('modal').close(); render('users'); }), button('История действий', () => { $('modal').close(); render('security'); }));
  if (user.role === 'owner' && capabilities.backups) content.append(button('Резервные копии', () => { $('modal').close(); render('backups'); }));
  content.append(button('Сменить пароль', () => {
    const f = node('form'); field(f, 'Текущий пароль', 'currentPassword', { type: 'password', autocomplete: 'current-password', required: true }); field(f, 'Новый пароль-фраза · от 15 символов', 'password', { type: 'password', autocomplete: 'new-password', minLength: 15, maxLength: 128, required: true });
    formSubmit(f, 'Сменить пароль', async () => { await api('/api/password', Object.fromEntries(new FormData(f))); f.reset(); scrub(); showEntry(); channel?.postMessage('changed'); notice('Пароль изменён. Войдите заново.'); }); modal('Смена пароля', f);
  }));
  content.append(button('Выйти', async () => { if (dirty && !confirm('Выйти и потерять несохранённый ввод?')) return; try { await api('/api/logout', {}); scrub(); showEntry(); channel?.postMessage('changed'); } catch (error) { notice(error.message); } }, 'danger')); modal('Мой аккаунт', content);
});
await checkSession();
