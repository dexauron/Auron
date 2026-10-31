// Загрузка витрины: каталог живёт файлами на сайте и копией в телефоне.
/* Отдельно от разбора 1С (imports.js) нарочно: это разные работы. Разбор —
 * про Excel владельца раз в день; здесь — про то, как каталог попадает в
 * телефон покупателя и сотрудника и как он открывается, когда интернета нет
 * или он очень плохой.
 *
 * Правила, которые тут важнее всего:
 *   • на экране всегда сначала то, что уже в телефоне, и только потом сеть;
 *   • куски витрины показываются по мере прихода, а не после последнего;
 *   • у каждого запроса крайний срок (netFetch): без него плохая связь
 *     выглядит не ошибкой, а вечным ожиданием. */

import { $, CFG, state } from './store.js';
import { netFetch } from './core.js';
import { renderAll } from './render.js';
import { byName, loadCache, saveCache, sortByName } from './data.js';
import { buildIndex } from './catalog.js';

// Публичная витрина: части p/*.json с подписями из index.json. Неизменённые
// части берутся из кэша; без описи поддерживается прежний products.json.
// Закрытые данные покупатель из этих файлов не получает.
async function fetchShowcase(base, onChunk) {
  const idx = await netFetch(base + 'index.json', { cache: 'no-cache' }).catch(() => null);
  if (idx && idx.ok) {
    const meta = await idx.json().catch(() => null);
    if (meta && meta.v === 2 && Array.isArray(meta.parts)) {
      state.showcaseApp = Number(meta.app) || 1;   // чем собрана витрина
      /* Когда владелец её опубликовал. Он выгружает из 1С и публикует раз в
         день, поэтому это и есть ответ на вопрос покупателя «а данные-то
         свежие?». Показываем честно: пусть человек сам решит, доверять ли
         наличию, которому сутки. */
      state.showcaseAt = String(meta.savedAt || '');
      const chunks = [];
      // Куски показываем ПО МЕРЕ ПРИХОДА: каталог на 17 тысяч товаров — это
      // несколько мегабайт, ждать их целиком перед первой картинкой нельзя.
      await Promise.all(meta.parts.map(async (h, i) => {
        const r = await netFetch(`${base}p/${String(i).padStart(2, '0')}.json?h=${h}`).catch(() => null);
        chunks[i] = (r && r.ok) ? await r.json().catch(() => []) : [];
        if (onChunk) onChunk(chunks[i]);
      }));
      return [].concat(...chunks);
    }
  }
  const pr = await netFetch(base + 'products.json', { cache: 'no-cache' });
  return pr.json();
}

/* Показ по мере загрузки. Полная пересборка поискового индекса на 17 тысячах
 * товаров стоит заметного времени, поэтому делаем её не чаще раза в полсекунды,
 * а в конце — обязательно. Так первые товары видны почти сразу, а телефон не
 * захлёбывается перерисовками. */
function progressiveShow() {
  let last = 0;
  const acc = [];
  return {
    add(list) {
      if (!list || !list.length) return;
      acc.push(...list);
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      state.products = acc.slice().sort(byName);
      buildIndex();
      $('loader').hidden = true;
      renderAll();
    },
  };
}

async function refreshStatic({ progressive = false } = {}) {
  try {
    const base = CFG.STATIC_URL.endsWith('/') ? CFG.STATIC_URL : CFG.STATIC_URL + '/';
    const show = progressive ? progressiveShow() : null;
    // Цены чужих магазинов больше не качаем: покупателю они не показываются,
    // а вошедший сотрудник берёт их из своего зашифрованного каталога.
    const [products, gr, pop] = await Promise.all([
      fetchShowcase(base, show ? (list) => show.add(list) : null),
      netFetch(base + 'groups.json', { cache: 'no-cache' }).catch(() => null),
      netFetch(base + 'popular.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    if (!Array.isArray(products)) return false;
    state.groups = (gr && gr.ok) ? await gr.json() : [];
    try { state.popularIds = (pop && pop.ok) ? await pop.json() : []; } catch (e) { state.popularIds = []; }
    state.competitors = []; state.compPrices = []; // разведка цен — только для вошедших
    state.suppliers = []; // покупателю поставщики не нужны (и в файле их нет)
    state.products = sortByName(products);
    buildIndex();
    state.syncMax = '';
    state.lastFetch = Date.now();
    saveCache();
    $('offlineBanner').hidden = true;
    $('loader').hidden = true;
    renderAll();
    return true;
  } catch (e) {
    return false; // любой сбой — откат на загрузку с сервера
  }
}

export async function refresh({ silent = false } = {}) {
  // серверлес: данные уже в памяти (расшифрованный каталог), сервера нет
  if (state.serverless) { renderAll(); return; }
  // Покупатель без входа и включённый STATIC_URL → читаем витрину из файла.
  // Не удалось (файла ещё нет / ошибка) — падаем на обычную загрузку с сервера.
  // Сотрудник после входа всегда грузится с сервера (полные данные).
  if (CFG.STATIC_URL && !state.session) {
    // Сохранённая копия с телефона уже показана при запуске (init). Если её
    // нет — это первый заход, и тогда показываем товары ПО МЕРЕ ЗАГРУЗКИ, не
    // дожидаясь последнего куска: иначе человек смотрит на пустой экран,
    // пока качаются мегабайты.
    const cached = state.products.length > 0;
    if (await refreshStatic({ progressive: !cached })) return;
    if (cached) {                       // сеть не ответила, но каталог показан
      const b = $('offlineBanner');
      b.textContent = 'Нет связи. Показан сохранённый каталог';
      b.hidden = false;
      return;
    }
  }
  // Магазин без базы (бесплатный режим): к серверу идти не к кому. Витрина не
  // загрузилась — значит нет интернета: показываем сохранённое и говорим об этом.
  $('loader').hidden = true;
  const banner = $('offlineBanner');
  banner.textContent = (await loadCache())
    ? 'Нет связи. Показан сохранённый каталог'
    : 'Нет интернета. Подключись к сети и обнови страницу';
  banner.hidden = false;
  renderAll();
}
