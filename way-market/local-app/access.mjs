// Internal policy. The principal and resource ownership must come from the server,
// never from request fields, a display name, or a browser role selector.
const actions = new Set(['cash.read', 'cash.submit', 'cash.accept', 'cash.correct',
  'cash.settings', 'archive.manage', 'accounts.manage', 'security.read']);
export function permitted(principal, action, resource = {}) {
  if (!principal?.id || !principal.active || !actions.has(action)) return false;
  if (principal.role === 'owner') return true;
  if (principal.role === 'accountant') return ['cash.read', 'cash.submit', 'cash.accept', 'cash.correct', 'cash.settings', 'archive.manage'].includes(action);
  if (principal.role === 'cashier') return ['cash.read', 'cash.submit'].includes(action) && resource?.cashierId === principal.id;
  return false;
}

export class AccessError extends Error {
  constructor(message = 'Доступ запрещён') { super(message); this.name = 'AccessError'; }
}
