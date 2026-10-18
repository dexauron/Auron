import { createHash, randomUUID } from 'node:crypto';
import { openAccounts } from './accounts.mjs';
import { AccessError } from './access.mjs';
import { InputError, money } from './domain.mjs';
import { reconcileExcel, defaultExcelSettings, EXCEL_FIELDS } from './worksheet.mjs';

export class VersionError extends Error {}
const manager = a => ['owner', 'accountant'].includes(a.role);
const taskManager = a => ['owner', 'accountant', 'administrator'].includes(a.role);
const text = (v, max) => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) throw new InputError('Проверьте заполненные поля'); return v.trim(); };
const latest = (db, id) => db.prepare('SELECT * FROM workspace_cash WHERE id=? ORDER BY version DESC LIMIT 1').get(id);
const unpack = row => row && ({ id: row.id, version: row.version, cashierId: row.cashier_id, actorId: row.actor_id, status: row.status, at: row.at_ms, input: JSON.parse(row.input), result: JSON.parse(row.result), reason: row.reason });
function cashView(row, actor) {
  const result = unpack(row);
  if (actor.role === 'cashier') {
    result.input.worksheet.values.received = '';
    result.input.accountant = 'Проверяет бухгалтер';
    result.result = reconcileExcel(result.input);
  }
  return result;
}
const taskView = row => ({ id: row.id, version: row.version, title: row.title, assigneeId: row.assignee_id, creatorId: row.creator_id, status: row.status, relatedCash: row.related_cash, at: row.at_ms });
function request(db, key, payload, apply) {
  if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/.test(key)) throw new InputError('Нужен идентификатор команды');
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const old = db.prepare('SELECT * FROM workspace_requests WHERE id=?').get(key);
  if (old) { if (old.digest !== digest) throw new VersionError('Идентификатор команды уже использован'); return JSON.parse(old.result); }
  const result = apply();
  db.prepare('INSERT INTO workspace_requests VALUES (?,?,?)').run(key, digest, JSON.stringify(result));
  return result;
}

