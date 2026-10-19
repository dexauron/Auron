// Internal policy. The principal and resource ownership must come from the server,
// never from request fields, a display name, or a browser role selector.
const actions = new Set(['cash.read', 'cash.submit', 'cash.accept', 'cash.correct',
  'cash.settings', 'archive.manage', 'accounts.manage', 'security.read', 'workspace.read',
  'tasks.read', 'tasks.create', 'tasks.update', 'catalog.read', 'catalog.manage', 'backup.manage', 'procurement.read', 'procurement.manage', 'procurement.budget', 'finance.read', 'finance.manage', 'finance.accounts', 'finance.correct']);
export function permitted(principal, action, resource = {}) {
  if (!principal?.id || !principal.active || !actions.has(action)) return false;
  if (principal.role === 'owner') return true;
  if (['workspace.read', 'catalog.read', 'tasks.read', 'tasks.update'].includes(action)) return ['administrator', 'accountant', 'cashier', 'employee', 'representative'].includes(principal.role);
  if (['procurement.read', 'procurement.manage', 'finance.read', 'finance.manage'].includes(action)) return principal.role === 'accountant';
  if (action === 'tasks.create') return ['administrator', 'accountant'].includes(principal.role);
  if (action === 'catalog.manage') return principal.role === 'administrator';
  if (principal.role === 'accountant') return ['cash.read', 'cash.submit', 'cash.accept', 'cash.correct', 'cash.settings', 'archive.manage'].includes(action);
  if (principal.role === 'cashier') return ['cash.read', 'cash.submit'].includes(action) && resource?.cashierId === principal.id;
  return false;
}

export class AccessError extends Error {
  constructor(message = 'Доступ запрещён') { super(message); this.name = 'AccessError'; }
}
