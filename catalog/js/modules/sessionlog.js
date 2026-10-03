/* Журнал входов и выходов — по ролям
 *
 * Владелец: «каталог не запоминает, когда зашли и когда вышли».
 * Так и было: ни одна роль не оставляла следа. Теперь оставляет.
 *
 * Журнал МЕСТНЫЙ — он про ЭТО устройство. Сервера у каталога нет, собрать
 * записи со всех телефонов магазина в одном месте нечем, и обещать такое
 * нельзя: владелец решил бы, что видит всех, а видел бы только себя.
 * Поэтому и подпись на экране говорит честно — «на этом устройстве».
 */

const KEY = 'wm_session_log_v1';
const KEEP = 50;             // полсотни записей — это недели работы, больше незачем

const ROLE_NAME = {
  owner: 'Владелец',
  staff: 'Бухгалтер',
  zal: 'Сотрудник зала',
  guest: 'Покупатель',
};
export const roleName = (r) => ROLE_NAME[r] || 'Сотрудник';

export function sessionLog() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
}

/* Записываем вход или выход. Повтор того же события подряд не пишем:
 * приложение поднимает запомненный вход при каждом запуске, и журнал за день
 * превратился бы в сотню одинаковых строк «вошёл». */
export function logSession(event, role) {
  const list = sessionLog();
  const top = list[0];
  if (top && top.event === event && top.role === role
      && Date.now() - new Date(top.at).getTime() < 12 * 3600 * 1000) return;
  list.unshift({ at: new Date().toISOString(), event, role });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, KEEP))); } catch (e) { /* нет места */ }
}
