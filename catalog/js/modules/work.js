// Экран «Работа»: всё, что сотрудник зала делает руками, — в одном месте

/* Заказы, список «закончилось» и сравнение жили в меню под кнопкой с
 * человечком — то есть там, где их ищут в последнюю очередь. Человек в зале
 * работает большим пальцем одной руки, поэтому вход в эти дела вынесен в
 * нижнюю панель, а на самом экране сразу видно состояние дел: сколько поставок
 * на неделе, что просрочено, сколько позиций ждёт заказа. */

import { $, state, ui } from './store.js';
import { openSheet } from './core.js';
import { fmtPrice, todayISO } from './catalog.js';
import { plural } from './competitors.js';
import { ordersDue, ordersSummary } from './orders.js';
import { restockCount } from './restock.js';
import { compareCount } from './compare.js';
import { feature } from './brand.js';

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
  const stale = ui.staleCount ? ui.staleCount() : 0;
  const margin = ui.marginCount ? ui.marginCount() : 0;

  /* Всё рабочее собрано здесь (решение владельца 29.08). Раньше заказы и
     «закончилось» открывались ИЗ ДВУХ мест — отсюда и из меню, — а «залежалось»
     и наценка только из меню, хотя это тоже работа. Правило теперь читается:
     дела — во вкладке, настройки — в меню. */
  box.innerHTML = `
    <div class="ios-group-title">Дела смены</div>
    <div class="ios-group">
      ${row('orders', 'Заказы поставщикам', orders)}
      ${o.overdue ? row('orders', 'Просрочено', o.overdue, true) : ''}
      ${row('restock', 'Закончилось на полке', rest ? `${rest} ${plural(rest, 'ждёт', 'ждут', 'ждут')} заказа` : 'пусто')}
      ${row('stale', 'Залежалось', stale ? `${stale} ${plural(stale, 'товар', 'товара', 'товаров')}` : 'пусто')}
    </div>

    <div class="ios-group-title">Цены</div>
    <div class="ios-group">
      ${state.canPurchase ? row('margin', 'Наценка и убыточные товары', margin ? `${margin} требуют внимания` : 'всё в порядке', margin > 0) : ''}
      ${state.canSales && feature('sales') ? row('top', 'Ходовые товары', '') : ''}
      ${feature('competitors') ? row('comp', 'Цены других магазинов', '') : ''}
    </div>

    <div class="ios-group-title">Инструменты</div>
    <div class="ios-group">
      ${state.canPurchase ? row('compare', 'Сравнение товаров', cmp ? `отобрано ${cmp}` : 'пусто') : ''}
      ${row('scan', 'Сканировать штрихкод', '')}
    </div>
    <p class="ios-note">«Просрочено» — поставки, у которых день прихода прошёл, а «пришёл» никто
    не отметил. Записи хранятся на этом телефоне и уходят владельцу кнопкой «Передать».</p>`;
}

/* Плашка вверху главного экрана: что ждёт сегодня. Сотрудник заходит в каталог
 * десятки раз за смену — и первым делом должен видеть, что сегодня приезжает
 * поставка и что с прошлой недели висит непринятый заказ. */
function renderTodayBanner() {
  const el = $('todayBanner');
  if (!el) return;
  if (!state.session) { el.hidden = true; return; }
  const t = ordersDue(todayISO());
  const late = ordersSummary().overdue;
  if (!t.count && !late) { el.hidden = true; return; }
  const parts = [];
  if (t.count) parts.push(`Сегодня ${t.count} ${plural(t.count, 'поставка', 'поставки', 'поставок')} · ${fmtPrice(t.sum)}`);
  if (late) parts.push(`<span class="ord-late">просрочено ${late}</span>`);
  el.innerHTML = `${parts.join(' · ')} <span class="banner-go">Открыть ›</span>`;
  el.hidden = false;
}

/* Значок на вкладке: сколько дел ждёт — просроченные поставки и позиции,
 * которые закончились. Ноль значка не рисует: пустой кружок только мешает. */
export function renderWorkBadge() {
  renderTodayBanner();
  const n = state.session ? ordersSummary().overdue + restockCount() : 0;
  const el = $('tabWorkCount');
  if (el) {
    el.textContent = n > 99 ? '99+' : n;
    el.hidden = !n;
  }
  // та же цифра на строке «Работа» в меню — вход туда есть и оттуда
  const m = $('menuWorkCount');
  if (m) m.textContent = n ? String(n) : '';
}

export function runWorkAction(what) {
  if (what === 'login') { ui.openAdminOrLogin(); return; }
  if (ui.workActions && ui.workActions[what]) ui.workActions[what]();
}
