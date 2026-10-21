import {cashRevenueStatus,cashHandoverConflict,annotateCashPosting} from './shared-cash.mjs';
import { randomUUID } from 'node:crypto';
import { InputError, money } from './domain.mjs';
import { financeState, financeReport, validateFinanceDocument, financeDate, financeId } from './finance-data.mjs';
import { procurementState } from './procurement-data.mjs';
export const latestFinance = db => db.prepare('SELECT d.* FROM workspace_finance d JOIN (SELECT id,MAX(version) v FROM workspace_finance GROUP BY id) m ON d.id=m.id AND d.version=m.v').all();
export function workspaceFinancialState(db) {
  const procurement = procurementState(db.prepare('SELECT d.* FROM workspace_procurement d JOIN (SELECT id,MAX(version) v FROM workspace_procurement GROUP BY id) m ON d.id=m.id AND d.version=m.v').all(), db.prepare('SELECT id FROM workspace_products').all());
  return annotateCashPosting(db, financeState(latestFinance(db), procurement, db.prepare('SELECT * FROM workspace_cash ORDER BY id,version').all()));
}
const clean = v => typeof v === 'string' ? v.trim() : v;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
export function financeMethods(command, request, Conflict) {
  return {
    finance(token) { return command(token, 'finance.read', () => ({}), db => workspaceFinancialState(db)); },
    financeReport(token, start, end) { return command(token, 'finance.read', () => ({}), db => financeReport(workspaceFinancialState(db), start, end)); },
    financeHistory(token, id) { return command(token, 'finance.read', () => ({}), db => db.prepare('SELECT * FROM workspace_finance WHERE id=? ORDER BY version').all(id).map(r => ({ ...r, data: JSON.parse(r.data) }))); },
    financeSave(token, p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new InputError('Нужен финансовый документ');
      for (const key of ['id', 'receiptId', 'supplierId', 'cashId']) if (p[key] != null && p[key] !== '' && !financeId(p[key])) throw new InputError('Неверный идентификатор финансового основания');
      const action = p.kind === 'account' ? 'finance.accounts' : p.kind === 'reversal' ? 'finance.correct' : 'finance.manage';
      return command(token, action, () => ({}), (db, actor, audit, at) => request(db, p.requestId, { actorId: actor.id, kind: 'finance', payload: p }, () => {
        const old = p.id ? db.prepare('SELECT * FROM workspace_finance WHERE id=? ORDER BY version DESC LIMIT 1').get(p.id) : null;
        if (!Number.isSafeInteger(p.expectedVersion) || p.expectedVersion !== (old?.version ?? 0) || (p.id && !old)) throw new Conflict('Финансовый документ изменён. Обновите раздел');
        if (old && old.kind !== p.kind) throw new InputError('Тип документа нельзя менять');
        if (old && ['movement', 'reversal'].includes(old.kind)) throw new InputError('Проведённая запись неизменяема. Используйте корректировку');
        const before = workspaceFinancialState(db), previous = old ? JSON.parse(old.data) : null;
        const reason = clean(p.reason ?? '');
        if (typeof reason !== 'string' || reason.length > 500 || /[\x00-\x1f]/.test(reason) || ((old || p.kind === 'reversal') && !reason)) throw new InputError('Укажите причину изменения');
        const refs = new Map();
        const ref = (id, kind, active = true) => {
          const group = { account: before.accounts, obligation: before.obligations, plan: before.plans, movement: before.movements }[kind], found = group?.find(x => x.id === id);
          if (!found || (active && (kind === 'account' ? !found.data.active : kind === 'obligation' ? found.data.status !== 'open' : kind === 'plan' ? found.data.status !== 'scheduled' : false))) throw new InputError('Связанный документ закрыт или недоступен');
          refs.set(id, found.version); return found;
        };
        let d;
        if (p.kind === 'account') {
          d = { name: clean(p.name), type: p.type, openingDate: p.openingDate, openingBalance: money(p.openingBalance, 'Начальный остаток'), active: p.active };
          if (old && before.movements.some(m => m.data.accountId === old.id || m.data.toAccountId === old.id) && ['type', 'openingDate', 'openingBalance'].some(k => d[k] !== previous[k])) throw new InputError('После движений начальный остаток, дата и тип счёта неизменяемы');
          if (old && !d.active && before.plans.some(x => x.data.accountId === old.id && x.data.status === 'scheduled' && x.remaining > 0)) throw new InputError('Сначала отмените незавершённые назначения счёта');
          if (financeDate(d.openingDate) && d.openingDate > today()) throw new InputError('Начальный остаток нельзя задать будущей датой');
        } else if (p.kind === 'obligation') {
          if (previous?.receiptId || p.receiptId) {
            const receiptId = previous?.receiptId ?? p.receiptId;
            const receipt = db.prepare("SELECT * FROM workspace_procurement WHERE id=? AND kind='receipt' ORDER BY version DESC LIMIT 1").get(receiptId);
            if (!receipt || p.receiptVersion !== receipt.version) throw new Conflict('Обновите исходную накладную');
            const receiptData = JSON.parse(receipt.data), procurement = procurementState(db.prepare('SELECT d.* FROM workspace_procurement d JOIN (SELECT id,MAX(version) v FROM workspace_procurement GROUP BY id) m ON d.id=m.id AND d.version=m.v').all(), db.prepare('SELECT id FROM workspace_products').all());
            const order = procurement.orders.find(o => o.id === receiptData.orderId), supplier = procurement.suppliers.find(s => s.id === order.data.supplierId), amount = procurement.receipts.find(r => r.id === receiptId).total;
            d = { direction: 'payable', party: previous?.party ?? supplier.data.name, supplierId: supplier.id, receiptId, amount, date: receiptData.date, dueDate: p.dueDate, basis: clean(p.basis), status: p.status };
          } else {
            const supplier = p.supplierId ? db.prepare("SELECT data FROM workspace_procurement WHERE id=? AND kind='supplier' ORDER BY version DESC LIMIT 1").get(p.supplierId) : null;
            if (p.supplierId && !supplier) throw new InputError('Поставщик недоступен');
            d = { direction: p.direction, party: previous?.party ?? (supplier ? JSON.parse(supplier.data).name : clean(p.party)), supplierId: p.supplierId ?? null, receiptId: null, amount: money(p.amount, 'Сумма долга'), date: p.date, dueDate: p.dueDate, basis: clean(p.basis), status: p.status };
          }
          if (old && ['direction', 'party', 'supplierId', 'receiptId', 'amount', 'date'].some(k => d[k] !== previous[k])) throw new InputError('Основание и сумма долга неизменяемы. Отмените ошибочное обязательство отдельным действием');
          if (!old && d.status !== 'open') throw new InputError('Новый долг должен быть открыт');
          if (d.date > today()) throw new InputError('Долг фиксируется по состоявшемуся основанию');
        } else if (p.kind === 'plan') {
          const obligation = ref(p.obligationId, 'obligation'), account = ref(p.accountId, 'account', p.status !== 'cancelled');
          d = { obligationId: obligation.id, accountId: account.id, amount: money(p.amount, 'Сумма назначения'), date: p.date, status: p.status, note: clean(p.note) };
          if (old && before.movements.some(m => m.data.planId === old.id) && ['obligationId', 'accountId', 'amount'].some(k => d[k] !== previous[k])) throw new InputError('После исполнения меняются только дата, пояснение и отмена остатка назначения');
          if (!old && d.status !== 'scheduled') throw new InputError('Новое назначение должно ожидать исполнения');
        } else if (p.kind === 'movement') {
          if (p.confirmed !== true) throw new InputError('Подтвердите, что движение денег действительно состоялось');
          const account = ref(p.accountId, 'account');
          d = { type: p.type, accountId: account.id, toAccountId: null, obligationId: null, planId: null, cashId: null, cashVersion: null, amount: money(p.amount, 'Фактическая сумма'), date: p.date, purpose: clean(p.purpose), evidence: clean(p.evidence), reference: clean(p.reference ?? '') };
          if (p.type === 'transfer') d.toAccountId = ref(p.toAccountId, 'account').id;
          if (p.type === 'settlement') {
            const o = ref(p.obligationId, 'obligation'); d.obligationId = o.id;
            if (p.planId) { const plan = ref(p.planId, 'plan'); d.planId = plan.id; if (d.amount > plan.remaining) throw new InputError('Сумма превышает остаток назначения'); }
            if (d.amount > o.remaining) throw new InputError('Сумма превышает остаток долга. Авансы оформляются отдельно');
          }
          if (p.type === 'cash_handover') {
            const c = db.prepare('SELECT * FROM workspace_cash WHERE id=? ORDER BY version DESC LIMIT 1').get(p.cashId);
            if (!c || c.status !== 'accepted' || c.version !== p.cashVersion) throw new Conflict('Сдача кассы изменена или ещё не принята');
            const posting = cashRevenueStatus(db, JSON.parse(c.input));
            if (posting) throw new InputError(posting.reason);
            if(cashHandoverConflict(db,JSON.parse(c.input),before.movements,c.id)) throw new InputError('Деньги этой смены уже отражены по другому кассовому листу');
            const received = JSON.parse(c.result).received;
            if (d.amount !== received) throw new InputError('В деньги отражается только фактически принятая сумма сдачи');
            d.cashId = c.id; d.cashVersion = c.version;
          }
          if (financeDate(d.date) && d.date > today()) throw new InputError('Будущая дата — назначение, а не фактическое движение');
          // Reject unrelated links instead of silently ignoring an accidental source.
          for (const key of ['toAccountId', 'obligationId', 'planId', 'cashId', 'cashVersion']) if (p[key] != null && p[key] !== '' && p[key] !== d[key]) throw new InputError('Проверьте вид движения и выбранное основание');
        } else if (p.kind === 'bank_line') {
          const account = ref(p.accountId, 'account', false);
          if (account.data.type !== 'bank') throw new InputError('Выберите банковский счёт');
          const movement = p.movementId ? ref(p.movementId, 'movement', false) : null;
          d = { accountId: account.id, reference: clean(p.reference), date: p.date, direction: p.direction, amount: money(p.amount, 'Сумма выписки'), movementId: movement?.id ?? null, note: clean(p.note), status: p.status ?? 'active' };
          if (!old && d.status !== 'active') throw new InputError('Новая строка выписки должна быть действующей');
          if (old && ['accountId', 'reference', 'date', 'direction', 'amount'].some(k => d[k] !== previous[k])) throw new InputError('Исходные данные строки выписки неизменяемы; уточняется только сопоставление и пояснение');
          if (financeDate(d.date) && d.date > today()) throw new InputError('Будущая дата не является фактом банковской выписки');
        } else if (p.kind === 'reversal') {
          if (p.confirmed !== true) throw new InputError('Подтвердите корректировку ошибочной записи');
          const m = ref(p.movementId, 'movement', false);
          if (m.reversedBy) throw new Conflict('Запись уже скорректирована');
          d = { movementId: m.id, date: p.date, explanation: reason };
          if (financeDate(d.date) && d.date > today()) throw new InputError('Корректировка не проводится будущей датой');
        } else throw new InputError('Неизвестный финансовый документ');
        const expectedRefs = p.refVersions;
        if (!expectedRefs || typeof expectedRefs !== 'object' || Array.isArray(expectedRefs) || Object.keys(expectedRefs).length !== refs.size || [...refs].some(([id, version]) => expectedRefs[id] !== version)) throw new Conflict('Связанные данные изменились. Обновите финансовый раздел');
        validateFinanceDocument(p.kind, d);
        const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
        const row = { id, version, kind: p.kind, actor_id: actor.id, at_ms: at, data: JSON.stringify(d), reason };
        const procurement = procurementState(db.prepare('SELECT d.* FROM workspace_procurement d JOIN (SELECT id,MAX(version) v FROM workspace_procurement GROUP BY id) m ON d.id=m.id AND d.version=m.v').all(), db.prepare('SELECT id FROM workspace_products').all());
        const after = financeState([...latestFinance(db).filter(x => x.id !== id), row], procurement, db.prepare('SELECT * FROM workspace_cash ORDER BY id,version').all());
        if (p.kind === 'plan' && d.status === 'scheduled') {
          const o = after.obligations.find(o => o.id === d.obligationId);
          if (o.overplanned) throw new InputError('Назначения превышают неоплаченный остаток долга');
        }
        if (p.kind === 'movement' && !reason && after.accounts.some(a => a.negative && a.balance < before.accounts.find(x => x.id === a.id).balance)) throw new InputError('Возникает отрицательный остаток. Укажите причину расхождения учёта');
        db.prepare('INSERT INTO workspace_finance VALUES (?,?,?,?,?,?,?)').run(id, version, p.kind, actor.id, at, row.data, reason);
        audit('finance.changed', id, { version, kind: p.kind, before: previous, after: d, reason });
        return { id, version };
      }));
    }
  };
}
