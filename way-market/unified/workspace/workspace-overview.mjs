// Dashboard reads the entire visible set; list-page limits must not truncate counts.
export function overview(db, actor, finance = null, now = Date.now()) {
  const manager = ['owner', 'accountant'].includes(actor.role);
  const tasks = db.prepare(`SELECT id,title,assignee_id FROM workspace_tasks
    WHERE status='open' AND (?=1 OR (?=1 AND related_cash IS NULL) OR assignee_id=? OR creator_id=?)
    ORDER BY CASE WHEN assignee_id=? THEN 0 ELSE 1 END,at_ms DESC,id`).all(Number(manager), Number(actor.role === 'administrator'), actor.id, actor.id, actor.id);
  const state = {at: now, date: new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow'}).format(new Date(now)), tasks: {
    mineOpen: tasks.filter(t => t.assignee_id === actor.id).length,
    recent: tasks.slice(0,5).map(t => ({id:t.id, title:t.title, assigneeId:t.assignee_id}))
  }};
  if (manager || actor.role === 'cashier') {
    const cash = db.prepare(`SELECT c.status,c.input FROM workspace_cash c
      JOIN (SELECT id,MAX(version) v FROM workspace_cash GROUP BY id) m ON c.id=m.id AND c.version=m.v
      WHERE (?=1 OR c.cashier_id=?) ORDER BY c.at_ms DESC,c.id`).all(Number(manager), actor.id);
    state.cash = {pending:cash.filter(c => c.status === 'submitted').length, recent:cash.slice(0,5).map(c => {
      const input = JSON.parse(c.input); return {date:input.date, register:input.register, shiftNo:input.shiftNo, status:c.status};
    })};
  }
  // Never expose finance fields to cashiers, administrators or other operational roles.
  if (manager && finance) {
    const payable = finance.obligations.filter(o => o.data.direction === 'payable' && o.data.status === 'open' && o.remaining > 0)
      .sort((a,b) => a.data.dueDate.localeCompare(b.data.dueDate) || a.id.localeCompare(b.id));
    state.finance = {
      accountCount:finance.accounts.length,
      accounts:finance.accounts.slice(0,4).map(a => ({id:a.id, name:a.data.name, type:a.data.type, active:a.data.active, balance:a.balance})),
      balance:finance.accounts.reduce((n,a) => n+a.balance,0),
      payable:payable.reduce((n,o) => n+o.remaining,0),
      overdueCount:payable.filter(o => o.data.dueDate < state.date).length,
      upcoming:payable.slice(0,5).map(o => ({id:o.id, party:o.data.party, remaining:o.remaining, dueDate:o.data.dueDate}))
    };
  }
  return state;
}
