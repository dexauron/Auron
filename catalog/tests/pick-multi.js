// Подбор: несколько категорий сразу, поиск по группам, избранное вместе с фильтром.
/* Это три возможности, которые пропали при объединении вкладок в «Подбор», и
 * владелец на них указал: «сделанные прошлые доработки и улучшения ты убрал».
 * Так и было:
 *   1) галочками можно было отметить НЕСКОЛЬКО категорий и групп — плитки
 *      умели только одну за раз;
 *   2) был отдельный экран «Все группы» с поиском — групп из 1С больше
 *      двухсот, перебрать их плитками нельзя;
 *   3) вкладка «Избранное» сбрасывала выбранную категорию, и посмотреть
 *      избранное внутри раздела было нельзя.
 * Набор держит все три на месте. */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко 3,2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [], stock: 5 },
  { id: 'p2', name: 'Кефир 1%', code: '102', group_id: 'g1', retail_price: 75, unit: 'шт', photos: [], barcodes: [], stock: 5 },
  { id: 'p3', name: 'Батон нарезной', code: '201', group_id: 'g2', retail_price: 45, unit: 'шт', photos: [], barcodes: [], stock: 5 },
  { id: 'p4', name: 'Сок апельсиновый', code: '301', group_id: 'g3', retail_price: 120, unit: 'шт', photos: [], barcodes: [], stock: 5 },
];
const groups = [
  { id: 'g1', name: 'Молочные продукты' },
  { id: 'g2', name: 'Хлебобулочные' },
  { id: 'g3', name: 'Соки и воды' },
];

const openPick = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  document.querySelector('.tabbar [data-tab="pick"]').click();
  await new Promise((r) => setTimeout(r, 400));
});

