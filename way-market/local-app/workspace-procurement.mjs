import { randomUUID } from 'node:crypto';
import { InputError, money } from './domain.mjs';
import { procurementState, validateProcurementDocument, quantity } from './procurement-data.mjs';
const latestRows = db => db.prepare('SELECT d.* FROM workspace_procurement d JOIN (SELECT id,MAX(version) v FROM workspace_procurement GROUP BY id) m ON d.id=m.id AND d.version=m.v').all();
const products = db => db.prepare('SELECT id FROM workspace_products').all();
const clean = v => typeof v === 'string' ? v.trim() : v;
export function procurementMethods(command, request, Conflict) {
  const state = db => procurementState(latestRows(db), products(db));
  return {
    procurement(token) { return command(token, 'procurement.read', () => ({}), db => state(db)); },
    procurementHistory(token, id) { return command(token, 'procurement.read', () => ({}), db => db.prepare('SELECT * FROM workspace_procurement WHERE id=? ORDER BY version').all(id).map(r => ({ ...r, data: JSON.parse(r.data) }))); },
    procurementSave(token, p) {
      if (!p || typeof p !== 'object') throw new InputError('Нужен документ закупки');
      const action = p.kind === 'budget' ? 'procurement.budget' : 'procurement.manage';
      return command(token, action, () => ({}), (db, actor, audit, at) => request(db, p.requestId, { actorId: actor.id, kind: 'procurement', payload: p }, () => {
        const old = p.id ? db.prepare('SELECT * FROM workspace_procurement WHERE id=? ORDER BY version DESC LIMIT 1').get(p.id) : null;
        if (!Number.isSafeInteger(p.expectedVersion) || p.expectedVersion !== (old?.version ?? 0) || (p.id && !old)) throw new Conflict('Документ изменён. Обновите закупки');
        if (old && old.kind !== p.kind) throw new InputError('Тип документа нельзя менять');
        const before = state(db), previous = old ? JSON.parse(old.data) : null;
        const reason = old || p.kind === 'review' ? clean(p.reason) : '';
        if (typeof reason !== 'string' || reason.length > 500 || /[\x00-\x1f]/.test(reason) || ((old || p.kind === 'review') && !reason)) throw new InputError('Укажите причину изменения');
        let d;
        if (p.kind === 'supplier') d = { name: clean(p.name), contact: clean(p.contact), terms: clean(p.terms), active: p.active };
        else if (p.kind === 'budget') d = { name: clean(p.name), scope: clean(p.scope), start: p.start, end: p.end, amount: money(p.amount, 'Лимит') };
        else if (p.kind === 'order') {
          if (!Array.isArray(p.lines) || p.lines.some(l => !l || typeof l !== 'object' || Array.isArray(l))) throw new InputError('Добавьте строки заказа');
          d = { supplierId: p.supplierId, budgetId: p.budgetId, date: p.date, status: p.status, lines: p.lines.map(l => {
            const product = db.prepare('SELECT * FROM workspace_products WHERE id=?').get(l.productId);
            if (!product || (!product.active && !previous?.lines.some(x => x.productId === product.id))) throw new InputError('Товар недоступен');
            return { id: l.id, productId: product.id, name: previous?.lines.find(x => x.id === l.id && x.productId === product.id)?.name ?? product.name, unit: clean(l.unit), quantity: quantity(l.quantity), price: money(l.price, 'Закупочная цена') };
          }) };
          const oldOrder = before.orders.find(x => x.id === old?.id);
          if (oldOrder?.closed) throw new InputError('Закрытый заказ нельзя изменить');
          if (oldOrder?.receiptIds.length && JSON.stringify({ ...d, status: 'open' }) !== JSON.stringify(previous)) throw new InputError('После приёмки можно только закрыть остаток заказа');
          if (!old && d.status !== 'open') throw new InputError('Новый заказ должен быть открыт');
          const supplier = before.suppliers.find(x => x.id === d.supplierId);
          if (!supplier?.data.active && (!old || previous.supplierId !== d.supplierId)) throw new InputError('Выберите действующего поставщика');
          if (old && (previous.budgetId !== d.budgetId || previous.supplierId !== d.supplierId)) throw new InputError('Поставщика и бюджет сохранённого заказа нельзя менять');
        } else if (p.kind === 'receipt') {
          if (old) throw new InputError('Принятая накладная неизменяема; оформите разбор расхождения');
          const order = before.orders.find(x => x.id === p.orderId);
          if (!order || order.closed) throw new InputError('Заказ закрыт или недоступен');
          if (p.orderVersion !== order.version) throw new Conflict('Заказ изменён. Обновите закупки перед приёмкой');
          if (!Array.isArray(p.lines) || p.lines.some(l => !l || typeof l !== 'object' || Array.isArray(l))) throw new InputError('Добавьте фактически принятые позиции');
          d = { orderId: p.orderId, orderVersion: p.orderVersion, number: clean(p.number), date: p.date, final: p.final, note: clean(p.note), lines: p.lines.map(l => ({ lineId: l.lineId, quantity: quantity(l.quantity), price: money(l.price, 'Цена накладной') })) };
          const priceDiff = d.lines.some(l => order.lines.find(x => x.id === l.lineId)?.price !== l.price);
          const shortage = d.final && order.lines.some(l => l.remaining > (d.lines.find(x => x.lineId === l.id)?.quantity ?? 0));
          if ((priceDiff || shortage) && !d.note) throw new InputError('Опишите изменение цены или недовоз');
        } else if (p.kind === 'review') {
          if (before.reviews.some(x => x.id !== old?.id && x.data.receiptId === p.receiptId)) throw new Conflict('Разбор этой накладной уже создан');
          if (old && previous.receiptId !== p.receiptId) throw new InputError('Нельзя менять накладную разбора');
          d = { receiptId: p.receiptId, state: p.state, explanation: clean(p.explanation) };
        } else throw new InputError('Неизвестный тип документа');
        validateProcurementDocument(p.kind, d);
        const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
        const row = { id, version, kind: p.kind, actor_id: actor.id, at_ms: at, data: JSON.stringify(d), reason };
        procurementState([...latestRows(db).filter(x => x.id !== id), row], products(db));
        db.prepare('INSERT INTO workspace_procurement VALUES (?,?,?,?,?,?,?)').run(id, version, p.kind, actor.id, at, row.data, reason);
        audit('procurement.changed', id, { version, kind: p.kind, before: previous, after: d, reason });
        return { id, version };
      }));
    }
  };
}
