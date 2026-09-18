/* ============================================================================
   Проверка того, чем стало приложение Auron Finance: одна страница полного
   учёта с данными владельца из его таблицы.
   Запуск:  node tests/проверка-auron-finance.mjs   (из папки desktop)

   Здесь проверяется СОБРАННАЯ страница (webapp/Uchet.html) — та самая, что
   уезжает в Apps Script, — и подделанный сервер вместо Google. Проверять
   исходники бессмысленно: между ними и владельцем стоит сборка и вставка
   данных, и ломалось до сих пор именно там:

   1. Вставка данных попадала внутрь чужой библиотеки (у неё в коде есть
      строка «</body>») и ломала чтение Excel.
   2. Метка с данными стояла в конце страницы, а читается она в середине —
      программа открывалась бы пустой, хотя данные пришли.

   Обе ошибки проходили молча: экраны открывались, ошибок в консоли не
   было. Поэтому смотрим не «открылось ли», а «видны ли деньги владельца
   и доходит ли запись до сервера».
   ========================================================================== */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ЗДЕСЬ = path.dirname(fileURLToPath(import.meta.url));
const КОРЕНЬ = path.join(ЗДЕСЬ, '..', '..');
const СТРАНИЦА = path.join(КОРЕНЬ, 'webapp', 'Uchet.html');

async function загрузитьБраузер() {
  for (const где of ['playwright-core', 'playwright']) {
    try { const m = await import(где); if (m.chromium) return m.chromium; } catch (e) { /* дальше */ }
  }
  return null;
}
const chromium = await загрузитьБраузер();
if (!chromium) { console.log('Playwright не установлен — проверка пропущена.'); process.exit(0); }
const БРАУЗЕР = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!fs.existsSync(БРАУЗЕР)) { console.log('Chromium не найден — проверка пропущена.'); process.exit(0); }

// Страницу собираем всегда заново: проверять надо то, что уедет владельцу.
execFileSync('node', [path.join(КОРЕНЬ, 'webapp', 'build-uchet.js')], { stdio: 'ignore' });

let passed = 0, failed = 0;
function check(name, ok, got, want) {
  if (ok) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}

/* --- Данные владельца, как их отдаёт лист таблицы ------------------------- */
const дата = (д) => new Date(2026, 8, д).toISOString();
const БАЗА = [
  ['ID', 'UUID', 'Дата', 'Тип', 'Категория', 'Сумма', 'Счёт', 'Сотрудник',
    'Комментарий', 'Чек', 'Z_Ref', 'Locked', 'Смена'],
  [1, 'u-1', дата(15), 'Расход', 'Аренда', 40000, 'Наличные', '', '', '', '', false, ''],
  [2, 'u-2', дата(16), 'Доход', 'Прочий приход', 15000, 'Карта Сбербанк', '', '', '', '', false, ''],
  // строки смены — приедут сменой, отдельными приходами быть не должны
  [3, 'u-3', дата(15), 'Доход', 'Продажи', 90000, 'Наличные', 'Марина', 'Z-отчёт', '', 'z1', true, '1'],
  [4, 'u-4', дата(15), 'Доход', 'Продажи', 30000, 'Карта Сбербанк', 'Марина', 'Z-отчёт', '', 'z1', true, '1']
];
const boot = {
  ssId: 'таблица-владельца',
  uchet: '',                      // своей базы у программы ещё нет — первый запуск
  db: {
    'СЧЕТА': [['ID', 'Название', 'Нач_Баланс', 'Статус', 'Иконка', 'Цвет'],
      ['a1', 'Наличные', 5000, 'активен', '', ''],
      ['a2', 'Карта Сбербанк', 0, 'активен', '', '']],
    'БАЗА': БАЗА,
    'СМЕНЫ': [['ID', 'Дата', 'Смена', 'Кассир', 'Rows_JSON', 'Wyplatas_JSON', 'Расхождение', 'Создано'],
      ['z1', дата(15), '1', 'Марина',
        JSON.stringify({ cashRev: 90000, cardRevs: [{ amount: 30000, account: 'Карта Сбербанк' }],
          cashSupp: 12000, cashLeft: 5000, cashCollect: 68000 }),
        JSON.stringify([{ amount: 5000, desc: 'Обед' }]), 0, дата(15)]],
    'ТАБЕЛЬ': [['Год', 'Месяц', 'День', 'Сотрудник', 'Приход', 'Уход', 'Статус', 'Часы', 'Ставка', 'Комментарий'],
      [2026, 9, 15, 'Марина', '09:00', '21:00', 'смена', 12, 2500, '']]
  }
};

/* Подделка сервера Google: отвечает так же, как Apps Script, и запоминает,
   что ему прислали на сохранение. */
const ЗАГЛУШКА = `
<script>
window.__сохранено = [];
window.google = { script: { run: (function () {
  var ok = null, err = null;
  var api = {
    withSuccessHandler: function (f) { ok = f; return api; },
    withFailureHandler: function (f) { err = f; return api; },
    uchetSave: function (p) { window.__сохранено.push(p); if (ok) setTimeout(function(){ ok({ ok: true }); }, 0); }
  };
  return api;
})() } };
</script>`;

