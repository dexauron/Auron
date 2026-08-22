// Пересчёт остатков: что стоит на полке против того, что в базе.
// Сверка, а не подмена учёта — остатки каталога пересчёт не переписывает.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко 3.2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'], stock: 15 },
  { id: 'p2', name: 'Кефир 1%', code: '102', group_id: 'g1', retail_price: 75, unit: 'шт', photos: [], barcodes: ['4600000000028'], stock: 4 },
  { id: 'p3', name: 'Выпечка весовая', code: '303', group_id: 'g2', retail_price: 45, unit: 'кг', photos: [], barcodes: [] },
];
const groups = [{ id: 'g1', name: 'Молочные' }, { id: 'g2', name: 'Выпечка' }];

const openCount = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  document.getElementById('adminBtn').click();
  await new Promise((r) => setTimeout(r, 250));
  document.getElementById('menuCount').click();
  await new Promise((r) => setTimeout(r, 350));
});

const add = (page, code) => page.evaluate(async (c) => {
  document.getElementById('countCode').value = c;
  document.getElementById('countAdd').click();
  await new Promise((r) => setTimeout(r, 200));
}, code);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПЕРЕСЧЁТ ОСТАТКОВ');
  const { page, errs } = await newPage(b, { products, groups });
  page.on('dialog', (d) => d.accept());
  await asOwner(page, {});
  await page.waitForTimeout(300);

  await openCount(page);
  const empty = await page.evaluate(() => ({
    open: !document.getElementById('countSheet').hidden,
    text: document.getElementById('countBody').innerText.replace(/\s+/g, ' '),
  }));
  chk(empty.open, 'экран пересчёта открывается из меню');
  chk(/Нажми «Сканировать»/.test(empty.text), `пустой пересчёт объясняет, что делать (${empty.text.slice(0, 45)})`);

  // 1. Добавление по коду и по штрихкоду — для товара без штрихкода тоже
  await add(page, '101');
  await add(page, '4600000000028');
  await add(page, '303');
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('#countBody .cnt-row').length,
    saved: JSON.parse(localStorage.getItem('wm_count_v1') || '{}').items.map((x) => x.id),
    first: document.querySelector('#countBody .cnt-row').innerText.replace(/\s+/g, ' '),
  }));
  chk(after.rows === 3, `позиции добавляются по коду и по штрихкоду (${after.rows})`);
  chk(after.saved.join(',') === 'p3,p2,p1', `последнее посчитанное — сверху (${after.saved.join(',')})`);
  chk(/Выпечка/.test(after.first) && /в базе —/.test(after.first),
    `у товара без остатка так и написано (${after.first.slice(0, 50)})`);

  const miss = await page.evaluate(async () => {
    document.getElementById('countCode').value = '999999';
    document.getElementById('countAdd').click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      rows: document.querySelectorAll('#countBody .cnt-row').length,
      toast: document.getElementById('toast').textContent,
    };
  });
  chk(miss.rows === 3 && /не найден/i.test(miss.toast), `неизвестный код не ломает список (${miss.toast})`);

  // 2. Расхождение: посчитали 15 при остатке 15 — сходится; 2 при 4 — недостача
  const diff = await page.evaluate(async () => {
    const inp = document.querySelector('[data-cnt-qty="p1"]');
    inp.value = '15';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const inp2 = document.querySelector('[data-cnt-qty="p2"]');
    inp2.value = '2';
    inp2.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const rowText = (id) => document.querySelector(`[data-cnt-qty="${id}"]`).closest('.cnt-row').innerText.replace(/\s+/g, ' ');
    return { p1: rowText('p1'), p2: rowText('p2'), total: document.querySelector('#countBody .ord-total').innerText.replace(/\s+/g, ' ') };
  });
  chk(/сходится/.test(diff.p1), `совпало с базой — так и говорит (${diff.p1.slice(0, 55)})`);
  chk(/−2/.test(diff.p2), `недостача видна прямо в строке (${diff.p2.slice(0, 55)})`);
  chk(/расхождений 1/.test(diff.total), `наверху счётчик расхождений (${diff.total})`);

  // 3. Кнопки «−» и «+» — считать одной рукой
  const step = await page.evaluate(async () => {
    document.querySelector('[data-cnt-plus="p2"]').click();
    await new Promise((r) => setTimeout(r, 150));
    document.querySelector('[data-cnt-plus="p2"]').click();
    await new Promise((r) => setTimeout(r, 150));
    document.querySelector('[data-cnt-minus="p2"]').click();
    await new Promise((r) => setTimeout(r, 150));
    return {
      qty: document.querySelector('[data-cnt-qty="p2"]').value,
      row: document.querySelector('[data-cnt-qty="p2"]').closest('.cnt-row').innerText.replace(/\s+/g, ' '),
    };
  });
  chk(step.qty === '3', `«+» и «−» меняют количество (${step.qty})`);
  chk(/−1/.test(step.row), `разница пересчитывается сразу (${step.row.slice(0, 55)})`);

  // 4. Пересчёт не трогает остатки каталога — это сверка
  const stockKept = await page.evaluate(() => window.WM_PUBLISH._state().products.find((p) => p.id === 'p2').stock);
  chk(Number(stockKept) === 4, `остаток в каталоге не переписан (${stockKept})`);

  // 5. Убрать строку и очистить весь пересчёт
  const removed = await page.evaluate(async () => {
    document.querySelector('[data-cnt-rm="p3"]').click();
    await new Promise((r) => setTimeout(r, 200));
    return document.querySelectorAll('#countBody .cnt-row').length;
  });
  chk(removed === 2, `строку можно убрать (${removed})`);

  const cleared = await page.evaluate(async () => {
    document.getElementById('countClear').click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      items: JSON.parse(localStorage.getItem('wm_count_v1') || '{}').items.length,
      text: document.getElementById('countBody').innerText.replace(/\s+/g, ' '),
    };
  });
  chk(cleared.items === 0 && /Пересчёт пуст/.test(cleared.text), `пересчёт очищается целиком (${cleared.items})`);

  // 6. Посчитанное переживает закрытие приложения
  await add(page, '101');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
  await page.waitForTimeout(900);
  await asOwner(page, {});
  await openCount(page);
  const kept = await page.evaluate(() => document.querySelectorAll('#countBody .cnt-row').length);
  chk(kept === 1, `посчитанное не пропадает после перезапуска (${kept})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
