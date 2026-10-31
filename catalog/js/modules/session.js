// Присмотр за входом и свежестью данных, пока каталог открыт.
/* Два наблюдателя, нужные именно потому, что каталог работает без сервера и
 * живёт на домашнем экране телефона неделями:
 *
 *   keepFresh   — человек вернулся в каталог после паузы или появилась связь:
 *                 тихо обновляем данные, иначе он неделю смотрит на цены
 *                 первого дня.
 *   watchAccess — запуск теперь начинается с копии на устройстве, без сети:
 *                 надо подтвердить, что пароль не сменили, и дочитать свежий
 *                 каталог. Связи нет — спокойно ждём и повторяем.
 *
 * Отдельным модулем, а не в app.js: тот и без них на пределе (проверка
 * `modules` держит планку 1200 строк), а эти двое — одна тема. */
import { state } from './store.js';
import { appBusy, toast } from './core.js';
import { renderAll } from './render.js';
import { importPending } from './imports.js';
import { refresh } from './showcase.js';
import { recheckAccess } from './publish.js';

/* Каталог стоит на домашнем экране и живёт неделями: если обновлять данные
 * только при холодном запуске, человек неделю смотрит на цены первого дня.
 * Поэтому тихо обновляемся, когда он вернулся в каталог после паузы и когда
 * появилась связь. Шумного ничего: ни крутилок, ни сообщений.
 *
 * Вошедшему перечитываем его зашифрованный каталог (куски с неизменившейся
 * подписью берутся из памяти телефона, качается только изменившееся),
 * покупателю — витрину. */
export function keepFresh() {
  const QUIET = 10 * 60 * 1000;      // чаще незачем: витрина обновляется раз в день
  let busy = false;
  const quiet = async () => {
    if (busy || document.hidden) return;
    if (Date.now() - (state.lastFetch || 0) < QUIET) return;
    // человек держит открытое окно, печатает или ждёт подтверждения разбора 1С —
    // обновимся в следующий раз, а не из-под его рук
    if (appBusy() || importPending()) return;
    busy = true;
    try {
      if (state.session) { if (await recheckAccess(true) === 'ok') state.lastFetch = Date.now(); }
      else { await refresh({ silent: true }); }
    } catch (e) { /* не вышло — попробуем в следующий раз */ }
    busy = false;
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) quiet(); });
  window.addEventListener('online', quiet);
}

/* Вошли из сохранённой копии (интернета не было) — не оставляем человека с
 * предупреждением на экране и не просим пароль заново. Сами ждём связи и
 * дочитываем каталог; а если за это время владелец сменил пароль, вход честно
 * снимается — иначе отзыв доступа ничего бы не значил.
 *
 * Проверяем по событию «появился интернет» и редкими попытками (полминуты,
 * потом всё реже, максимум шесть раз): телефон в подсобке может висеть на
 * мёртвом Wi-Fi, где событие не приходит вовсе. */
export function watchAccess({ now = false } = {}) {
  if (!state.session || !state.catalogNeedsRefresh) return;
  let tries = 0, timer = 0, busy = false;
  const stop = () => { clearTimeout(timer); window.removeEventListener('online', run); };
  const run = async () => {
    if (busy || !state.session) return;
    busy = true;
    let verdict = 'later';
    try { verdict = await recheckAccess(false, !appBusy() && !importPending()); } catch (e) { verdict = 'later'; }
    busy = false;
    if (verdict === 'revoked') {
      /* Закрытое уже убрано из памяти самой проверкой, поэтому страницу НЕ
         перезагружаем: выдёргивать её из-под человека незачем, достаточно
         перерисовать и подгрузить открытую витрину. */
      stop();
      state.sessionWarning = '';
      toast('Пароль каталога сменили — войди заново');
      renderAll();
      refresh({ silent: true }).catch(() => {});
      return;
    }
    if (verdict === 'ok' && !state.catalogNeedsRefresh) { stop(); state.sessionWarning = ''; renderAll(); return; }
    /* Человек сейчас работает руками — перечитывание отложено, и это не повод
       что-то ему сообщать: вернёмся через несколько секунд. */
    if (verdict === 'busy') { timer = setTimeout(run, 5000); return; }
    /* Связи нет. Теперь — и только теперь — говорим, что данные сохранённые:
       на обычном запуске такую надпись показывать незачем. */
    if (!state.sessionWarning) {
      state.sessionWarning = 'Показана сохранённая копия: интернет пока не отдал свежие данные. Вход сохранён — как только связь появится, каталог обновится сам.';
      renderAll();
    }
    if (++tries >= 6) { stop(); return; }
    timer = setTimeout(run, 30000 * tries);
  };
  window.addEventListener('online', run);
  timer = setTimeout(run, now ? 0 : 30000);
}
