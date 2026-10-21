import { InputError } from './domain.mjs';
// A physical shift is independent of the employee who filled either form.
const normalized = v => String(v ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
export function cashShiftKey(input) {
  const register = normalized(input.register), raw = normalized(input.shiftNo ?? input.shift_num);
  if (!register || register.length > 150 || !raw || raw.length > 100 || /[\x00-\x1f]/.test(register + raw)) throw new InputError('Укажите кассу и номер смены');
  const shift = /^\d+$/.test(raw) ? BigInt(raw).toString() : raw;
  return JSON.stringify([input.date, register, shift]);
}
export function latestUnifiedShifts(db) {
  const shifts = new Map();
  for (const row of db.prepare("SELECT subject_id,detail FROM account_events WHERE kind='unified.shift' ORDER BY sequence").all()) shifts.set(row.subject_id, {id:row.subject_id,...JSON.parse(row.detail).value});
  return [...shifts.values()];
}
export function shiftMatches(shift, input) {
  if (shift.date !== input.date) return false;
  // Historical Z-reports did not identify the register. Never guess which one.
  const register = shift.register || input.register;
  return cashShiftKey({date:shift.date, register, shiftNo:shift.shift_num}) === cashShiftKey(input);
}
export function cashRevenueStatus(db, input, shifts=latestUnifiedShifts(db)) {
  const shift = shifts.find(s => s.status !== 'cancelled' && shiftMatches(s,input));
  if (!shift) return null;
  return {status:shift.register ? 'z_report' : 'legacy_review', shiftId:shift.id, reason:shift.register
    ? 'Деньги этой смены уже учтены по Z-отчёту. Перемещение в сейф оформите переводом между счетами.'
    : 'Есть старый Z-отчёт без указания кассы. Сначала проверьте его: повторное поступление заблокировано.'};
}
export function assertShiftCanPost(db, input, movements) {
  const prior = cashRevenueStatus(db,input);
  if (prior) throw new InputError(prior.reason);
  const cash = new Map(db.prepare('SELECT * FROM workspace_cash ORDER BY version').all().map(c => [c.id,c]));
  if (movements.some(m => m.data.type === 'cash_handover' && !m.reversedBy && cash.has(m.data.cashId) && cashShiftKey(JSON.parse(cash.get(m.data.cashId).input)) === cashShiftKey(input)))
    throw new InputError('Деньги этой смены уже учтены по кассовому листу. Перед Z-отчётом владелец должен проверить и скорректировать прежнюю проводку.');
}
export function cashHandoverConflict(db,input,movements,exceptId){
 const cash=new Map(db.prepare('SELECT * FROM workspace_cash ORDER BY version').all().map(c=>[c.id,c]));
 return movements.find(m=>m.data.type==='cash_handover'&&!m.reversedBy&&m.data.cashId!==exceptId&&cash.has(m.data.cashId)&&cashShiftKey(JSON.parse(cash.get(m.data.cashId).input))===cashShiftKey(input));
}
export function annotateCashPosting(db, state) {
  const shifts=latestUnifiedShifts(db),cash=new Map(db.prepare('SELECT * FROM workspace_cash ORDER BY version').all().map(c=>[c.id,c])),posted=new Map();
  state.cashConflicts=[];
  for(const m of state.movements.filter(m=>m.data.type==='cash_handover'&&!m.reversedBy&&cash.has(m.data.cashId))){
    const input=JSON.parse(cash.get(m.data.cashId).input),key=cashShiftKey(input),prior=posted.get(key),posting=cashRevenueStatus(db,input,shifts);
    if(posting||prior)state.cashConflicts.push({cashId:m.data.cashId,movementId:m.id,date:input.date,register:input.register,shiftNo:input.shiftNo,...(posting||{status:'cash_sheet',otherCashId:prior})});
    posted.set(key,m.data.cashId);
  }
  state.cashToPost=state.cashToPost.map(c=>{const prior=posted.get(cashShiftKey(c));return {...c,posting:cashRevenueStatus(db,c,shifts)||(prior&&prior!==c.id?{status:'cash_sheet',cashId:prior,reason:'Деньги этой смены уже учтены по другому кассовому листу. Проверьте исторические записи.'}:null)};});
  return state;
}
