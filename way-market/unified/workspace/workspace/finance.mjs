import { newRequestId } from '/request-id.mjs';
export function financePageFactory({ api, node, button, field, select, surface, modal, formSubmit, rub, time, today, user, save, notice }) {
  const money = n => (n / 100).toFixed(2);
  const values = f => Object.fromEntries(new FormData(f));
  const types = { inflow: 'Поступление', outflow: 'Списание', transfer: 'Перевод', settlement: 'Расчёт по долгу', cash_handover: 'Принятая сдача кассира' };
  return async function financePage() {
    const [s, directory] = await Promise.all([api('/api/finance'), api('/api/directory')]), root = node('div', null, 'finance-page');
    const owner = user().role === 'owner', top = surface('Деньги и расчёты');
    top.append(node('p', 'Остатки по счетам и долги. Назначение платежа не списывает деньги. Это журнал движения денег, а не расчёт прибыли.', 'fine'));
    const menu = node('div', null, 'button-row');
    if (owner) menu.append(button('Добавить счёт', () => accountForm(), 'primary'));
    menu.append(button('Поступление', () => movementForm('inflow')), button('Списание', () => movementForm('outflow')), button('Перевод', () => movementForm('transfer')), button('Новый долг', () => obligationForm()), button('Отчёт за период', () => reportForm())); top.append(menu); root.append(top);
    function submit(f, kind, old, payload) { const requestId = newRequestId(); formSubmit(f, 'Сохранить', () => save({ ...payload(), kind, id: old?.id, expectedVersion: old?.version ?? 0, requestId })); }
    const refs = (...docs) => Object.fromEntries(docs.filter(Boolean).map(d => [d.id, d.version]));
    const reason = f => field(f, 'Причина изменения', 'reason', { required: true, maxLength: 500 });
    const history = doc => button('История', async () => {
      try {
        const rows = await api(`/api/finance/history/${doc.id}`), body = node('div');
        for (const r of rows) {
          const d = r.data, box = node('details'); box.append(node('summary', `Версия ${r.version} · ${time(r.at_ms)}`), node('p', `${directory.find(x => x.id === r.actor_id)?.name ?? 'Участник'} · ${r.reason || 'Создание'}`));
          if (r.kind === 'account') box.append(node('p', `${d.name} · ${d.type === 'cash' ? 'Наличные' : 'Банк'} · ${d.active ? 'Действует' : 'Не используется'}`), node('p', `Начальный остаток ${rub(d.openingBalance)} на ${d.openingDate}`));
          if (r.kind === 'obligation') box.append(node('p', `${d.direction === 'payable' ? 'Мы должны' : 'Нам должны'}: ${d.party} · ${rub(d.amount)}`), node('p', `${d.date} · срок ${d.dueDate} · ${d.status === 'cancelled' ? 'Отменено' : 'Открыто'}`), node('p', d.basis));
          if (r.kind === 'plan') box.append(node('p', `Назначено ${rub(d.amount)} на ${d.date} · ${d.status === 'cancelled' ? 'Остаток отменён' : 'Назначение действует'}`), node('p', d.note));
          if (r.kind === 'movement') box.append(node('p', `${types[d.type]} · ${rub(d.amount)} · ${d.date}`), node('p', d.purpose), node('p', `Основание: ${d.evidence}${d.reference ? ' · № операции ' + d.reference : ''}`));
          if (r.kind === 'bank_line') box.append(node('p', `Строка выписки № ${d.reference} · ${d.date} · ${d.direction === 'in' ? 'Зачисление' : 'Списание'} ${rub(d.amount)}`), node('p', d.note), node('p', d.status === 'cancelled' ? 'Ошибочная строка отменена' : 'Действующая строка'));
          if (r.kind === 'reversal') box.append(node('p', `Корректировка учёта от ${d.date}`), node('p', d.explanation));
          body.append(box);
        } modal('История документа', body);
      } catch (e) { notice(e.message); }
    });
    const accounts = surface('Счета и остатки');
    if (!s.accounts.length) accounts.append(node('p', 'Владелец добавляет кассу или банковский счёт и проверенный начальный остаток.', 'empty'));
    for (const a of s.accounts) {
      const row = node('div', null, 'row'), info = node('div', null, 'row-main'); info.append(node('strong', a.data.name), node('small', `${a.data.type === 'cash' ? 'Наличные' : 'Банк'} · ${a.data.active ? 'Действует' : 'Не используется'}`));
      row.append(info, node('strong', rub(a.balance), a.negative ? 'error' : 'money')); if (a.negative) row.append(node('p', 'Отрицательный остаток: проверьте начальные данные и записи.', 'error'));
      row.append(history(a)); if (owner) row.append(button('Настроить', () => accountForm(a))); accounts.append(row);
    } root.append(accounts);
    const sources = surface('Ожидают отражения');
    if (!s.unconfirmedReceipts.length && !s.cashToPost.length) sources.append(node('p', 'Новых оснований нет.', 'empty'));
    for (const r of s.unconfirmedReceipts) {
      const row = node('div', null, 'row'), info = node('div', null, 'row-main'); info.append(node('strong', `Накладная № ${r.data.number} · ${rub(r.total)}`), node('small', r.data.date)); row.append(info, button('Подтвердить долг', () => obligationForm(null, r))); sources.append(row);
    }
    for (const c of s.cashToPost) {
      const row = node('div', null, 'row'), info = node('div', null, 'row-main'); info.append(node('strong', `Сдача ${c.register} · смена ${c.shiftNo}`), node('small', `${c.date} · принято ${rub(c.amount)}`)); row.append(info); if(c.posting) info.append(node('p', c.posting.reason)); else row.append(button('Отразить в деньгах', () => movementForm('cash_handover', { cash: c }))); sources.append(row);
    }
    for(const c of s.cashConflicts || []) sources.append(node('p', `${c.date} · ${c.register} · смена ${c.shiftNo}: обнаружен возможный повтор учёта по кассовым документам. Владелец должен проверить проводки; старые суммы не исправлены автоматически.`, 'error'));
    root.append(sources);
    const debts = surface('Долги');
    if (!s.obligations.length) debts.append(node('p', 'Обязательств пока нет. Накладная становится долгом после отдельного подтверждения.', 'empty'));
    for (const o of [...s.obligations].sort((a, b) => a.data.dueDate.localeCompare(b.data.dueDate) || a.id.localeCompare(b.id))) {
      const card = node('details'); card.append(node('summary', `${o.data.direction === 'payable' ? 'Мы должны' : 'Нам должны'} · ${o.data.party} · ${rub(o.remaining)}${o.data.status === 'cancelled' ? ' · Отменено' : ''}`));
      card.append(node('p', `Срок ${o.data.dueDate} · сумма ${rub(o.data.amount)} · оплачено ${rub(o.paid)} · назначено ${rub(o.planned)}`), node('p', o.data.basis));
      if (o.data.status === 'open' && o.remaining > 0 && o.data.dueDate < today()) card.append(node('p', 'Срок расчёта прошёл', 'error'));
      if (o.overplanned) card.append(node('p', 'Назначено больше остатка долга: уточните или отмените лишние назначения.', 'error'));
      const actions = node('div', null, 'button-row'); actions.append(history(o), button('Уточнить срок / отменить', () => obligationForm(o)));
      if (o.data.status === 'open' && o.remaining > 0) actions.append(button(o.data.direction === 'payable' ? 'Записать оплату' : 'Записать получение', () => movementForm('settlement', { obligation: o }), 'primary'), button('Назначить расчёт', () => planForm(null, o)));
      card.append(actions); debts.append(card);
    } root.append(debts);
    const plans = surface('Назначенные расчёты');
    if (!s.plans.length) plans.append(node('p', 'Назначений пока нет.', 'empty'));
    for (const p of [...s.plans].sort((a, b) => a.data.date.localeCompare(b.data.date) || a.id.localeCompare(b.id))) {
      const o = s.obligations.find(o => o.id === p.data.obligationId), a = s.accounts.find(a => a.id === p.data.accountId), card = node('details');
      card.append(node('summary', `${p.data.date} · ${o.data.party} · ${rub(p.remaining)} · ${p.data.status === 'cancelled' ? 'Остаток отменён' : p.remaining === 0 ? 'Исполнено' : 'Ожидает'}`), node('p', `${a.data.name} · назначено ${rub(p.data.amount)} · исполнено ${rub(p.paid)}`), node('p', p.data.note));
      const actions = node('div', null, 'button-row'); actions.append(history(p)); if (o.data.status === 'open') actions.append(button('Изменить назначение', () => planForm(p, o)));
      if (p.data.status === 'scheduled' && p.remaining > 0 && o.remaining > 0) actions.append(button('Записать исполнение', () => movementForm('settlement', { obligation: o, plan: p }), 'primary')); card.append(actions); plans.append(card);
    } root.append(plans);
    const bank = surface('Сверка банка'), bankStatuses = { unmatched: 'Не сопоставлено', matched: 'Совпадает', needs_review: 'Движение исправлено — проверьте связь', amount_difference: 'Суммы различаются', date_difference: 'Сумма совпала, даты различаются', cancelled: 'Ошибочная строка отменена' };
    bank.append(node('p', 'Внесите строку проверенной выписки и сопоставьте с записью журнала. Строка сверки не проводит деньги повторно.', 'fine'), button('Добавить строку выписки', () => bankForm()));
    for (const line of s.bankLines) {
      const card = node('details'), d = line.data; card.append(node('summary', `№ ${d.reference} · ${d.date} · ${d.direction === 'in' ? '+' : '−'}${rub(d.amount)} · ${bankStatuses[line.status]}`), node('p', s.accounts.find(a => a.id === d.accountId).data.name));
      if (line.difference !== null) card.append(node('p', `Разница выписка минус журнал: ${rub(line.difference)}`, line.difference ? 'error' : 'fine'));
      card.append(node('p', d.note), history(line), button('Сопоставить / пояснить', () => bankForm(line))); bank.append(card);
    } root.append(bank);
    const journal = surface('Журнал денег');
    if (!s.movements.length && !s.reversals.length) journal.append(node('p', 'Фактических движений пока нет.', 'empty'));
    const items = [...s.movements.map(m => ({ date: m.data.date, at: m.at, id: m.id, movement: m })), ...s.reversals.map(r => ({ date: r.data.date, at: r.at, id: r.id, reversal: r }))].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at || b.id.localeCompare(a.id));
    for (const item of items) {
      const m = item.movement ?? s.movements.find(m => m.id === item.reversal.data.movementId), d = m.data, a = s.accounts.find(a => a.id === d.accountId), card = node('details');
      card.append(node('summary', `${item.date} · ${item.reversal ? 'Корректировка' : types[d.type]} · ${rub(d.amount)}${m.reversedBy && !item.reversal ? ' · Исправлено' : ''}`), node('p', `${a.data.name}${d.toAccountId ? ' → ' + s.accounts.find(a => a.id === d.toAccountId).data.name : ''}`), node('p', d.purpose), node('p', `Основание: ${d.evidence}${d.reference ? ' · № операции ' + d.reference : ''}`));
      if (d.obligationId) card.append(node('p', `Контрагент: ${s.obligations.find(o => o.id === d.obligationId).data.party}`));
      if (item.reversal) card.append(node('p', item.reversal.data.explanation));
      card.append(history(item.reversal ?? m));
      if (owner && !m.reversedBy && !item.reversal) card.append(button('Исправить ошибочную запись', () => reversalForm(m)));
      journal.append(card);
    } root.append(journal);
    function accountForm(old) {
      const f = node('form'), locked = old && s.movements.some(m => m.data.accountId === old.id || m.data.toAccountId === old.id);
      field(f, 'Название счёта', 'name', { value: old?.data.name ?? '', required: true, maxLength: 150 }); const type = select(f, 'Тип', 'type', [['cash', 'Наличные'], ['bank', 'Банк']], old?.data.type); if (locked) type.disabled = true;
      field(f, 'Дата начального остатка', 'openingDate', { type: 'date', value: old?.data.openingDate ?? today(), required: true, readOnly: Boolean(locked), max: today() }); field(f, 'Проверенный начальный остаток, ₽', 'openingBalance', { value: old ? money(old.data.openingBalance) : '', required: true, inputMode: 'decimal', readOnly: Boolean(locked) });
      select(f, 'Новые операции', 'active', [['yes', 'Разрешены'], ['no', 'Не использовать счёт']], old?.data.active === false ? 'no' : 'yes'); if (old) reason(f);
      f.append(node('p', 'Начальный остаток не считается поступлением или доходом. После первого движения он фиксируется.', 'fine'));
      submit(f, 'account', old, () => ({ ...values(f), type: locked ? old.data.type : type.value, active: f.elements.active.value === 'yes', refVersions: {} })); modal('Настройка счёта', f);
    }
    function obligationForm(old, receipt) {
      const f = node('form');
      if (receipt) f.append(node('p', `По накладной № ${receipt.data.number} от ${receipt.data.date}: ${rub(receipt.total)}. Деньги не списываются.`));
      else {
        const direction = select(f, 'Кто должен', 'direction', [['payable', 'Мы должны контрагенту'], ['receivable', 'Нам должен контрагент']], old?.data.direction); if (old) direction.disabled = true;
        field(f, 'Контрагент', 'party', { value: old?.data.party ?? '', required: true, maxLength: 150, readOnly: Boolean(old) }); field(f, 'Сумма долга, ₽', 'amount', { value: old ? money(old.data.amount) : '', required: true, inputMode: 'decimal', readOnly: Boolean(old) }); field(f, 'Дата основания', 'date', { type: 'date', value: old?.data.date ?? today(), required: true, readOnly: Boolean(old), max: today() });
      }
      field(f, 'Срок расчёта', 'dueDate', { type: 'date', value: old?.data.dueDate ?? '', required: true }); field(f, 'Основание долга', 'basis', { value: old?.data.basis ?? '', required: true, maxLength: 500 });
      if (!old && !receipt) {
        const helper=surface('Из текста договорённости'),input=field(helper,'Например: 5000 руб за молоко, оплата завтра','',{maxLength:500}),message=node('p','','fine');
        const parse=button('Разобрать сумму и срок',async()=>{
          parse.disabled=true;message.textContent='';
          try { const result=await api('/api/unified/parse-agreement',{text:input.value});
            if(!f.isConnected)return;
            if(result.amountMinor!==null)f.elements.amount.value=money(result.amountMinor);
            if(result.dueDate)f.elements.dueDate.value=result.dueDate;
            if(result.description)f.elements.basis.value=result.description;
            message.textContent='Поля заполнены как предложение. Проверьте сумму, срок, контрагента и направление долга перед сохранением.';
          } catch(error){message.textContent=error.message;}finally{parse.disabled=false;}
        });helper.append(parse,message);f.prepend(helper);
      }
      if (old) { select(f, 'Состояние', 'status', [['open', 'Открыто'], ['cancelled', 'Отменено как ошибочное']], old.data.status); reason(f); }
      submit(f, 'obligation', old, () => ({ ...(old?.data ?? {}), ...values(f), direction: old?.data.direction ?? f.elements.direction?.value, status: old ? f.elements.status.value : 'open', supplierId: old?.data.supplierId ?? null, receiptId: receipt?.id ?? old?.data.receiptId ?? null, receiptVersion: receipt?.version ?? (old?.data.receiptId ? 1 : undefined), refVersions: {} })); modal(receipt ? 'Подтверждение обязательства' : 'Долг и срок расчёта', f);
    }
    function planForm(old, obligation) {
      const active = s.accounts.filter(a => a.data.active || a.id === old?.data.accountId); if (!active.length) { modal('Счёт не выбран', node('p', 'Сначала владелец добавляет действующий счёт.')); return; }
      const f = node('form'), locked = old && s.movements.some(m => m.data.planId === old.id);
      f.append(node('p', `${obligation.data.party} · осталось ${rub(obligation.remaining)}`)); const account = select(f, 'Счёт расчёта', 'accountId', active.map(a => [a.id, a.data.name]), old?.data.accountId); if (locked) account.disabled = true;
      field(f, 'Назначить, ₽', 'amount', { value: old ? money(old.data.amount) : money(Math.max(0, obligation.remaining - obligation.planned)), required: true, inputMode: 'decimal', readOnly: Boolean(locked) }); field(f, 'Плановая дата', 'date', { type: 'date', value: old?.data.date ?? obligation.data.dueDate, required: true }); field(f, 'Поручение / пояснение', 'note', { value: old?.data.note ?? '', required: true, maxLength: 500 });
      if (old) { select(f, 'Остаток назначения', 'status', [['scheduled', 'Ожидает исполнения'], ['cancelled', 'Отменить остаток']], old.data.status); reason(f); }
      f.append(node('p', 'Назначение не меняет остаток счёта и не подтверждает оплату.', 'fine'));
      submit(f, 'plan', old, () => { const a = s.accounts.find(a => a.id === account.value); return { ...values(f), obligationId: obligation.id, accountId: a.id, status: old ? f.elements.status.value : 'scheduled', refVersions: refs(a, obligation) }; }); modal('Назначение расчёта', f);
    }
    function movementForm(type, source = {}) {
      const active = s.accounts.filter(a => a.data.active && (type !== 'cash_handover' || a.data.type === 'cash'));
      if (!active.length || (source.plan && !active.some(a => a.id === source.plan.data.accountId)) || (type === 'transfer' && active.length < 2)) { modal('Нужны счета', node('p', type === 'transfer' ? 'Для перевода добавьте два действующих счёта.' : 'Владелец должен добавить подходящий действующий счёт.')); return; }
      const f = node('form'), obligation = source.obligation, plan = source.plan, cash = source.cash;
      if (obligation) f.append(node('p', `${obligation.data.direction === 'payable' ? 'Оплата' : 'Получение'}: ${obligation.data.party} · долг ${rub(obligation.remaining)}`));
      if (cash) f.append(node('p', `Касса ${cash.register}, смена ${cash.shiftNo}: фактически принято ${rub(cash.amount)}. Выплаты из смены повторно не списываются.`));
      const account = select(f, 'Счёт', 'accountId', active.map(a => [a.id, `${a.data.name} · ${rub(a.balance)}`]), plan?.data.accountId); if (plan) account.disabled = true;
      let to; if (type === 'transfer') to = select(f, 'На счёт', 'toAccountId', active.map(a => [a.id, a.data.name]), active[1].id);
      field(f, 'Фактическая сумма, ₽', 'amount', { value: cash ? money(cash.amount) : plan ? money(Math.min(plan.remaining, obligation.remaining)) : obligation ? money(obligation.remaining) : '', required: true, inputMode: 'decimal', readOnly: Boolean(cash) });
      field(f, 'Дата фактического движения', 'date', { type: 'date', value: today(), required: true, max: today() }); field(f, 'Назначение / кому / за что', 'purpose', { value: obligation ? `Расчёт с ${obligation.data.party}` : cash ? 'Приём сдачи кассира' : '', required: true, maxLength: 500 }); field(f, 'Подтверждающее основание: чек, документ, выписка', 'evidence', { required: true, maxLength: 300 }); field(f, 'Уникальный номер операции на выбранном счёте, если известен', 'reference', { maxLength: 100 }); field(f, 'Пояснение расхождения, если не хватает учтённого остатка', 'reason', { maxLength: 500 });
      select(f, 'Подтверждение факта', 'confirmed', [['no', 'Сначала проверьте фактическое движение'], ['yes', 'Деньги действительно переданы / получены']]);
      submit(f, 'movement', null, () => { const a = s.accounts.find(a => a.id === account.value), target = to ? s.accounts.find(a => a.id === to.value) : null; return { ...values(f), type, accountId: a.id, toAccountId: target?.id, obligationId: obligation?.id, planId: plan?.id, cashId: cash?.id, cashVersion: cash?.version, confirmed: f.elements.confirmed.value === 'yes', refVersions: refs(a, target, obligation, plan) }; }); modal(types[type], f);
    }
    function bankForm(old) {
      const banks = s.accounts.filter(a => a.data.type === 'bank'); if (!banks.length) { modal('Нужен банковский счёт', node('p', 'Сначала владелец добавляет банковский счёт.')); return; }
      const f = node('form'), account = select(f, 'Банковский счёт', 'accountId', banks.map(a => [a.id, a.data.name]), old?.data.accountId); if (old) account.disabled = true;
      field(f, 'Уникальный номер строки / операции выписки', 'reference', { value: old?.data.reference ?? '', required: true, maxLength: 100, readOnly: Boolean(old) }); field(f, 'Дата выписки', 'date', { type: 'date', value: old?.data.date ?? today(), required: true, max: today(), readOnly: Boolean(old) });
      const direction = select(f, 'По выписке', 'direction', [['in', 'Зачисление'], ['out', 'Списание']], old?.data.direction); if (old) direction.disabled = true;
      field(f, 'Сумма строки, ₽', 'amount', { value: old ? money(old.data.amount) : '', required: true, inputMode: 'decimal', readOnly: Boolean(old) });
      const movement = select(f, 'Сопоставить с движением денег', 'movementId', [['', 'Не сопоставлено']], '');
      const fill = selected => { movement.replaceChildren(); for (const [id, title] of [['', 'Не сопоставлено'], ...s.movements.filter(m => m.effects.some(e => e.accountId === account.value)).map(m => [m.id, `${m.data.date} · ${m.data.purpose} · ${rub(m.effects.find(e => e.accountId === account.value).delta)}${m.reversedBy ? ' · Исправлено' : ''}`])]) { const option = node('option', title); option.value = id; movement.append(option); } movement.value = selected ?? ''; };
      fill(old?.data.movementId); account.addEventListener('change', () => fill(''));
      field(f, 'Пояснение', 'note', { value: old?.data.note ?? '', maxLength: 500 });
      if (old) { select(f, 'Состояние строки', 'status', [['active', 'Действует'], ['cancelled', 'Отменить ошибочный ввод']], old.data.status); reason(f); }
      submit(f, 'bank_line', old, () => ({ ...values(f), accountId: account.value, direction: direction.value, status: old ? f.elements.status.value : 'active', movementId: movement.value || null, refVersions: refs(s.accounts.find(a => a.id === account.value), s.movements.find(m => m.id === movement.value)) })); modal('Сверка строки выписки', f);
    }
    function reversalForm(m) {
      const f = node('form'); f.append(node('p', `${types[m.data.type]} · ${rub(m.data.amount)} · ${m.data.purpose}`), node('p', 'Используйте только для ошибочной записи о несостоявшемся движении. Реальный возврат денег записывается новым движением. Исходная запись и её история сохранятся.', 'fine'));
      field(f, 'Дата корректировки учёта', 'date', { type: 'date', value: today(), required: true, max: today() }); reason(f); select(f, 'Подтверждение', 'confirmed', [['no', 'Требуется проверка'], ['yes', 'Исправляю ошибочную запись, а не реальный возврат']]);
      submit(f, 'reversal', null, () => ({ ...values(f), movementId: m.id, confirmed: f.elements.confirmed.value === 'yes', refVersions: refs(m) })); modal('Корректировка ошибочной записи', f);
    }
    function reportForm() {
      const f = node('form'); field(f, 'Начало периода', 'start', { type: 'date', value: today().slice(0, 8) + '01', required: true }); field(f, 'Конец периода', 'end', { type: 'date', value: today(), required: true });
      const output = node('div'); formSubmit(f, 'Показать отчёт', async () => {
        const r = await api(`/api/finance/report?start=${encodeURIComponent(f.elements.start.value)}&end=${encodeURIComponent(f.elements.end.value)}`); output.replaceChildren(node('p', r.note, 'fine'));
        for (const a of r.accounts) { const box = surface(a.name); box.append(node('p', `На начало ${rub(a.opening)} · начальные остатки, введённые внутри периода ${rub(a.introduced)}`), node('p', `Поступило ${rub(a.incoming)} · выбыло ${rub(a.outgoing)}`), node('strong', `На конец ${rub(a.closing)}`)); output.append(box); }
      }); f.append(output); modal('Отчёт о движении денег', f);
    }
    return root;
  };
}