const find = (page, text) => page.evaluate(async (t) => {
  const f = document.getElementById('catFind');
  f.value = t;
  f.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  return [...document.querySelectorAll('#catScreen [data-grp]')]
    .map((x) => x.innerText.replace(/\s+/g, ' ').trim());
}, text);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОДБОР: НЕСКОЛЬКО СРАЗУ И ПОИСК ПО ГРУППАМ');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, {});
  await openPick(page);

  // ── 1. Поиск находит группу по названию, из любой категории ──
  const milk = await find(page, 'моло');
  chk(milk.length === 1 && /Молочные продукты/.test(milk[0]),
    `поиск находит группу по названию (${milk.join(' | ')})`);
  chk(/Молочное/.test(milk[0]), `рядом с группой видно, в какой она категории (${milk[0]})`);
  const soki = await find(page, 'сок');
  chk(soki.some((r) => /Соки/.test(r)), `поиск работает и по другим группам (${soki.join(' | ')})`);
  const none = await find(page, 'щщщ');
  chk(!none.length, 'ничего не нашлось — пустой список, а не весь каталог');

  // ── 2. Курсор в поле не теряется при наборе ──
  /* Поле поиска стоит отдельно от перерисовываемого списка нарочно: когда оно
     жило внутри, каждая набранная буква уносила курсор, и писать было нельзя. */
  const typed = await page.evaluate(async () => {
    const f = document.getElementById('catFind');
    f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true }));
    f.focus();
    for (const ch of 'хлеб') {
      f.value += ch;
      f.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
    }
    return { focus: document.activeElement.id, value: f.value };
  });
  chk(typed.focus === 'catFind' && typed.value === 'хлеб',
    `курсор остаётся в поле, пока человек печатает (${typed.focus}, «${typed.value}»)`);

  // ── 3. Несколько групп сразу — из разных категорий ──
  const two = await page.evaluate(async () => {
    const f = document.getElementById('catFind');
    const pickFirst = async (t) => {
      f.value = t; f.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 350));
      document.querySelector('#catScreen [data-grp]').click();
      await new Promise((r) => setTimeout(r, 400));
    };
    await pickFirst('моло');
    await pickFirst('хлеб');
    return {
      picked: window.WM_PUBLISH._state().selGroups,
      chips: document.getElementById('activeFilters').innerText.replace(/\s+/g, ' ').trim(),
      btn: document.getElementById('filterApply').textContent,
      marks: document.querySelectorAll('#catScreen .grp-on').length,
    };
  });
  chk(two.picked.length === 2 && two.picked.includes('g1') && two.picked.includes('g2'),
    `отмечены две группы сразу (${two.picked.join(', ')})`);
  chk(/Молочные продукты/.test(two.chips) && /Хлебобулочные/.test(two.chips),
    `обе видны плашками сверху и снимаются ✕ (${two.chips})`);
  chk(/Показать 3 товара/.test(two.btn), `кнопка внизу считает, сколько набралось (${two.btn})`);
  chk(two.marks === 1, `отмеченная группа помечена галочкой в списке (${two.marks})`);

  // ── 4. Повторный тап снимает отметку ──
  const off = await page.evaluate(async () => {
    const f = document.getElementById('catFind');
    f.value = 'хлеб'; f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('#catScreen [data-grp]').click();
    await new Promise((r) => setTimeout(r, 400));
    return window.WM_PUBLISH._state().selGroups;
  });
  chk(off.length === 1 && off[0] === 'g1', `повторный тап снимает группу (${off.join(', ') || 'пусто'})`);

  // ── 5. «Показать N товаров» уводит в каталог со всем отмеченным ──
  const shown = await page.evaluate(async () => {
    const f = document.getElementById('catFind');
    f.value = 'хлеб'; f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('#catScreen [data-grp]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('filterApply').click();
    await new Promise((r) => setTimeout(r, 450));
    return {
      tab: [...document.querySelectorAll('.tabbar .tab')].find((t) => t.classList.contains('active')).dataset.tab,
      names: [...document.querySelectorAll('#productGrid .card')].map((c) => c.innerText.split('\n')[0]),
    };
  });
  chk(shown.tab === 'catalog' && shown.names.length === 3,
    `показаны товары обеих групп, а не одной (${shown.names.join(', ')})`);
  chk(!shown.names.some((n) => /Сок/.test(n)), 'чужая группа не попала');

  // ── 6. Несколько категорий сразу ──
  const cats = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.selGroups = []; s.selCats = [];
    const f = document.getElementById('catFind');
    f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.tabbar [data-tab="pick"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const take = async (name) => {
      document.querySelector(`[data-cat-open="${name}"]`).click();
      await new Promise((r) => setTimeout(r, 350));
      document.querySelector('[data-cat-tile]').click();      // «Показать все» в категории
      await new Promise((r) => setTimeout(r, 350));
      document.querySelector('[data-cat-back]').click();
      await new Promise((r) => setTimeout(r, 350));
    };
    await take('Молочное');
    await take('Хлеб и выпечка');
    return {
      picked: s.selCats,
      on: document.querySelectorAll('#catScreen .cat-tile.cat-on').length,
      btn: document.getElementById('filterApply').textContent,
    };
  });
  chk(cats.picked.length === 2, `отмечены две категории сразу (${cats.picked.join(', ')})`);
  chk(cats.on === 2, `отмеченные плитки подсвечены (${cats.on})`);
  chk(/Показать 3 товара/.test(cats.btn), `кнопка считает по обеим категориям (${cats.btn})`);

  // ── 7. Избранное сочетается с выбранной группой ──
  const fav = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.selCats = []; s.selGroups = ['g1']; s.favOnly = false;
    localStorage.setItem('wm_favorites_v1', JSON.stringify(['p1', 'p3']));
    document.querySelector('.tabbar [data-tab="fav"]').click();
    await new Promise((r) => setTimeout(r, 450));
    return {
      groups: s.selGroups,
      names: [...document.querySelectorAll('#productGrid .card')].map((c) => c.innerText.split('\n')[0]),
    };
  });
  chk(fav.groups.join(',') === 'g1', 'переход в «Избранное» больше не сбрасывает выбранную группу');
  chk(fav.names.length === 1 && /Молоко/.test(fav.names[0]),
    `видно избранное внутри выбранной группы (${fav.names.join(', ') || 'пусто'})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
