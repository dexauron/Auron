/* Список покупок: вес у весовых товаров, и он есть у сотрудника с владельцем.
 *
 * Просьба владельца: «весовые товары указывается вес, а не просто количество»
 * и «чтобы этот список покупок можно было сделать и сотруднику, и владельцу».
 * Было: шаг всегда по штуке, даже у сыра на развес, а у вошедшего список
 * пропадал вовсе — кнопка в карточке была помечена «только покупателю».
 */
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Сыр Российский 45% весовой', code: '103', group_id: 'g1', retail_price: 700, unit: 'кг', is_weighted: true, photos: [], barcodes: [] },
  { id: 'p2', name: 'Молоко 1л', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [] },
];
const groups = [{ id: 'g1', name: 'Разное' }];

const openShop = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
  document.getElementById('shopOpen').click();
  await new Promise((r) => setTimeout(r, 400));
  return document.getElementById('shopBody').innerText.replace(/\s+/g, ' ');
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('СПИСОК ПОКУПОК: ВЕС И ДОСТУП');
  const { page, errs } = await newPage(b, { products, groups });

  // ── 1. Покупатель кладёт весовой товар ──
  await openProduct(page, 'p1');
  const added = await page.evaluate(async () => {
    const btn = document.getElementById('btnShopAdd');
    const visible = !btn.hidden;
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return { visible, bar: !document.getElementById('shopBar').hidden };
  });
  chk(added.visible, 'кнопка «в список покупок» есть у покупателя');
  chk(added.bar, 'полоска списка появилась');

  let body = await openShop(page);
  chk(/кг/.test(body), `весовой товар считается в килограммах (${body.slice(0, 60)})`);
  chk(!/1 шт/.test(body), 'и не в штуках');

  const step = await page.evaluate(async () => {
    document.querySelector('[data-shop-plus]').click();
    await new Promise((r) => setTimeout(r, 200));
    return document.querySelector('.shop-qty').textContent.replace(/\s+/g, ' ').trim();
  });
  chk(step === '1,1 кг', `шаг у весового — сто граммов (${step})`);

  // ── 2. Штучный товар остаётся в штуках ──
  await page.evaluate(() => { document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; }); });
  await openProduct(page, 'p2');
  await page.evaluate(async () => {
    document.getElementById('btnShopAdd').click();
    await new Promise((r) => setTimeout(r, 300));
  });
  body = await openShop(page);
  chk(/1 шт/.test(body), `штучный товар считается в штуках (${(body.match(/Молоко[^·]{0,24}/) || [''])[0]})`);

  const piece = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('[data-shop-plus]')];
    btns[btns.length - 1].click();
    await new Promise((r) => setTimeout(r, 200));
    const q = [...document.querySelectorAll('.shop-qty')];
    return q[q.length - 1].textContent.replace(/\s+/g, ' ').trim();
  });
  chk(piece === '2 шт', `шаг у штучного — по штуке (${piece})`);

  // ── 3. В сообщении вес тоже вес ──
  /* Текст сообщения проверяем через кнопку «Отправить в WhatsApp»: она его и
     собирает. Перехватываем открытие ссылки, чтобы ничего не открылось. */
  const text = await page.evaluate(async () => {
    let url = '';
    window.open = (u) => { url = u; return { focus() {} }; };
    document.getElementById('shopWa').click();
    await new Promise((r) => setTimeout(r, 300));
    const m = /[?&]text=([^&]*)/.exec(url);
    return m ? decodeURIComponent(m[1]) : '';
  });
  chk(/1,1 кг/.test(text), `в сообщении весовой товар указан в килограммах (${(text.match(/Сыр[^\n]*/) || [''])[0]})`);
  chk(/2 шт/.test(text), 'а штучный — в штуках');

  // ── 4. Сотрудник и владелец: список никуда не делся ──
  await asOwner(page, {});
  await page.waitForTimeout(400);
  const owner = await page.evaluate(() => ({
    bar: !document.getElementById('shopBar').hidden,
    add: (document.getElementById('btnShopAdd') || {}).hidden,
  }));
  chk(owner.bar, 'у вошедшего полоска списка на месте — раньше она пропадала');
  /* Список покупок живёт на вкладке «Работа» — там же, где «закончилось на
     полке» и заказы. Из меню строку убрали: два входа в одно место лишние. */
  const menu = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const row = document.querySelector('[data-work="shop"]');
    return { exists: !!row, val: row ? row.innerText.replace(/\s+/g, ' ').trim() : '' };
  });
  chk(menu.exists, 'на вкладке «Работа» есть «Список покупок»');
  chk(/2 позиции/.test(menu.val), `и видно, сколько в нём (${menu.val})`);

  const ownerBody = await page.evaluate(async () => {
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('[data-work="shop"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById('shopBody').innerText.replace(/\s+/g, ' ');
  });
  chk(/Сыр/.test(ownerBody) && /Молоко/.test(ownerBody), 'список открывается и у владельца — тот же самый');
  chk(/код 103/.test(ownerBody), `сотруднику в списке виден код кассы (${(ownerBody.match(/код \d+/) || [''])[0]})`);

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
