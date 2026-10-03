// «Закончилось на полке»: сотрудник отмечает пустую полку, список сам
// раскладывается по поставщикам, и из него оформляется заказ.
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко 3.2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'], supplier_ids: ['s1'] },
  { id: 'p2', name: 'Кефир 1%', code: '102', group_id: 'g1', retail_price: 75, unit: 'шт', photos: [], barcodes: ['4600000000028'], supplier_ids: ['s1'] },
  { id: 'p3', name: 'Батон нарезной', code: '201', group_id: 'g2', retail_price: 45, unit: 'шт', photos: [], barcodes: ['4600000000035'], supplier_ids: ['s2'] },
];
const groups = [{ id: 'g1', name: 'Молочные' }, { id: 'g2', name: 'Хлеб' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }, { id: 's2', name: 'Хлебозавод' }];

const openList = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  document.getElementById('adminBtn').click();
  await new Promise((r) => setTimeout(r, 250));
  const badge = document.getElementById('menuRestockCount').textContent;
  document.getElementById('menuRestock').click();
  await new Promise((r) => setTimeout(r, 350));
  return badge;
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЗАКОНЧИЛОСЬ НА ПОЛКЕ');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, { suppliers });
  await page.waitForTimeout(300);

  // 1. Кнопка в карточке товара
  await openProduct(page, 'p1');
  const first = await page.evaluate(async () => {
    const btn = document.getElementById('btnRestock');
    const before = btn.textContent.trim();
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    return {
      before, after: btn.textContent.trim(),
      saved: JSON.parse(localStorage.getItem('wm_restock_v1') || '[]'),
    };
  });
  chk(/Закончилось/.test(first.before), `в карточке есть кнопка «Закончилось на полке» (${first.before})`);
  chk(first.saved.length === 1 && first.saved[0].id === 'p1', `отметка сохраняется на телефоне (${first.saved.length})`);
  chk(first.saved[0].supplier_id === 's1' && first.saved[0].name === 'Молоко 3.2%',
    'в строке запомнены название и поставщик — список не рассыплется, если товар удалят');
  chk(/Убрать/.test(first.after), `повторное нажатие снимет отметку (${first.after})`);

  // повторный вход в карточку показывает уже отмеченное состояние
  await openProduct(page, 'p2');
  await openProduct(page, 'p1');
  const label = await page.evaluate(() => document.getElementById('btnRestock').textContent.trim());
  chk(/Убрать/.test(label), `открыл товар заново — видно, что он уже в списке (${label})`);

  // 2. Сканер «Закончилось»: обход зала с камерой
  const scanned = await page.evaluate(async () => {
    window.WM_PUBLISH._scanRestock('4600000000035');   // Батон
    window.WM_PUBLISH._scanRestock('4600000000035');   // тот же код второй раз
    window.WM_PUBLISH._scanRestock('4600000000028');   // Кефир
    window.WM_PUBLISH._scanRestock('0000000000000');   // чужой штрихкод
    return {
      list: JSON.parse(localStorage.getItem('wm_restock_v1') || '[]').map((x) => x.id),
      panel: document.getElementById('scanResult').innerText.replace(/\s+/g, ' '),
    };
  });
  chk(scanned.list.join(',') === 'p1,p3,p2', `сканирование добавляет товар в список (${scanned.list.join(',')})`);
  chk(scanned.list.filter((x) => x === 'p3').length === 1, 'один и тот же штрихкод дважды не попадает');
  chk(/Нет в каталоге/.test(scanned.panel), `неизвестный штрихкод так и говорит (${scanned.panel.slice(0, 40)})`);

  // 3. Экран списка: счётчик, разбивка по поставщикам
  const badge = await openList(page);
  const view = await page.evaluate(() => {
    const box = document.getElementById('restockBody');
    return {
      open: !document.getElementById('restockSheet').hidden,
      heads: [...box.querySelectorAll('.rst-head')].map((h) => h.innerText.replace(/\s+/g, ' ').trim()),
      rows: box.querySelectorAll('[data-rst-rm]').length,
      total: box.querySelector('.ord-total').innerText.replace(/\s+/g, ' '),
    };
  });
  chk(badge === '3', `в меню видно, сколько позиций ждёт заказа (${badge})`);
  chk(view.open && view.rows === 3, `список открылся со всеми позициями (${view.rows})`);
  // заголовки групп рисуются заглавными (text-transform), поэтому сверяем без учёта регистра
  chk(view.heads.length === 2 && view.heads.some((h) => /молзавод · 2/i.test(h)) && view.heads.some((h) => /хлебозавод · 1/i.test(h)),
    `позиции разложены по поставщикам (${view.heads.join(' | ')})`);
  chk(/3 позиции ждут заказа/.test(view.total), `итог считается по-русски (${view.total})`);

  // 4. Заказ прямо из списка: поставщик и примечание подставлены
  const form = await page.evaluate(async () => {
    document.querySelector('[data-rst-order="s1"]').click();
    await new Promise((r) => setTimeout(r, 350));
    return {
      open: !document.getElementById('orderFormSheet').hidden,
      supplier: document.getElementById('ordSupplier').value,
      items: [...document.querySelectorAll('#ordItems .ios-row')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
    };
  });
  chk(form.open && form.supplier === 's1', `из списка сразу оформляется заказ нужному поставщику (${form.supplier})`);
  chk(form.items.length === 2 && /Молоко/.test(form.items[0]) && /Кефир/.test(form.items[1]),
    `в заказ подставлено то, что закончилось (${form.items.join(' | ')})`);

  const afterSave = await page.evaluate(async () => {
    document.getElementById('ordAmount').value = '5000';
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 900));
    const list = JSON.parse(localStorage.getItem('wm_restock_v1') || '[]');
    return {
      orders: window.WM_PUBLISH._state().orders.length,
      ordered: list.filter((x) => x.ordered).map((x) => x.id),
      waiting: list.filter((x) => !x.ordered).length,
    };
  });
  chk(afterSave.orders === 1, `заказ сохранился (${afterSave.orders})`);
  chk(afterSave.ordered.join(',') === 'p1,p2' && afterSave.waiting === 1,
    `заказанные позиции помечены, чтобы их не заказали дважды (${afterSave.ordered.join(',')})`);

  const marks = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    const badge2 = document.getElementById('menuRestockCount').textContent;
    document.getElementById('menuRestock').click();
    await new Promise((r) => setTimeout(r, 350));
    const box = document.getElementById('restockBody');
    return {
      badge2,
      done: box.querySelectorAll('.rst-done').length,
      buttons: box.querySelectorAll('[data-rst-order]').length,
    };
  });
  chk(marks.done === 2, `в списке видно, что уже заказано (${marks.done})`);
  chk(marks.badge2 === '1', `счётчик считает только неготовое (${marks.badge2})`);
  chk(marks.buttons === 1, `у поставщика, где всё заказано, кнопки «Заказать» нет (${marks.buttons})`);

  // 5. Убрать позицию крестиком
  const removed = await page.evaluate(async () => {
    document.querySelector('[data-rst-rm="p3"]').click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      left: JSON.parse(localStorage.getItem('wm_restock_v1') || '[]').length,
      rows: document.querySelectorAll('#restockBody [data-rst-rm]').length,
    };
  });
  chk(removed.left === 2 && removed.rows === 2, `позицию можно убрать из списка (${removed.left})`);

  // 6. Заказанное старше двух недель уходит само — список не растёт вечно
  const tidied = await page.evaluate(async () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const list = JSON.parse(localStorage.getItem('wm_restock_v1') || '[]');
    list.forEach((x) => { x.ordered = old; });
    localStorage.setItem('wm_restock_v1', JSON.stringify(list));
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('menuRestock').click();
    await new Promise((r) => setTimeout(r, 350));
    return {
      left: JSON.parse(localStorage.getItem('wm_restock_v1') || '[]').length,
      text: document.getElementById('restockBody').innerText.replace(/\s+/g, ' '),
    };
  });
  chk(tidied.left === 0, `старое заказанное подчищается само (${tidied.left})`);
  chk(/Список пуст/.test(tidied.text), `пустой список объясняет, что делать (${tidied.text.slice(0, 50)})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
