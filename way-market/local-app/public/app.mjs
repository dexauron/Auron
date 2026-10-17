import { reconcile, reconcileNonCash, money, defaultCatalog, validateCatalog, reconcileCategories, CATEGORY_KINDS } from '/domain.mjs';
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
let flowIndex = 0, fullForm = false;
let flowCards = [];
let catalogState = {version:0,data:defaultCatalog()}, catalogReady=false, catalogDirty=false, catalogBusy=false, catalogPending=null;
const flowLabels = ['Смена', 'Наличные', 'Выплаты', 'Терминал', 'Проверка'];
const flowHints = ['Укажите, чью смену сдаёте.', 'Перенесите наличные из отчётов и укажите размен.', 'Введите общие суммы. Получателей перечислять необязательно.', 'Сравните кассовый отчёт с итогом терминалов.', 'Укажите передачу денег и проверьте результат.'];
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
  const categories = enabled && form.elements.paymentMode.value === 'categories';
  for (const label of document.querySelectorAll('[data-expanded-cash]')) label.hidden = !enabled;
  const secondAmount = form.elements.additionalCash.value.trim();
  form.elements.independentReports.closest('label').hidden = !enabled || secondAmount === '' || /^[0,.]+$/.test(secondAmount);
  $('payment-totals').hidden = !(totals || (categories && ['suppliers','payroll','other'].some(k=>/[1-9]/.test(form.elements[k].value)))); $('add-payment').hidden = totals || categories;
  if($('category-editor')) $('category-editor').hidden = !categories && !$('category-entries').children.length;
  // Existing details remain visible so a mode conflict cannot hide paid amounts.
  $('no-payments').hidden = totals || categories || $('payments').children.length > 0;
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
      if ($('review-noncash')) $('review-noncash').textContent = r.mode !== 'aggregate' ? 'Безналичные: сохранена прежняя детализация.' : r.difference == null ? 'Безналичные пока не сверены. Их можно дополнить позже.' : r.difference === 0 ? 'Безналичные: итоги кассы и терминалов совпадают.' : `Безналичные: разница ${rub(r.difference)}. Требуется проверка.`;
    } catch (e) {
      nonCashDifference.textContent = '—'; nonCashStatus.textContent = e.message;
      if ($('review-noncash')) $('review-noncash').textContent = 'Безналичные: проверьте введённые данные.';
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
  if(raw.cashSetup?.paymentMode==='categories' || $('category-entries').children.length) raw.categoryEntries=categoryInput();
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
    $('calc-hint').textContent = r.warnings.length ? r.warnings.join(' ') : r.categoryResult ? `Внесения по категориям: ${rub(r.categoryResult.cashIn)}. Неоплаченные чеки в наличной выручке: ${rub(r.categoryResult.goodsAdjustment)}. Это отдельная корректировка, не выдача денег.` : r.cashSetup ? 'Начало + наличные двух отчётов + внесения − выплаты − предыдущие передачи − размен.' : 'Остаток + наличные по Z + поступления − выплаты − оставлено.';
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
  updateFlowHints();
}
function revealControl(control) {
  if (!control) return;
  for (let parent = control.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  control.setAttribute('aria-invalid', 'true');
  control.focus({ preventScroll: true }); control.scrollIntoView({ block: 'center', behavior: 'auto' });
}
function stageError(index) {
  const fieldError = (name, message) => ({ name, message });
  if (index === 0) {
    for (const name of ['date', 'register', 'shiftNo', 'cashier', 'author']) if (!form.elements[name].value.trim()) return fieldError(name, 'Заполните выделенное поле, чтобы продолжить.');
    const value = form.elements.date.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return fieldError('date', 'Укажите существующую дату смены.');
  }
  if (index === 1 || index === 2) {
    const expanded = form.elements.cashSetupEnabled.checked;
    const names = index === 1 ? ['zCash', 'opening', 'retained', 'otherIn', ...(expanded ? ['additionalCash', 'previousTransfers'] : [])] : expanded ? ['suppliers', 'payroll', 'other'] : [];
    for (const name of names) {
      const control = form.elements[name];
      try { money(control.value, control.closest('label').childNodes[0].textContent); }
      catch (e) { return fieldError(name, control.value === '' ? 'Укажите сумму. Если движения не было, нажмите «Не было». Пустое поле означает, что данных нет.' : e.message); }
    }
    if (index === 1 && !form.elements.zBasisConfirmed.checked) return fieldError('zBasisConfirmed', 'Проверьте, как учтены возвраты и выплаты, затем отметьте подтверждение.');
    if (index === 1 && expanded && money(form.elements.additionalCash.value) !== 0 && !form.elements.independentReports.checked) return fieldError('independentReports', 'Подтвердите, что наличные двух отчётов не пересекаются.');
    if (index === 2 && expanded && !form.elements.factBasisConfirmed.checked) return fieldError('factBasisConfirmed', 'Проверьте фактические выдачи и отметьте, что суммы указаны без повторов.');
    if (index === 2 && expanded) {
      if(form.elements.paymentMode.value!=='categories' && $('category-entries').children.length) return fieldError('paymentMode','Записи категорий сохранены. Выберите «Свои категории» либо явно уберите эти записи перед сменой способа ввода.');
      if(form.elements.paymentMode.value==='categories') {
        if($('payments').children.length || ['suppliers','payroll','other'].some(k=>money(form.elements[k].value)!==0)) return fieldError('paymentMode','Уберите прежние общие/подробные выплаты: суммы должны учитываться только в категориях.');
        for(const row of $('category-entries').children) {
          if(!row._category) return {name:'paymentMode',control:row.querySelector('[data-field=category]'),message:'Выберите категорию этой операции.'};
          try{money(row.querySelector('[data-field=amount]').value);}catch(e){return {name:'paymentMode',control:row.querySelector('[data-field=amount]'),message:'Укажите сумму операции в рублях и копейках.'};}
          if(row._category.kind==='unpaid_goods' && row.querySelector('[data-field=included]').value==='') return {name:'paymentMode',control:row.querySelector('[data-field=included]'),message:'Уточните, включён ли неоплаченный чек в наличную выручку. Без этого разницу считать нельзя.'};
        }
        try{reconcileCategories(categoryInput());}catch(e){return fieldError('paymentMode',e.message);}
        return null;
      }
      const detailed = form.elements.paymentMode.value === 'details';
      if (!detailed && $('payments').children.length) return fieldError('paymentMode', 'Введены общие суммы и подробные записи. Выберите один способ: записи сохранены и не удаляются автоматически.');
      if (detailed && ['suppliers', 'payroll', 'other'].some(k => money(form.elements[k].value) !== 0)) return fieldError('paymentMode', 'Перед подробным вводом обнулите общие суммы. Одни выплаты нельзя вычесть дважды.');
    }
  }
  if (index === 3) {
    try { reconcileNonCash(getInput().nonCash); } catch (e) { return fieldError('reportRef', e.message); }
  }
  if (index === 4) {
    for (const name of ['claimed', 'received']) if (form.elements[name].value !== '') {
      try { money(form.elements[name].value); } catch (e) { return fieldError(name, e.message); }
    }
    if (form.elements.received.value !== '' && !form.elements.accountant.value.trim()) return fieldError('accountant', 'Укажите, кто получил и пересчитал деньги.');
    if (saved && dirty && !form.elements.reason.value.trim()) return fieldError('reason', 'Опишите причину исправления сохранённой версии.');
  }
  return null;
}
function showFlow(index, { focus = false } = {}) {
  flowIndex = Math.max(0, Math.min(4, index));
  $('flow-error').hidden = true;
  flowCards.forEach((card, i) => { card.hidden = !fullForm && i !== flowIndex; });
  document.querySelector('.summary').hidden = !fullForm && flowIndex !== 4;
  $('flow-counter').textContent = fullForm ? 'ВСЯ ФОРМА' : `ШАГ ${flowIndex + 1} ИЗ 5`;
  $('flow-instruction').textContent = fullForm ? 'Все поля доступны. Расчёт и правила проверки те же.' : flowHints[flowIndex];
  $('flow-back').hidden = fullForm || flowIndex === 0;
  $('flow-next').hidden = fullForm || flowIndex === 4;
  $('save').hidden = !fullForm && flowIndex !== 4;
  $('flow-mode').textContent = fullForm ? 'По шагам' : 'Вся форма';
  $('flow-mode').setAttribute('aria-pressed', String(fullForm));
  for (const button of $('flow-steps').children) {
    const active = Number(button.dataset.step) === flowIndex;
    button.setAttribute('aria-current', active && !fullForm ? 'step' : 'false');
    button.classList.toggle('current', active && !fullForm);
  }
  document.querySelector('.workspace').classList.toggle('review-layout', fullForm || flowIndex === 4);
  if (focus) {
    const heading = flowCards[flowIndex].querySelector('h2'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
    $('flow-steps').scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  updateFlowHints();
}
function showStageError(index, error) {
  showFlow(index); $('flow-error').hidden = false; $('flow-error').textContent = error.message;
  revealControl(error.control ?? form.elements[error.name]);
}
function updateFlowHints() {
  for (const details of document.querySelectorAll('[data-flow-fields]')) {
    const complete = details.dataset.flowFields.split(',').filter(k => !form.elements[k].closest('label').hidden).every(k => form.elements[k].value.trim() !== '');
    details.querySelector('summary').textContent = `${details.dataset.title} · ${complete ? 'указано' : 'заполнить'}`;
  }
}
function initFlow() {
  const cards = [...form.querySelectorAll(':scope > section.card')];
  // Terminal totals precede the handover/review, while input names and persisted schema stay unchanged.
  form.insertBefore(cards[4], cards[3]); flowCards = [cards[0], cards[1], cards[2], cards[4], cards[3]];
  flowCards.forEach((card, i) => {
    card.querySelector('.step').textContent = String(i + 1);
    const button = el('button'); button.type = 'button'; button.dataset.step = i;
    button.append(el('span', String(i + 1), 'flow-number'), el('span', flowLabels[i]));
    button.addEventListener('click', () => showFlow(i, { focus: true })); $('flow-steps').append(button);
  });
  function disclosure(parent, title, names) {
    const details = el('details', null, 'flow-disclosure'); details.dataset.title = title; details.dataset.flowFields = names.join(',');
    details.append(el('summary', title)); const grid = el('div', null, 'fields');
    for (const name of names) grid.append(form.elements[name].closest('label'));
    details.append(grid); parent.append(details); return details;
  }
  disclosure(cards[1], 'Размен на начало и конец', ['opening', 'retained']);
  disclosure(cards[1], 'Другие движения наличных', ['otherIn', 'previousTransfers']);
  form.elements.previousTransfers.closest('label').dataset.expandedCash = 'true';
  const settings = el('details', null, 'flow-disclosure'); settings.append(el('summary', 'Способ расчёта'), $('legacy-form-setting')); cards[1].append(settings);
  const paymentSettings = el('details', null, 'flow-disclosure'); paymentSettings.append(el('summary', 'Способ ввода: общая сумма, категории или получатели'), $('payment-mode-setting')); $('payment-mode-wrap').append(paymentSettings);
  for (const name of ['otherIn', 'additionalCash', 'previousTransfers', 'suppliers', 'payroll', 'other']) {
    const control = form.elements[name], label = control.closest('label'), button = el('button', 'Не было', 'zero-button'); button.type = 'button';
    button.setAttribute('aria-label', `${name === 'additionalCash' ? 'Нет второго отчёта' : label.childNodes[0].textContent}: указать ноль`);
    if (name === 'additionalCash') button.textContent = 'Нет второго отчёта';
    button.addEventListener('click', () => {
      if (control.value && control.value !== '0' && !window.confirm('Заменить введённую сумму нулём?')) return;
      control.value = '0'; control.removeAttribute('aria-invalid'); changed();
    }); label.append(button);
  }
  $('flow-mode').addEventListener('click', () => { fullForm = !fullForm; showFlow(flowIndex, { focus: true }); });
  const bankReview = el('button', 'Безналичные пока не сверены.', 'text-button full'); bankReview.id = 'review-noncash'; bankReview.type = 'button';
  bankReview.addEventListener('click', () => showFlow(3, { focus: true }));
  document.querySelector('.result-card').append(bankReview);
  $('flow-back').addEventListener('click', () => showFlow(flowIndex - 1, { focus: true }));
  $('flow-next').addEventListener('click', () => { const error = stageError(flowIndex); if (error) showStageError(flowIndex, error); else showFlow(flowIndex + 1, { focus: true }); });
  form.addEventListener('input', e => { e.target.removeAttribute('aria-invalid'); $('flow-error').hidden = true; });
  updateModes(); showFlow(0);
}
function categoryInput() {
  return [...$('category-entries').children].map(row=>({id:row.dataset.id,category:row._category,
    recipient:row.querySelector('[data-field=recipient]').value,amount:row.querySelector('[data-field=amount]').value,
    basis:row.querySelector('[data-field=basis]').value,
    includedInCashSales:row._category?.kind==='unpaid_goods'?(row.querySelector('[data-field=included]').value===''?null:row.querySelector('[data-field=included]').value==='yes'):false,
    note:row.querySelector('[data-field=note]').value}));
}
function refreshCategoryOptions(row) {
  const select=row.querySelector('[data-field=category]'), chosen=row._category;
  select.replaceChildren();const blank=el('option','Выберите категорию');blank.value='';select.append(blank);
  const same=c=>chosen&&c.id===chosen.id&&c.name===chosen.name&&c.kind===chosen.kind;
  for(const c of catalogState.data.categories.filter(c=>c.active)) {const option=el('option',c.name);option.value=c.id;select.append(option);}
  if(chosen && !catalogState.data.categories.some(c=>c.active&&same(c))) {const old=el('option',`${chosen.name} · прежнее правило`);old.value='@old';select.append(old);select.value='@old';}
  else select.value=chosen?.id??'';
  row.querySelector('[data-field=included]').closest('label').hidden=chosen?.kind!=='unpaid_goods';
  row.querySelector('[data-field=effect]').textContent=chosen ? CATEGORY_KINDS[chosen.kind] : 'Выберите, что произошло.';
}
function categoryRow(p={}) {
  const row=el('div',null,'payment category-entry');row.dataset.id=p.id??crypto.randomUUID();row._category=p.category??null;
  row.innerHTML=`<div class="payment-header"><span>Операция</span><button type="button" class="text-button" data-remove>Убрать</button></div>
    <div class="fields"><label>Категория<select data-field="category"></select></label><label>Сумма, ₽<input data-field="amount" inputmode="decimal" placeholder="0,00"></label>
    <label class="wide">Этот неоплаченный чек включён в наличную выручку?<select data-field="included"><option value="">Нужно уточнить</option><option value="yes">Да — включён</option><option value="no">Нет — не включён</option></select></label></div>
    <p data-field="effect" class="hint"></p>
    <details><summary>Получатель и подробности</summary><div class="fields"><label>Кому — необязательно<input data-field="recipient" list="recipient-options" maxlength="100" placeholder="Имя или общая сумма"></label><label>Способ ввода<select data-field="basis"><option value="total">Общая сумма категории</option><option value="detail">Отдельная операция</option></select></label><label class="wide">Документ / пояснение<input data-field="note" maxlength="300" placeholder="Необязательно"></label></div></details>`;
  for(const key of ['amount','recipient','note']) row.querySelector(`[data-field=${key}]`).value=p[key]??'';
  row.querySelector('[data-field=basis]').value=p.basis??'total';
  row.querySelector('[data-field=included]').value=typeof p.includedInCashSales==='boolean'?(p.includedInCashSales?'yes':'no'):'';
  if(p.recipient || p.note || p.basis==='detail')row.querySelector('details').open=true;
  row.querySelector('[data-field=category]').addEventListener('change',e=>{
    if(e.target.value==='@old') return;
    const c=catalogState.data.categories.find(c=>c.active&&c.id===e.target.value);
    row._category=c?{id:c.id,name:c.name,kind:c.kind}:null;
    row.querySelector('[data-field=included]').value='';refreshCategoryOptions(row);
  });
  row.querySelector('[data-remove]').addEventListener('click',()=>{if(row.querySelector('[data-field=amount]').value && !window.confirm('Убрать эту операцию из редактируемой версии? Сохранённая история останется.'))return;row.remove();changed();});
  $('category-entries').append(row);refreshCategoryOptions(row);return row;
}
function configRow(kind,p) {
  const row=el('div',null,'catalog-row');row.dataset.id=p.id;row.dataset.kind=kind;
  const label=el('label',kind==='categories'?'Название категории':'Имя получателя'),name=el('input');name.value=p.name;name.maxLength=kind==='categories'?80:100;name.dataset.key='name';label.append(name);row.append(label);
  if(kind==='categories') {const label=el('label','Что учитывает'),select=el('select');select.dataset.key='kind';for(const [value,title] of Object.entries(CATEGORY_KINDS)){const o=el('option',title);o.value=value;select.append(o);}select.value=p.kind;label.append(select);row.append(label);}
  const activeLabel=el('label',null,'check'),active=el('input');active.type='checkbox';active.checked=p.active;active.dataset.key='active';activeLabel.append(active,el('span','Доступно для новых записей'));row.append(activeLabel);
  $(`catalog-${kind}`).append(row);
}
function draftCatalog() {
  return Object.fromEntries(['categories','recipients'].map(kind=>[kind,[...$(`catalog-${kind}`).children].map(row=>({id:row.dataset.id,name:row.querySelector('[data-key=name]').value,...(kind==='categories'?{kind:row.querySelector('[data-key=kind]').value}:{}),active:row.querySelector('[data-key=active]').checked}))]));
}
function renderCatalog() {
  for(const kind of ['categories','recipients']) {$(`catalog-${kind}`).replaceChildren();catalogState.data[kind].forEach(p=>configRow(kind,p));}
  $('recipient-options').replaceChildren();for(const p of catalogState.data.recipients.filter(p=>p.active)){const o=el('option');o.value=p.name;$('recipient-options').append(o);}
  for(const row of $('category-entries').children) refreshCategoryOptions(row);
  $('catalog-state').textContent=`Версия справочника: ${catalogState.version}. ${catalogState.author?'Изменил: '+catalogState.author+'.':''} Имена в тестовой версии не подтверждены входом.`;
}
async function loadCatalog() {
  if(catalogDirty && !window.confirm('Обновить справочник? Несохранённые настройки будут потеряны.')) return;
  catalogState=await api('/api/catalog');catalogReady=true;catalogDirty=false;catalogPending=null;renderCatalog();$('catalog-save').disabled=false;$('add-category-entry').disabled=false;
}
function initCategories() {
  const nav=el('button',null,'nav');nav.id='nav-catalog';nav.innerHTML='<span data-icon><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/></svg></span><span>Настройки</span>';nav.addEventListener('click',()=>view('catalog'));document.querySelector('.sidebar nav').append(nav);
  const option=el('option','Свои категории');option.value='categories';form.elements.paymentMode.append(option);
  const editor=el('div');editor.id='category-editor';editor.hidden=true;
  editor.append(el('p','Выберите категорию и сумму. Можно одной суммой за смену или отдельными операциями. Внесения по категориям не дублируйте в «Прочих поступлениях».','hint'));
  const entries=el('div');entries.id='category-entries';const add=el('button','+ Операция по категории','secondary');add.id='add-category-entry';add.type='button';add.disabled=true;
  add.addEventListener('click',()=>{if(!catalogReady || entries.children.length>=100)return;categoryRow();changed();});
  const settings=el('button','Настроить категории и получателей','text-button');settings.type='button';settings.addEventListener('click',()=>view('catalog'));
  editor.append(entries,add,settings);$('payment-mode-wrap').append(editor);
  const datalist=el('datalist');datalist.id='recipient-options';document.body.append(datalist);
  form.elements.paymentMode.addEventListener('change',()=>{
    if(form.elements.paymentMode.value==='categories') for(const k of ['suppliers','payroll','other']) if(form.elements[k].value==='')form.elements[k].value='0';
    changed();
  });
  const catalogForm=$('catalog-form');
  const configChanged=()=>{catalogDirty=true;catalogPending=null;$('catalog-state').textContent='Есть несохранённые настройки. Старые смены не изменены.';};
  catalogForm.addEventListener('input',configChanged);catalogForm.addEventListener('change',configChanged);
  $('catalog-add-category').addEventListener('click',()=>{if($('catalog-categories').children.length>=200)return;configRow('categories',{id:crypto.randomUUID(),name:'',kind:'cash_out',active:true});configChanged();});
  $('catalog-add-recipient').addEventListener('click',()=>{if($('catalog-recipients').children.length>=200)return;configRow('recipients',{id:crypto.randomUUID(),name:'',active:true});configChanged();});
  $('catalog-reload').addEventListener('click',()=>{if(!catalogBusy)loadCatalog().catch(e=>notice(e.message,true));});
  catalogForm.addEventListener('submit',async event=>{
    event.preventDefault();if(catalogBusy||!catalogReady)return;
    const controls=[...catalogForm.querySelectorAll('input,select,button')];
    try{
      const data=validateCatalog(draftCatalog());
      catalogPending??={data,expectedVersion:catalogState.version,requestId:crypto.randomUUID(),author:catalogForm.elements.catalogAuthor.value,reason:catalogForm.elements.catalogReason.value};
      catalogBusy=true;controls.forEach(c=>c.disabled=true);
      catalogState=await api('/api/catalog',catalogPending);catalogDirty=false;catalogPending=null;renderCatalog();catalogForm.elements.catalogReason.value='';notice(`Настройки сохранены. Версия ${catalogState.version}. Старые смены сохранены по прежним правилам.`);
    }catch(e){notice(e.message,true);}finally{catalogBusy=false;controls.forEach(c=>c.disabled=false);}
  });
  $('catalog-history').addEventListener('toggle',async()=>{
    if(!$('catalog-history').open)return;
    try{const rows=await api('/api/catalog/history');$('catalog-history-list').replaceChildren();for(const r of rows)$('catalog-history-list').append(el('p',`Версия ${r.version} · ${r.author} · ${new Date(r.createdAt).toLocaleString('ru-RU')} · ${r.reason}`));}catch(e){notice(e.message,true);}
  });
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
  for (const k of ['cash', 'history', 'backup', 'method', 'catalog']) {
    $(`${k}-view`).hidden = k !== name;
    $(`nav-${k}`).classList.toggle('active', k === name);
    $(`nav-${k}`).setAttribute('aria-current', k === name ? 'page' : 'false');
  }
  const titles = { cash: ['Сверка смены', 'От отчёта кассы — к сумме, принятой бухгалтером.'], history: ['История смен', 'Сохранённые данные и версии исправлений.'], backup: ['Копии данных', 'Сохранённая история, которую можно восстановить отдельно.'], method: ['Как считаем', 'Понятные правила и границы тестовой версии.'], catalog:['Настройки','Ваши категории, получатели и история изменений.'] };
  $('page-title').textContent = titles[name][0]; $('subtitle').textContent = titles[name][1];
  if (name === 'history') loadHistory().catch(e => notice(e.message, true));
}
function reset() {
  if (busy || (dirty && !window.confirm('Начать новую смену? Несохранённые изменения будут потеряны.'))) return;
  form.reset(); saved = null; pending = null; dirty = false;
  $('category-entries').replaceChildren();
  for (const control of form.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  form.elements.cashSetupEnabled.checked = true; fillNonCash();
  for (const key of ['date', 'register', 'shiftNo']) form.elements[key].disabled = false;
  form.elements.date.value = date(); $('payments').replaceChildren(); $('no-payments').hidden = false;
  $('reason-wrap').hidden = true; $('save-state').textContent = 'Ещё не сохранено'; $('print').disabled = true;
  $('notice').hidden = true; updateModes(); view('cash'); showFlow(0); preview();
}
async function openRecord(record) {
  if (busy || (dirty && !window.confirm('Открыть сохранённую смену? Несохранённые изменения будут потеряны.'))) return;
  for (const control of form.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  for (const k of fields) form.elements[k].value = record.input[k] ?? '';
  fillNonCash(record.input.nonCash);
  form.elements.cashSetupEnabled.checked = record.input.cashSetup !== undefined;
  for (const key of ['additionalCash', 'previousTransfers', 'paymentMode', 'suppliers', 'payroll', 'other']) form.elements[key].value = record.input.cashSetup?.[key] ?? (key === 'paymentMode' ? 'totals' : '');
  for (const key of ['independentReports', 'factBasisConfirmed']) form.elements[key].checked = record.input.cashSetup?.[key] === true;
  $('category-entries').replaceChildren(); (record.input.categoryEntries ?? []).forEach(categoryRow);
  form.elements.zBasisConfirmed.checked = record.input.zBasisConfirmed;
  for (const k of ['date', 'register', 'shiftNo']) form.elements[k].disabled = true;
  form.elements.reason.value = ''; $('payments').replaceChildren();
  record.input.payments.forEach(paymentRow); $('no-payments').hidden = record.input.payments.length > 0;
  saved = record; pending = null; dirty = false;
  $('reason-wrap').hidden = false; $('print').disabled = false;
  $('save-state').textContent = `Сохранено · версия ${record.version} · ${new Date(record.createdAt).toLocaleString('ru-RU')}`;
  updateModes(); view('cash'); showFlow(4); preview(); notice('Открыта сохранённая версия. Для исправления укажите причину и сохраните новую версию.');
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
  if(r.categoryResult) {
    target.append(el('h3','Операции по категориям'));
    const table=el('table',null,'print-table');
    for(const e of r.categoryResult.entries) {const row=el('tr');row.append(el('td',e.category.name),el('td',e.recipient||'Общая сумма'),el('td',CATEGORY_KINDS[e.category.kind]),el('td',rub(e.amount)),el('td',e.category.kind==='unpaid_goods'?(e.includedInCashSales?'Чек включён в наличные':'Не включён в наличные'):(e.category.kind==='cash_in'?'Прибавлено':'Вычтено')),el('td',e.note));table.append(row);}
    target.append(table,el('p',`Физически выдано: ${rub(r.categoryResult.cashOut)}. Внесено по категориям: ${rub(r.categoryResult.cashIn)}. Корректировка неоплаченных чеков: ${rub(r.categoryResult.goodsAdjustment)}.`));
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
  $('payments').replaceChildren(); $('category-entries').replaceChildren(); changed(); showFlow(4);
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  // Enter on an earlier step advances the flow instead of saving an unseen final result.
  if (!fullForm && flowIndex < 4) { const error = stageError(flowIndex); if (error) showStageError(flowIndex, error); else showFlow(flowIndex + 1, { focus: true }); return; }
  try {
    for (let i = 0; i < 5; i++) { const error = stageError(i); if (error) { showStageError(i, error); return; } }
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
    $('print').disabled = false; notice(`Сверка сохранена. Версия ${record.version}.`);
  } catch (error) { notice(error.message, true); }
  finally { busy = false; $('save').disabled = false; $('save').textContent = 'Сохранить сверку'; }
});
$('print').addEventListener('click', () => { if (!saved || dirty || busy) return; buildPrint(saved); window.print(); });
window.addEventListener('beforeunload', event => { if (dirty || busy || catalogDirty || catalogBusy) { event.preventDefault(); event.returnValue = ''; } });
form.elements.date.value = date(); form.elements.cashSetupEnabled.checked = true; initCategories(); initFlow(); preview();
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
try { ({ token } = await api('/api/session')); $('save').disabled = false; archiveControls(); await loadCatalog(); }
catch (error) { notice('Нет подключения к локальному сервису. ' + error.message, true); $('save').disabled = true; }
