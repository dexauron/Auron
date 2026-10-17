import { reconcile, reconcileNonCash } from '/domain.mjs';
const $ = id => document.getElementById(id);
const form = $('shift-form');
const iconPaths = { cash: 'M3 5h18v14H3z M3 9h18 M8 14h3', history: 'M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v5l3 2', info: 'M12 8h.01 M12 11v6 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', plus: 'M12 5v14 M5 12h14', backup: 'M4 9h16v11H4z M3 4h18v5H3z M9 13h6 M12 13v4' };
for (const node of document.querySelectorAll('[data-icon]')) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', iconPaths[node.dataset.icon]); svg.append(path); node.append(svg);
}

const amountFields = ['opening', 'zCash', 'otherIn', 'retained', 'claimed', 'received'];
const fields = ['date', 'register', 'shiftNo', 'cashier', 'author', 'accountant', ...amountFields];
const rub = n => n == null ? 'Не указано' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
const el = (tag, value, className) => { const n = document.createElement(tag); if (value != null) n.textContent = value; if (className) n.className = className; return n; };
let token = '', saved = null, pending = null, dirty = false, busy = false;
const sources = { cash: 'Наличные', card: 'Карта', sbp: 'СБП' };
const date = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const nonCashFields = ['zMode', 'zSales', 'zReturns', 'zNet', 'reportMode', 'reportSales', 'reportReturns', 'reportNet', 'reportRef'];
let legacyNonCash;
for (const [prefix, title] of [['z', 'По кассовому отчёту'], ['report', 'По итоговым отчётам терминалов']]) {
  const section = el('div', null, 'noncash-channel');
  section.append(el('h3', title));
  const grid = el('div', null, 'fields');
  const modeLabel = el('label', 'Основа суммы', 'wide'), mode = el('select'); mode.name = `${prefix}Mode`;
  for (const [value, label] of [['net', 'Итог после возвратов'], ['gross', 'Продажи и возвраты отдельно']]) { const o = el('option', label); o.value = value; mode.append(o); }
  modeLabel.append(mode); grid.append(modeLabel);
  for (const [suffix, label] of [['Net', 'Безналичный итог после возвратов'], ['Sales', 'Безналичные продажи до возвратов'], ['Returns', 'Безналичные возвраты']]) {
    const field = el('label', label); field.dataset.basis = suffix === 'Net' ? 'net' : 'gross'; field.dataset.prefix = prefix;
    const control = el('input'); control.name = `${prefix}${suffix}`; control.inputMode = 'decimal'; control.placeholder = 'Не указано';
    field.append(control); grid.append(field);
  }
  section.append(grid); $('noncash-groups').append(section);
  mode.addEventListener('change', () => {
    const unused = mode.value === 'net' ? ['Sales', 'Returns'] : ['Net'];
    if (unused.some(k => form.elements[`${prefix}${k}`].value !== '') && !window.confirm('Изменить основу? Значения прежней основы будут очищены; сохранённая история не изменится.')) {
      mode.value = mode.value === 'net' ? 'gross' : 'net';
    } else for (const key of unused) form.elements[`${prefix}${key}`].value = '';
    updateModes();
  });
}
const refLabel = el('label', 'Источники и период отчётов терминалов'), ref = el('input'); ref.name = 'reportRef'; ref.maxLength = 200; refLabel.append(ref);
const periodLabel = el('label', null, 'check'), period = el('input'); period.type = 'checkbox'; period.name = 'periodConfirmed';
periodLabel.append(period, el('span', 'Проверены одинаковый период и полный набор терминалов; суммы кассы и терминалов сопоставимы'));
const nonCashStatus = el('p', null, 'hint'); nonCashStatus.id = 'noncash-status';
const nonCashDifference = el('strong', 'Не указано'); nonCashDifference.id = 'noncash-difference';
$('noncash-groups').append(refLabel, periodLabel, el('p', 'Терминалы минус касса'), nonCashDifference, nonCashStatus);
function updateModes() {
  const enabled = form.elements.cashSetupEnabled.checked;
  $('cash-setup-fields').hidden = !enabled; $('payment-mode-wrap').hidden = !enabled;
  const totals = enabled && form.elements.paymentMode.value === 'totals';
  $('payment-totals').hidden = !totals; $('add-payment').hidden = totals;
  // Existing details remain visible so a mode conflict cannot hide paid amounts.
  $('no-payments').hidden = totals || $('payments').children.length > 0;
  for (const label of document.querySelectorAll('[data-basis]')) label.hidden = form.elements[`${label.dataset.prefix}Mode`].value !== label.dataset.basis;
}
function fillNonCash(raw = {}) {
  legacyNonCash = raw.mode !== 'aggregate' && Object.keys(raw).length ? raw : undefined;
  for (const key of nonCashFields) form.elements[key].value = raw.mode === 'aggregate' ? (raw[key] ?? (key.endsWith('Mode') ? 'net' : '')) : (key.endsWith('Mode') ? 'net' : '');
  form.elements.periodConfirmed.checked = raw.periodConfirmed === true;
  for (const key of [...nonCashFields, 'periodConfirmed']) form.elements[key].disabled = Boolean(legacyNonCash);
  updateModes();
}
function previewNonCash(raw) {
    try {
      const r = reconcileNonCash(raw);
      nonCashDifference.textContent = r.mode === 'aggregate' ? rub(r.difference) : 'Сохранён прежний формат';
      nonCashDifference.className = r.difference < 0 ? 'negative' : r.difference > 0 ? 'positive' : '';
      nonCashStatus.textContent = r.mode !== 'aggregate' ? 'Ранее введённая детализация сохранена. Общие поля ниже не заменяют её автоматически.' : r.difference == null ? 'Для сверки нужны оба источника и подтверждение сопоставимости периода.' : r.difference === 0 ? 'Итоги совпадают. Зачисление и комиссия банка проверяются отдельно.' : 'Есть расхождение. Проверьте источники, период и возвраты; причина пока не установлена.';
    } catch (e) {
      nonCashDifference.textContent = '—'; nonCashStatus.textContent = e.message;
    }
}
function notice(message, error = false) {
  $('notice').hidden = false; $('notice').textContent = message;
  $('notice').className = error ? 'notice error' : 'notice';
}
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Way-Token': token }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}
function getInput() {
  const raw = Object.fromEntries(fields.map(k => [k, form.elements[k].value]));
  raw.zBasisConfirmed = form.elements.zBasisConfirmed.checked;
  raw.nonCash = legacyNonCash ?? { mode: 'aggregate', ...Object.fromEntries(nonCashFields.map(key => [key, form.elements[key].value])), periodConfirmed: form.elements.periodConfirmed.checked };
  if (form.elements.cashSetupEnabled.checked) raw.cashSetup = {
    ...Object.fromEntries(['additionalCash', 'previousTransfers', 'paymentMode', 'suppliers', 'payroll', 'other'].map(k => [k, form.elements[k].value])),
    independentReports: form.elements.independentReports.checked, factBasisConfirmed: form.elements.factBasisConfirmed.checked
  };
  raw.payments = [...$('payments').children].map(row => ({
    recipient: row.querySelector('[data-key=recipient]').value,
    document: row.querySelector('[data-key=document]').value,
    amount: row.querySelector('[data-key=amount]').value,
    source: row.querySelector('[data-key=source]').value,
    confirmed: row.querySelector('[data-key=confirmed]').checked
  }));
  return raw;
}
function preview() {
  const raw = getInput();
  previewNonCash(raw.nonCash);
  try {
    const r = reconcile({ ...raw, nonCash: undefined });
    for (const [id, value] of Object.entries({ expected: r.expected, 'cash-paid': r.cashPaid, 'claimed-total': r.claimed, 'received-total': r.received, difference: r.receivedDifference, 'claimed-diff': r.claimedDifference, 'transfer-diff': r.transferDifference })) $(id).textContent = rub(value);
    $('difference').className = r.receivedDifference < 0 ? 'negative' : r.receivedDifference > 0 ? 'positive' : '';
    $('difference-label').textContent = r.receivedDifference == null ? 'Пересчёт ещё не внесён' : r.receivedDifference === 0 ? 'Суммы совпадают' : 'Предварительное расхождение · требуется проверка';
    $('calc-hint').textContent = r.warnings.length ? r.warnings.join(' ') : r.cashSetup ? 'Начало + наличные двух отчётов + внесения − выплаты − предыдущие передачи − размен.' : 'Остаток + наличные по Z + поступления − выплаты − оставлено.';
  } catch (error) {
    for (const id of ['expected', 'cash-paid', 'claimed-total', 'received-total', 'difference', 'claimed-diff', 'transfer-diff']) $(id).textContent = '—';
    $('calc-hint').textContent = error.message;
    $('difference-label').textContent = 'Данных для расчёта пока недостаточно';
  }
}
function changed() {
  updateModes();
  dirty = true; pending = null; $('print').disabled = true;
  $('save-state').textContent = saved ? `Есть изменения · сохранена версия ${saved.version}` : 'Ещё не сохранено';
  preview();
}
function paymentRow(p = {}) {
  const row = el('div', null, 'payment');
  // Only static markup; user-provided content is assigned via input.value below.
  row.innerHTML = `<div class="payment-header"><span>Выплата</span><button class="text-button" type="button">Удалить</button></div><div class="fields"><label>Получатель<input data-key="recipient" maxlength="100" placeholder="Кому выданы деньги"></label><label>Документ<input data-key="document" maxlength="100" placeholder="Номер накладной / основание"></label><label>Сумма, ₽<input data-key="amount" inputmode="decimal" placeholder="0,00"></label><label>Откуда деньги<select data-key="source"><option value="cash">Наличные</option><option value="card">Карта</option><option value="sbp">СБП</option></select></label></div><label class="check"><input type="checkbox" data-key="confirmed"><span>Выплата фактически выполнена</span></label>`;
  for (const k of ['recipient', 'document', 'amount', 'source']) row.querySelector(`[data-key=${k}]`).value = p[k] ?? (k === 'source' ? 'cash' : '');
  row.querySelector('[data-key=confirmed]').checked = p.confirmed === true;
  row.querySelector('button').addEventListener('click', () => { row.remove(); $('no-payments').hidden = $('payments').children.length > 0; changed(); });
  $('payments').append(row); $('no-payments').hidden = true;
}
function view(name) {
  for (const k of ['cash', 'history', 'backup', 'method']) {
    $(`${k}-view`).hidden = k !== name;
    $(`nav-${k}`).classList.toggle('active', k === name);
    $(`nav-${k}`).setAttribute('aria-current', k === name ? 'page' : 'false');
  }
  const titles = { cash: ['Сверка смены', 'От отчёта кассы — к сумме, принятой бухгалтером.'], history: ['История смен', 'Сохранённые данные и версии исправлений.'], backup: ['Копии данных', 'Сохранённая история, которую можно восстановить отдельно.'], method: ['Как считаем', 'Понятные правила и границы тестовой версии.'] };
  $('page-title').textContent = titles[name][0]; $('subtitle').textContent = titles[name][1];
  if (name === 'history') loadHistory().catch(e => notice(e.message, true));
}
function reset() {
  if (busy || (dirty && !window.confirm('Начать новую смену? Несохранённые изменения будут потеряны.'))) return;
  form.reset(); saved = null; pending = null; dirty = false;
  form.elements.cashSetupEnabled.checked = true; fillNonCash();
  for (const key of ['date', 'register', 'shiftNo']) form.elements[key].disabled = false;
  form.elements.date.value = date(); $('payments').replaceChildren(); $('no-payments').hidden = false;
  $('reason-wrap').hidden = true; $('save-state').textContent = 'Ещё не сохранено'; $('print').disabled = true;
  $('notice').hidden = true; updateModes(); view('cash'); preview();
}
async function openRecord(record) {
  if (busy || (dirty && !window.confirm('Открыть сохранённую смену? Несохранённые изменения будут потеряны.'))) return;
  for (const k of fields) form.elements[k].value = record.input[k] ?? '';
  fillNonCash(record.input.nonCash);
  form.elements.cashSetupEnabled.checked = record.input.cashSetup !== undefined;
  for (const key of ['additionalCash', 'previousTransfers', 'paymentMode', 'suppliers', 'payroll', 'other']) form.elements[key].value = record.input.cashSetup?.[key] ?? (key === 'paymentMode' ? 'totals' : '');
  for (const key of ['independentReports', 'factBasisConfirmed']) form.elements[key].checked = record.input.cashSetup?.[key] === true;
  form.elements.zBasisConfirmed.checked = record.input.zBasisConfirmed;
  for (const k of ['date', 'register', 'shiftNo']) form.elements[k].disabled = true;
  form.elements.reason.value = ''; $('payments').replaceChildren();
  record.input.payments.forEach(paymentRow); $('no-payments').hidden = record.input.payments.length > 0;
  saved = record; pending = null; dirty = false;
  $('reason-wrap').hidden = false; $('print').disabled = false;
  $('save-state').textContent = `Сохранено · версия ${record.version} · ${new Date(record.createdAt).toLocaleString('ru-RU')}`;
  updateModes(); view('cash'); preview(); notice('Открыта сохранённая версия. Для исправления укажите причину и сохраните новую версию.');
}
async function loadHistory() {
  const rows = await api('/api/shifts'); const list = $('history-list'); list.replaceChildren();
  if (!rows.length) { list.append(el('p', 'Пока нет сохранённых смен.', 'empty-inline')); return; }
  for (const r of rows) {
    const row = el('button', null, 'history-row'); row.type = 'button';
    const info = el('span'); info.append(el('strong', `${r.result.date} · ${r.result.register} · № ${r.result.shiftNo}`), el('small', `${r.result.cashier} · версия ${r.version}`));
    const number = el('span', rub(r.result.receivedDifference), 'history-amount'); number.append(el('small', 'Факт минус расчёт'));
    row.append(info, number); row.addEventListener('click', () => openRecord(r)); list.append(row);
    const details = el('details', null, 'versions'); details.append(el('summary', 'Версии и причины изменений'));
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded) return;
      try {
        const versions = await api(`/api/shifts/${r.id}/history`);
        for (const v of versions) details.append(el('div', `Версия ${v.version} · ${new Date(v.createdAt).toLocaleString('ru-RU')} · ${v.result.author}. ${v.reason || 'Первичное сохранение'}. К передаче: ${rub(v.result.expected)}. Принято: ${rub(v.result.received)}.`, 'version-row'));
        details.dataset.loaded = 'true';
      } catch (e) { notice(e.message, true); }
    }); list.append(details);
  }
}
function buildPrint(record) {
  const r = record.result, target = $('print-view'); target.replaceChildren();
  target.append(el('p', 'ТЕСТОВЫЙ БЛАНК · НЕ ЯВЛЯЕТСЯ ПРОВЕДЕНИЕМ ПЛАТЕЖА', 'print-label'), el('h1', 'Сверка наличных за смену'), el('p', `${r.date} · ${r.register} · смена ${r.shiftNo}\nКассир: ${r.cashier}. Бухгалтер: ${r.accountant || 'не указан'}.`));
  const table = el('table', null, 'print-table');
  for (const [label, value] of [['Остаток на начало', r.amounts.opening], ['Наличные по Z (возвраты учтены)', r.amounts.zCash], ['Прочие поступления', r.amounts.otherIn], ['Выполненные наличные выплаты', r.cashPaid], ['Оставлено в кассе', r.amounts.retained], ['Расчётная передача', r.expected], ['Кассир заявил передачу', r.claimed], ['Бухгалтер получил и пересчитал', r.received], ['Факт минус расчёт', r.receivedDifference], ['Принято минус заявлено', r.transferDifference]]) {
    const row = el('tr'); row.append(el('td', label), el('td', rub(value))); table.append(row);
  }
  target.append(table);
  if (r.cashSetup) {
    const s = r.cashSetup;
    target.append(el('p', `Наличные второго отчёта: ${rub(s.additionalCash)}. Предыдущие передачи: ${rub(s.previousTransfers)}.`));
    if (s.paymentMode === 'totals') target.append(el('p', `Общие выплаты наличными: поставщикам ${rub(s.suppliers)}; зарплата и авансы ${rub(s.payroll)}; другие выдачи ${rub(s.other)}.`));
    target.append(el('p', 'Фактическая основа движений заявлена автором ввода. Независимое подтверждение разрешений в этой версии отсутствует.'));
  }
  if (r.nonCash?.mode === 'aggregate') {
    const n = r.nonCash;
    target.append(el('h3', 'Общая безналичная сверка'), el('p', `Касса после возвратов: ${rub(n.zNet)}. Терминалы после возвратов: ${rub(n.reportNet)}. Разница: ${rub(n.difference)}.`), el('p', `Источник: ${n.reportRef || 'не указан'}. Сопоставимость периода: ${n.periodConfirmed ? 'заявлена' : 'не подтверждена'}. Зачисление банка не проверено.`));
  } else if (r.nonCash) {
    target.append(el('h3', 'Безналичная сверка — отдельно от наличных'));
    const nonCashTable = el('table', null, 'print-table');
    const heading = el('tr');
    for (const label of ['Канал', 'По Z после возвратов', 'По отчёту после возвратов', 'Отчёт минус Z']) heading.append(el('th', label));
    nonCashTable.append(heading);
    for (const [channel, title] of [['card', 'Карточный эквайринг'], ['sbp', 'СБП']]) {
      const p = r.nonCash[channel];
      const row = el('tr'); row.append(el('td', title), el('td', rub(p.zNet)), el('td', rub(p.reportNet)), el('td', rub(p.difference))); nonCashTable.append(row);
    }
    target.append(nonCashTable);
    for (const [channel, title] of [['card', 'Эквайринг'], ['sbp', 'СБП']]) target.append(el('p', `${title}: ${r.nonCash[channel].reportRef || 'отчёт не указан'}`));
    target.append(el('p', 'Комиссия и зачисление банка в эту сверку не входят. Безналичные суммы не прибавляются к переданным наличным.'));
  }
  if (r.payments.length) {
    target.append(el('h3', 'Основания выплат — приложить подтверждающие документы'));
    const payments = el('table', null, 'print-table');
    for (const p of r.payments) { const tr = el('tr'); tr.append(el('td', p.document), el('td', p.recipient), el('td', sources[p.source]), el('td', p.confirmed ? 'Выполнена' : 'Не выполнена'), el('td', rub(p.amount))); payments.append(tr); }
    target.append(payments);
  }
  if (r.warnings.length) target.append(el('p', r.warnings.join(' ')));
  target.append(el('p', `Запись ${record.id} · версия ${record.version} · формула ${r.formulaVersion}.\nСохранено: ${new Date(record.createdAt).toLocaleString('ru-RU')}. Внёс: ${r.author}.`));
  const signatures = el('div', null, 'signatures'); signatures.append(el('p', 'Кассир / передал: ______________'), el('p', 'Бухгалтер / принял: ______________')); target.append(signatures);
  target.append(el('small', 'Подписи ставятся на бумаге. Имена в этой тестовой версии не подтверждены авторизацией.'));
}
form.addEventListener('input', changed); form.addEventListener('change', changed);
form.elements.cashSetupEnabled.addEventListener('change', () => {
  if (!form.elements.cashSetupEnabled.checked && ['additionalCash', 'previousTransfers', 'suppliers', 'payroll', 'other'].some(k => /[1-9]/.test(form.elements[k].value))) {
    if (!window.confirm('Перейти к прежней формуле? Второй отчёт, общие выплаты и предыдущие передачи перестанут входить в новый расчёт. Сохранённые версии останутся в истории.')) form.elements.cashSetupEnabled.checked = true;
  }
  changed();
});
$('add-payment').addEventListener('click', () => { if ($('payments').children.length >= 100) return notice('Можно добавить до 100 выплат.', true); paymentRow(); changed(); });
$('new-shift').addEventListener('click', reset);
for (const name of ['cash', 'history', 'backup', 'method']) $(`nav-${name}`).addEventListener('click', () => view(name));
$('refresh-history').addEventListener('click', () => loadHistory().catch(e => notice(e.message, true)));
$('example').addEventListener('click', () => {
  if (busy || saved || (dirty && !window.confirm('Заменить введённые данные тестовым примером?'))) { if (saved) notice('Сначала начните новую смену.', true); return; }
  const example = { date: date(), register: 'Тестовая касса', shiftNo: `ДЕМО-${Date.now().toString().slice(-6)}`, cashier: 'Тестовый кассир', author: 'Тестовый бухгалтер', accountant: 'Тестовый бухгалтер', opening: '2500', zCash: '30000', otherIn: '0', retained: '0', claimed: '24900', received: '24800' };
  fields.forEach(k => { form.elements[k].value = example[k]; }); form.elements.zBasisConfirmed.checked = true;
  form.elements.cashSetupEnabled.checked = true;
  for (const [key, value] of Object.entries({ additionalCash: '1000', previousTransfers: '0', paymentMode: 'totals', suppliers: '7500', payroll: '1000', other: '0' })) form.elements[key].value = value;
  form.elements.independentReports.checked = true; form.elements.factBasisConfirmed.checked = true;
  fillNonCash({ mode: 'aggregate', zMode: 'net', zNet: '58000', reportMode: 'net', reportNet: '57900', reportRef: 'Вымышленные отчёты за один тестовый период', periodConfirmed: true });
  $('payments').replaceChildren(); changed();
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  try {
    reconcile(getInput());
    if (saved && !dirty) return notice('Изменений нет. Сохранённая версия уже доступна для печати.');
    pending ??= { requestId: crypto.randomUUID(), id: saved?.id ?? null, expectedVersion: saved?.version ?? 0, input: getInput(), reason: form.elements.reason.value };
    busy = true; $('save').disabled = true; $('save').textContent = 'Сохраняем…';
    // Prevent edits while a save is in flight; keep the same request ID for a retry.
    const controls = [...form.querySelectorAll('input,select,textarea,button')];
    const previous = controls.map(c => c.disabled); controls.forEach(c => { c.disabled = true; });
    let record;
    try { record = await api('/api/shifts', pending); }
    finally { controls.forEach((c, i) => { c.disabled = previous[i]; }); }
    saved = record; dirty = false; pending = null; $('reason-wrap').hidden = false;
    form.elements.reason.value = ''; ['date', 'register', 'shiftNo'].forEach(k => { form.elements[k].disabled = true; });
    $('save-state').textContent = `Сохранено · версия ${record.version} · ${new Date(record.createdAt).toLocaleString('ru-RU')}`;
    $('print').disabled = false; notice(`Сверка сохранена. Версия ${record.version}. Денежные счета не изменялись.`);
  } catch (error) { notice(error.message, true); }
  finally { busy = false; $('save').disabled = false; $('save').textContent = 'Сохранить сверку'; }
});
$('print').addEventListener('click', () => { if (!saved || dirty || busy) return; buildPrint(saved); window.print(); });
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
form.elements.date.value = date(); form.elements.cashSetupEnabled.checked = true; updateModes(); preview();
let archiveBusy = false;
function archiveControls() {
  $('download-backup').disabled = archiveBusy || !token;
  $('check-backup').disabled = archiveBusy || !token || !$('backup-file').files.length;
  $('backup-file').disabled = archiveBusy;
}
$('backup-file').addEventListener('change', () => { $('backup-check-result').hidden = true; archiveControls(); });
$('download-backup').addEventListener('click', async () => {
  if (archiveBusy) return;
  archiveBusy = true; archiveControls(); $('backup-status').textContent = 'Формируем снимок сохранённых данных…';
  try {
    const archive = await api('/api/archive/download', {});
    const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = el('a');
    link.href = url; link.download = `way-market-test-${archive.payload.createdAt.replace(/[-:.]/g, '')}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('backup-status').textContent = 'Архив передан браузеру для сохранения. Найдите скачанный файл, перенесите копию на отдельный защищённый носитель и проверьте её ниже. Это не подтверждение, что копия уже находится вне сервера.';
  } catch (e) { $('backup-status').textContent = 'Архив не получен: ' + e.message; }
  finally { archiveBusy = false; archiveControls(); }
});
$('check-backup').addEventListener('click', async () => {
  if (archiveBusy || !$('backup-file').files.length) return;
  archiveBusy = true; archiveControls();
  const result = $('backup-check-result'); result.hidden = false; result.className = 'notice'; result.textContent = 'Проверяем архив…';
  try {
    const file = $('backup-file').files[0];
    if (file.size > 16 * 1024 * 1024) throw new Error('Размер больше 16 МиБ');
    let archive;
    try { archive = JSON.parse(await file.text()); } catch { throw new Error('Не удалось прочитать JSON'); }
    const stats = await api('/api/archive/check', archive);
    result.textContent = `Архив прошёл проверку. Смен: ${stats.shifts}; версий: ${stats.revisions}. Создан: ${new Date(stats.createdAt).toLocaleString('ru-RU')}. Рабочие данные не изменены. Пробное восстановление в новый файл выполняется отдельно.`;
  } catch (e) { result.className = 'notice error'; result.textContent = 'Проверка не пройдена: ' + e.message; }
  finally { archiveBusy = false; archiveControls(); }
});
try { ({ token } = await api('/api/session')); $('save').disabled = false; archiveControls(); }
catch (error) { notice('Нет подключения к локальному сервису. ' + error.message, true); $('save').disabled = true; }