const страница = fs.readFileSync(СТРАНИЦА, 'utf8')
  .replace('/*AURON_BOOT*/null/*/AURON_BOOT*/', JSON.stringify(boot).replace(/</g, '\\u003c'))
  .replace('<head>', '<head>' + ЗАГЛУШКА);

const srv = http.createServer((q, s) => {
  s.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
  s.end(страница);
});
await new Promise(r => srv.listen(0, r));

const b = await chromium.launch({ executablePath: БРАУЗЕР, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message.split('\n')[0]));

console.log('\n— Приложение открывается полным учётом');
await p.goto(`http://localhost:${srv.address().port}/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);

check('это полный учёт, а не прежний экран', (await p.title()) === 'Учёт магазина', await p.title());
const виды = await p.evaluate(() => window.WMUI && window.WMUI.views ? window.WMUI.views().length : 0);
check('все экраны на месте', виды >= 44, виды, '44 и больше');
check('программа поняла, что работает на сервере',
  await p.evaluate(() => window.AURON_SERVER === true), 'да', 'да');

console.log('\n— Деньги владельца видны сразу, а не «через секунду»');
const св = await p.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('store_erp_v1') || '{}');
  const зерк = (st.dds || []).filter(r => r.src === 'auron');
  return {
    операций: зерк.filter(r => r.type === 'Приход' || r.type === 'Расход').length,
    смен: зерк.filter(r => r.type === 'Смена').length,
    счетов: (st.accounts || []).filter(a => a.src === 'auron').length,
    сотрудников: (st.staff || []).length,
    задвоено: зерк.filter(r => r.type === 'Приход' && r.amount === 90000).length
  };
});
check('операции из таблицы перенеслись', св.операций === 2, св.операций, 2);
check('СМЕНА ПРИЕХАЛА СМЕНОЙ', св.смен === 1, св.смен, 1);
check('ВЫРУЧКА СМЕНЫ НЕ ЗАДВОИЛАСЬ', св.задвоено === 0, св.задвоено, 0);
check('счета перенеслись', св.счетов === 2, св.счетов, 2);
check('сотрудник перенёсся', св.сотрудников === 1, св.сотрудников, 1);

const видноНаЭкране = await p.evaluate(() => {
  const el = document.querySelector('[data-go="pulse"]'); if (el) el.click();
  return new Promise(r => setTimeout(() => r(document.getElementById('page').innerText), 600));
});
check('И ЦИФРЫ ВИДНЫ НА ЭКРАНЕ, А НЕ ТОЛЬКО В ПАМЯТИ',
  /\d/.test(видноНаЭкране) && видноНаЭкране.length > 50, видноНаЭкране.slice(0, 60).replace(/\n/g, ' '), 'непусто');

console.log('\n— Запись уходит в таблицу владельца');
await p.evaluate(() => {
  WMStore.add('dds', { type: 'Расход', date: '2026-09-18', category: 'Проверка', amount: 777 });
  WMStore.save();
});
await p.waitForTimeout(2500);
const отправлено = await p.evaluate(() => window.__сохранено.map(x => ({ ssId: x.ssId, длина: (x.json || '').length })));
check('сохранение ушло на сервер', отправлено.length > 0, отправлено.length, '> 0');
check('и в нужную таблицу', отправлено[0] && отправлено[0].ssId === 'таблица-владельца',
  отправлено[0] && отправлено[0].ssId, 'таблица-владельца');
const содержит = await p.evaluate(() => {
  const п = window.__сохранено[window.__сохранено.length - 1];
  return !!(п && п.json && п.json.indexOf('Проверка') >= 0);
});
check('В ОТПРАВЛЕННОМ ЕСТЬ ТОЛЬКО ЧТО ЗАПИСАННОЕ', содержит, содержит, true);
const подпись = await p.evaluate(() => (document.getElementById('saveState') || {}).innerText || '');
check('владельцу написано, где хранятся записи', /табл/i.test(подпись), подпись.trim(), 'про таблицу');

console.log('\n— Чужая библиотека не пострадала при вклейке');
check('чтение Excel на месте', await p.evaluate(() => typeof XLSX !== 'undefined' && !!XLSX.read),
  'на месте', 'на месте');
check('отчёты PDF на месте', await p.evaluate(() => typeof jspdf !== 'undefined' || typeof jsPDF !== 'undefined'),
  'на месте', 'на месте');
check('графики на месте', await p.evaluate(() => typeof Chart !== 'undefined'), 'на месте', 'на месте');

console.log('\n— Ни одной ошибки на странице');
check('в консоли чисто', errs.length === 0, errs.slice(0, 3).join(' | ') || 'чисто', 'чисто');

console.log('\nИтог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
await b.close(); srv.close();
process.exit(failed ? 1 : 0);
