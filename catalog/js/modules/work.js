// Экран «Работа»: всё, что сотрудник зала делает руками, — в одном месте

/* Заказы, список «закончилось» и сравнение жили в меню под кнопкой с
 * человечком — то есть там, где их ищут в последнюю очередь. Человек в зале
 * работает большим пальцем одной руки, поэтому вход в эти дела вынесен в
 * нижнюю панель, а на самом экране сразу видно состояние дел: сколько поставок
 * на неделе, что просрочено, сколько позиций ждёт заказа. */

import { $, state, ui } from './store.js';
import { openSheet } from './core.js';
import { fmtPrice } from './catalog.js';
import { plural } from './competitors.js';
import { ordersSummary } from './orders.js';
import { restockCount } from './restock.js';
import { compareCount } from './compare.js';

export function openWork() {
  renderWork();
  openSheet('workSheet');
}

function row(what, title, value, danger) {
  return `<button class="ios-row ios-row-link" data-work="${what}">
    <span class="ios-row-title">${title}</span>
    <span class="ios-row-value${danger ? ' ord-late' : ''}">${value}</span>
  </button>`;
}

function renderWork() {
  const box = $('workBody');
  if (!box) return;
  if (!state.session) {
    box.innerHTML = `<p class="ios-note">Заказы поставщикам и список «закончилось на полке» —
      для сотрудников магазина. Введи пароль, и они появятся здесь.</p>
      <div class="ios-group">${row('login', 'Войти', '')}</div>`;
    return;
  }
  const o = ordersSummary();
  const orders = o.week
    ? `${o.week} ${plural(o.week, 'поставка', 'поставки', 'поставок')} · ${fmtPrice(o.sum)}`
    : 'на этой неделе пусто';
  const rest = restockCount();
  const cmp = compareCount();

  box.innerHTML = `
    <div class="ios-group">
      ${row('orders', 'Заказы поставщикам', orders)}
      ${o.overdue ? row('orders', 'Просрочено', o.overdue, true) : ''}
      ${row('restock', 'Закончилось на полке', rest ? `${rest} ${plural(rest, 'ждёт', 'ждут', 'ждут')} заказа` : 'пусто')}
      ${state.canPurchase ? row('compare', 'Сравнение товаров', cmp ? `отобрано ${cmp}` : 'пусто') : ''}
      ${row('scan', 'Сканировать штрихкод', '')}
    </div>
    <p class="ios-note">«Просрочено» — поставки, у которых день прихода прошёл, а «пришёл» никто
    не отметил. Записи хранятся на этом телефоне и уходят владельцу кнопкой «Передать».</p>`;
}

/* Значок на вкладке: сколько дел ждёт — просроченные поставки и позиции,
 * которые закончились. Ноль значка не рисует: пустой кружок только мешает. */
export function renderWorkBadge() {
  const el = $('tabWorkCount');
  if (!el) return;
  const n = state.session ? ordersSummary().overdue + restockCount() : 0;
  el.textContent = n > 99 ? '99+' : n;
  el.hidden = !n;
}

export function runWorkAction(what) {
  if (what === 'login') { ui.openAdminOrLogin(); return; }
  if (ui.workActions && ui.workActions[what]) ui.workActions[what]();
}