export function openWorkspace(filename, options = {}) {
  const accounts = openAccounts(filename, { ...options, workspace: true });
  const command = accounts.command;
  return {
    accounts,
    directory(token) { return command(token, 'workspace.read', () => ({}), (db, actor) => {
      if (!taskManager(actor)) return [{ id: actor.id, name: actor.name, role: actor.role }];
      return db.prepare('SELECT id,name,role FROM account_users WHERE active=1 ORDER BY name').all();
    }); },
    cashList(token) { return command(token, 'workspace.read', () => ({}), (db, actor) => {
      if (!manager(actor) && actor.role !== 'cashier') throw new AccessError();
      return db.prepare(`SELECT c.* FROM workspace_cash c JOIN (SELECT id,MAX(version) v FROM workspace_cash GROUP BY id) m ON c.id=m.id AND c.version=m.v WHERE (?=1 OR c.cashier_id=?) ORDER BY c.at_ms DESC,c.id LIMIT 100`).all(Number(manager(actor)), actor.id).map(r => cashView(r, actor));
    }); },
    cashGet(token, id, history = false) { return command(token, 'cash.read', db => ({ cashierId: latest(db, id)?.cashier_id }), (db, actor) => {
      const rows = db.prepare('SELECT * FROM workspace_cash WHERE id=? ORDER BY version DESC').all(id);
      if (!rows.length) throw new InputError('Сдача не найдена');
      return history ? rows.map(r => cashView(r, actor)) : cashView(rows[0], actor);
    }); },
    cashSave(token, p) {
      if (!p || typeof p.accept !== 'boolean') throw new InputError('Выберите отправку или приём кассы');
      return command(token, p.accept ? 'cash.accept' : 'cash.submit', (db, actor) => ({ cashierId: p.id ? latest(db, p.id)?.cashier_id : p.cashierId ?? actor.id }), (db, actor, audit, at) => {
        return request(db, p.requestId, { actorId: actor.id, kind: 'cash', payload: p }, () => {
          const old = p.id ? latest(db, p.id) : null;
          if (!Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 0 || (p.id ? !old || old.version !== p.expectedVersion : p.expectedVersion !== 0)) throw new VersionError('Сдача изменена. Откройте актуальную версию');
          if (actor.role === 'cashier' && old?.status === 'accepted') throw new AccessError('Принятую сдачу исправляет бухгалтер');
          const cashierId = old?.cashier_id ?? p.cashierId ?? actor.id;
          const cashier = db.prepare('SELECT * FROM account_users WHERE id=? AND active=1').get(cashierId);
          if (!cashier || !['cashier', 'employee', 'owner', 'accountant'].includes(cashier.role)) throw new InputError('Выберите действующего кассира');
          if (old && p.cashierId && p.cashierId !== old.cashier_id) throw new InputError('Нельзя менять кассира сохранённой сдачи');
          const input = structuredClone(p.input);
          if (!input?.worksheet?.values) throw new InputError('Неверная структура сдачи');
          if (actor.role === 'cashier' && input.worksheet.values.received !== '') throw new AccessError('Приём денег подтверждает бухгалтер');
          input.cashier = cashier.name; input.author = actor.name;
          input.accountant = manager(actor) ? actor.name : 'Ожидает приёма';
          const result = reconcileExcel(input);
          const shiftKey = JSON.stringify([result.date, result.register.toLowerCase(), result.shiftNo.toLowerCase()]);
          if (!old && db.prepare('SELECT id FROM workspace_cash WHERE shift_key=? LIMIT 1').get(shiftKey)) throw new VersionError('Эта касса и смена уже сохранены за выбранную дату');
          if (p.accept && result.received === null) throw new InputError('Для приёма внесите фактически пересчитанную сумму');
          if (!p.accept && result.received !== null) throw new InputError('Пересчёт сохраняется действием «Принять кассу»');
          const reason = old ? text(p.reason, 500) : '';
          if (old) { const prev = JSON.parse(old.input); if (prev.date !== input.date || prev.register !== input.register || prev.shiftNo !== input.shiftNo) throw new InputError('Нельзя менять дату, кассу и идентификатор сдачи'); }
          const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
          db.prepare('INSERT INTO workspace_cash VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, version, shiftKey, cashierId, actor.id, p.accept ? 'accepted' : 'submitted', at, JSON.stringify(input), JSON.stringify(result), reason);
          audit(p.accept ? 'cash.accepted' : 'cash.submitted', id, { version, cashierId, reason });
          return { id, version };
        });
      });
    },
    tasks(token) { return command(token, 'tasks.read', () => ({}), (db, a) => db.prepare('SELECT * FROM workspace_tasks WHERE (?=1 OR (?=1 AND related_cash IS NULL) OR assignee_id=? OR creator_id=?) ORDER BY at_ms DESC,id LIMIT 200').all(Number(manager(a)), Number(a.role === 'administrator'), a.id, a.id).map(taskView)); },
    taskSave(token, p) { return command(token, p.id ? 'tasks.update' : 'tasks.create', () => ({}), (db, actor, audit, at) => request(db, p.requestId, { actorId: actor.id, kind: 'task', payload: p }, () => {
      const old = p.id ? db.prepare('SELECT * FROM workspace_tasks WHERE id=?').get(p.id) : null;
      if (p.id && !old) throw new AccessError();
      if (old && !taskManager(actor) && old.assignee_id !== actor.id) throw new AccessError();
      if (old?.related_cash && !manager(actor) && latest(db, old.related_cash)?.cashier_id !== actor.id) throw new AccessError();
      if (p.expectedVersion !== (old?.version ?? 0)) throw new VersionError('Задача уже изменена');
      if (!['open', 'done'].includes(p.status)) throw new InputError('Неизвестный статус');
      if (p.relatedCash && p.relatedCash !== old?.related_cash) {
        const cash = latest(db, p.relatedCash);
        if (!cash || (!manager(actor) && cash.cashier_id !== actor.id)) throw new AccessError('Нельзя связать чужую сдачу');
        // Administrators can manage tasks but never discover financial records.
        if (!manager(actor)) throw new AccessError();
      }
      const title = text(p.title, 200), assignee = text(p.assigneeId, 36);
      if (p.relatedCash) { const recipient = db.prepare('SELECT role FROM account_users WHERE id=?').get(assignee); if (!recipient || (!['owner', 'accountant'].includes(recipient.role) && latest(db, p.relatedCash)?.cashier_id !== assignee)) throw new AccessError('Финансовое поручение доступно только участникам сдачи'); }
      if (old && !taskManager(actor) && (title !== old.title || assignee !== old.assignee_id || (p.relatedCash ?? null) !== old.related_cash)) throw new AccessError();
      if (!db.prepare('SELECT id FROM account_users WHERE id=? AND active=1').get(assignee)) throw new InputError('Исполнитель недоступен');
      const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
      db.prepare('INSERT INTO workspace_tasks VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,title=excluded.title,assignee_id=excluded.assignee_id,status=excluded.status,related_cash=excluded.related_cash,at_ms=excluded.at_ms').run(id, version, old?.creator_id ?? actor.id, assignee, title, p.status, p.relatedCash ?? null, at);
      audit('task.changed', id, { before: old ? taskView(old) : null, version, title, assigneeId: assignee, status: p.status, relatedCash: p.relatedCash ?? null });
      return { id, version };
    })); },
    products(token) { return command(token, 'catalog.read', () => ({}), db => db.prepare('SELECT * FROM workspace_products WHERE active=1 ORDER BY name LIMIT 1000').all()); },
    productSave(token, p) { return command(token, 'catalog.manage', () => ({}), (db, actor, audit) => request(db, p.requestId, { actorId: actor.id, kind: 'product', payload: p }, () => {
      const old = p.id ? db.prepare('SELECT * FROM workspace_products WHERE id=?').get(p.id) : null;
      if (p.expectedVersion !== (old?.version ?? 0) || (p.id && !old)) throw new VersionError('Товар изменён');
      const name = text(p.name, 150), barcode = typeof p.barcode === 'string' && /^\d{0,32}$/.test(p.barcode) ? p.barcode : null;
      if (barcode === null || typeof p.active !== 'boolean') throw new InputError('Проверьте штрихкод и состояние товара');
      const price = money(p.price, 'Розничная цена'), id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
      db.prepare('INSERT INTO workspace_products VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,name=excluded.name,barcode=excluded.barcode,price=excluded.price,active=excluded.active').run(id, version, name, barcode, price, Number(p.active));
      audit('product.changed', id, { before: old ?? null, after: { version, name, barcode, price, active: p.active } });
      return { id, version };
    })); },
    close: accounts.close
  };
}

export function emptySheet() {
  const settings = defaultExcelSettings();
  return { date: '', register: settings.register, shiftNo: '', cashier: '', author: '', accountant: '', worksheet: { settings, values: Object.fromEntries(EXCEL_FIELDS.map(f => [f.id, ''])), counts: { receipts: '', documents: '' }, sourceNote: '' } };
}
