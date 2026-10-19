export function procurementPageFactory({ api, node, button, field, select, surface, modal, formSubmit, rub, time, today, user, save, historyModal }) {
  const amount = n => (n / 100).toFixed(2);
  const qty = n => String(n / 1000);
  const values = f => Object.fromEntries(new FormData(f));
  const reason = (f, old) => { if (old) field(f, 'Причина изменения', 'reason', { required: true, maxLength: 500 }); };
  function submit(f, kind, old, payload) {
    const requestId = crypto.randomUUID();
    formSubmit(f, 'Сохранить', () => save({ ...payload(), kind, id: old?.id, expectedVersion: old?.version ?? 0, requestId }));
  }
  return async function procurementPage() {
    const [s, products, directory] = await Promise.all([api('/api/procurement'), api('/api/products'), api('/api/directory')]);
    const root = node('div', null, 'procurement-page'), top = surface('Закупки');
    top.append(node('p', 'Заказ резервирует лимит. Приёмка фиксирует фактическую накладную. Оплата и складские остатки оформляются отдельно.', 'fine'));
    const toolbar = node('div', null, 'button-row');
    toolbar.append(button('Поставщик', () => supplierForm(), 'primary'));
    if (user().role === 'owner') toolbar.append(button('Установить лимит', () => budgetForm()));
    toolbar.append(button('Новый заказ', () => orderForm())); top.append(toolbar); root.append(top);
    const history = record => button('История', async () => {
      try {
        const rows = await api(`/api/procurement/history/${record.id}`), content = node('div');
        for (const r of rows) { const d = node('details'), title = node('summary', `Версия ${r.version} · ${time(r.at_ms)}`); d.append(title, node('p', `${directory.find(u => u.id === r.actor_id)?.name ?? 'Участник'} · ${r.reason || 'Создание'}`));
          const x = r.data;
          if (r.kind === 'supplier') d.append(node('p', `${x.name} · ${x.active ? 'Действует' : 'Архив'}`), node('p', x.contact), node('p', x.terms));
          if (r.kind === 'budget') d.append(node('p', `${x.name} · ${x.scope}`), node('p', `${x.start} — ${x.end} · ${rub(x.amount)}`));
          if (r.kind === 'order') { d.append(node('p', `${s.suppliers.find(p => p.id === x.supplierId)?.data.name ?? 'Поставщик'} · ${x.date} · ${x.status === 'closed' ? 'Закрыт' : 'Открыт'}`)); for (const l of x.lines) d.append(node('p', `${l.name}: ${qty(l.quantity)} ${l.unit} · ${rub(l.price)}`)); }
          if (r.kind === 'receipt') { d.append(node('p', `Накладная № ${x.number} · ${x.date} · ${x.final ? 'Последняя поставка' : 'Частичная поставка'}`)); const o = s.orders.find(o => o.id === x.orderId); for (const l of x.lines) d.append(node('p', `${o?.lines.find(p => p.id === l.lineId)?.name ?? 'Позиция'}: ${qty(l.quantity)} · ${rub(l.price)}`)); d.append(node('p', x.note)); }
          if (r.kind === 'review') d.append(node('p', `${x.state === 'resolved' ? 'Разобрано' : 'На проверке'} · ${x.explanation}`));
          content.append(d); }
        historyModal('История документа', content);
      } catch (e) { historyModal('История', node('p', e.message, 'error')); }
    });
    const budgets = surface('Лимиты');
    if (!s.budgets.length) budgets.append(node('p', 'Владелец задаёт сумму, область и период лимита.', 'empty'));
    for (const b of s.budgets) {
      const row = node('div', null, 'row'), info = node('div', null, 'row-main');
      info.append(node('strong', `${b.data.name} · доступно ${rub(b.available)}`), node('small', `${b.data.scope} · ${b.data.start} — ${b.data.end}`), node('small', `Лимит ${rub(b.data.amount)} · резерв ${rub(b.reserved)} · принято ${rub(b.used)}`));
      row.append(info, history(b)); if (user().role === 'owner') row.append(button('Изменить', () => budgetForm(b))); budgets.append(row);
    } root.append(budgets);
    const orders = surface('Заказы');
    if (!s.orders.length) orders.append(node('p', 'Заказов пока нет.', 'empty'));
    for (const o of s.orders) {
      const card = node('details'), title = node('summary', `${s.suppliers.find(x => x.id === o.data.supplierId)?.data.name} · ${o.data.date} · ${o.closed ? 'Закрыт' : 'Открыт'} · ${rub(o.total)}`);
      card.append(title, node('p', `Резерв ${rub(o.reserved)} · накладные ${rub(o.used)}`));
      for (const l of o.lines) card.append(node('p', `${l.name}: заказано ${qty(l.quantity)} ${l.unit}, принято ${qty(l.received)}, осталось ${qty(l.remaining)} · цена ${rub(l.price)}`));
      const actions = node('div', null, 'button-row'); actions.append(history(o));
      if (!o.closed) {
        if (o.lines.some(l => l.remaining > 0)) actions.append(button('Принять поставку', () => receiptForm(o), 'primary'));
        if (!o.receiptIds.length) actions.append(button('Изменить заказ', () => orderForm(o)));
        actions.append(button('Закрыть остаток', () => {
          const f = node('form'); f.append(node('p', 'Оставшийся резерв будет освобождён. Накладные сохранятся.')); reason(f, o);
          submit(f, 'order', o, () => ({ ...o.data, lines: o.data.lines.map(l => ({ ...l, quantity: qty(l.quantity), price: amount(l.price) })), status: 'closed', ...values(f) })); modal('Закрытие заказа', f);
        }));
      } card.append(actions); orders.append(card);
    } root.append(orders);
    const incoming = surface('Накладные и расхождения');
    if (!s.receipts.length) incoming.append(node('p', 'Принятых накладных пока нет.', 'empty'));
    for (const r of s.receipts) {
      const o = s.orders.find(x => x.id === r.data.orderId), review = s.reviews.find(x => x.data.receiptId === r.id), card = node('details');
      card.append(node('summary', `№ ${r.data.number} · ${r.data.date} · ${rub(r.total)}${r.discrepancies.length ? ' · Есть расхождения' : ''}`));
      for (const l of r.data.lines) card.append(node('p', `${o.lines.find(x => x.id === l.lineId).name} · ${qty(l.quantity)} · ${rub(l.price)}`));
      for (const d of r.discrepancies) card.append(node('p', d.kind === 'price' ? `Изменена цена: ${o.lines.find(x => x.id === d.lineId).name}` : d.kind === 'shortage' ? `Недовоз: ${o.lines.find(x => x.id === d.lineId).name} · ${qty(d.quantity)}` : d.note, 'error'));
      card.append(history(r));
      if (review) card.append(node('p', `${review.data.state === 'resolved' ? 'Разобрано' : 'На проверке'}: ${review.data.explanation}`), history(review));
      if (r.discrepancies.length) card.append(button('Разобрать', () => {
        const f = node('form'); select(f, 'Состояние', 'state', [['open', 'На проверке'], ['resolved', 'Разобрано']], review?.data.state);
        field(f, 'Решение / пояснение', 'explanation', { value: review?.data.explanation ?? '', required: true, maxLength: 500 });
        field(f, 'Основание записи', 'reason', { required: true, maxLength: 500 });
        f.append(node('p', 'Пояснение не изменяет принятую сумму, оплату или склад.', 'fine'));
        submit(f, 'review', review, () => ({ ...values(f), receiptId: r.id })); modal('Разбор расхождения', f);
      })); incoming.append(card);
    } root.append(incoming);
    const suppliers = surface('Поставщики');
    for (const p of s.suppliers) { const row = node('div', null, 'row'), info = node('div', null, 'row-main'); info.append(node('strong', p.data.name), node('small', `${p.data.active ? 'Действует' : 'Архив'} · ${p.data.contact}`), node('small', p.data.terms)); row.append(info, button('Изменить', () => supplierForm(p)), history(p)); suppliers.append(row); } root.append(suppliers);
    function supplierForm(old) {
      const f = node('form'); field(f, 'Название', 'name', { value: old?.data.name ?? '', required: true, maxLength: 150 }); field(f, 'Контакт', 'contact', { value: old?.data.contact ?? '', maxLength: 200 }); field(f, 'Условия поставок', 'terms', { value: old?.data.terms ?? '', maxLength: 500 }); select(f, 'Состояние', 'active', [['yes', 'Действует'], ['no', 'Архив']], old?.data.active === false ? 'no' : 'yes'); reason(f, old);
      submit(f, 'supplier', old, () => ({ ...values(f), active: values(f).active === 'yes' })); modal('Поставщик', f);
    }
    function budgetForm(old) {
      const f = node('form'); field(f, 'Название лимита', 'name', { value: old?.data.name ?? '', required: true, maxLength: 150 }); field(f, 'Магазин / отдел / область', 'scope', { value: old?.data.scope ?? 'Магазин', required: true, maxLength: 150 });
      field(f, 'Начало периода', 'start', { type: 'date', value: old?.data.start ?? today(), required: true }); field(f, 'Конец периода', 'end', { type: 'date', value: old?.data.end ?? today(), required: true }); field(f, 'Лимит, ₽', 'amount', { value: old ? amount(old.data.amount) : '', required: true, inputMode: 'decimal' }); reason(f, old);
      f.append(node('p', 'Перенос остатка между периодами пока задаётся владельцем вручную.', 'fine')); submit(f, 'budget', old, () => values(f)); modal('Лимит закупок', f);
    }
    function orderForm(old) {
      if (!s.budgets.length || !s.suppliers.some(x => x.data.active) || !products.length) { modal('Подготовка заказа', node('p', 'Сначала добавьте поставщика, лимит и товары в каталог.')); return; }
      const f = node('form'); select(f, 'Поставщик', 'supplierId', s.suppliers.filter(x => x.data.active || x.id === old?.data.supplierId).map(x => [x.id, x.data.name]), old?.data.supplierId); select(f, 'Лимит', 'budgetId', s.budgets.map(x => [x.id, `${x.data.name} · доступно ${rub(x.available)}`]), old?.data.budgetId);
      if (old) { f.elements.supplierId.disabled = true; f.elements.budgetId.disabled = true; }
      field(f, 'Дата заказа', 'date', { type: 'date', value: old?.data.date ?? today(), required: true });
      const list = node('div'), lines = []; f.append(list);
      function add(l = {}) {
        const box = surface(), controls = node('div', null, 'fields'), id = l.id ?? crypto.randomUUID();
        const choices = products.map(p => [p.id, p.name]); if (l.productId && !products.some(x => x.id === l.productId)) choices.push([l.productId, l.name]);
        const product = select(controls, 'Товар', 'product', choices, l.productId), unit = field(controls, 'Единица', 'unit', { value: l.unit ?? 'шт', required: true, maxLength: 20 }), q = field(controls, 'Количество', 'quantity', { value: l.quantity ? qty(l.quantity) : '', required: true, inputMode: 'decimal' }), price = field(controls, 'Цена закупки, ₽', 'price', { value: l.price != null ? amount(l.price) : '', required: true, inputMode: 'decimal' });
        const entry = { id, product, unit, q, price, removed: false }; lines.push(entry); box.append(controls, button('Убрать строку', () => { entry.removed = true; box.remove(); })); list.append(box);
      }
      for (const l of old?.data.lines ?? [{}]) add(l);
      f.append(button('Добавить строку', () => add())); reason(f, old);
      submit(f, 'order', old, () => ({ ...values(f), supplierId: old?.data.supplierId ?? f.elements.supplierId.value, budgetId: old?.data.budgetId ?? f.elements.budgetId.value, status: 'open', lines: lines.filter(l => !l.removed).map(l => ({ id: l.id, productId: l.product.value, unit: l.unit.value, quantity: l.q.value, price: l.price.value })) })); modal('Заказ поставщику', f);
    }
    function receiptForm(o) {
      const f = node('form'); field(f, 'Номер накладной поставщика', 'number', { required: true, maxLength: 100 }); field(f, 'Дата накладной', 'date', { type: 'date', value: today(), required: true });
      const lines = [];
      for (const l of o.lines.filter(x => x.remaining > 0)) {
        const box = surface(l.name); box.append(node('p', `Осталось ${qty(l.remaining)} ${l.unit}. Пустое количество — позиция не принята.`, 'fine'));
        const q = field(box, 'Фактически принято', 'quantity', { inputMode: 'decimal' }), price = field(box, 'Фактическая цена, ₽', 'price', { value: amount(l.price), inputMode: 'decimal' }); lines.push({ lineId: l.id, q, price }); f.append(box);
      }
      select(f, 'Продолжение заказа', 'final', [['no', 'Ждём оставшиеся позиции'], ['yes', 'Последняя поставка, освободить остаток']]); field(f, 'Недовоз / повреждение / изменение цены', 'note', { maxLength: 500 });
      f.append(node('p', 'Принятая накладная сохраняется без перезаписи. Проверьте фактическое количество и цену.', 'fine'));
      submit(f, 'receipt', null, () => ({ orderId: o.id, orderVersion: o.version, number: f.elements.number.value, date: f.elements.date.value, final: f.elements.final.value === 'yes', note: f.elements.note.value, lines: lines.filter(l => l.q.value.trim()).map(l => ({ lineId: l.lineId, quantity: l.q.value, price: l.price.value })) })); modal('Приёмка поставки', f);
    }
    return root;
  };
}
