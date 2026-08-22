// Вёрстка на узких телефонах. Ловит то, что видно только на маленьком экране:
// панель или кнопка вылезает за край, страница едет вбок. Горизонтальные ленты
// («Похожие товары», чипы) прокручиваются нарочно — их не считаем.
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const SHEETS = ['filterSheet', 'adminMenuSheet', 'deviceSheet', 'suppliersManageSheet', 'supplierEditSheet',
  'groupsSheet', 'orderRulesSheet', 'calcSheet', 'topSheet', 'publishSheet', 'formSheet', 'loginSheet',
  'ordersSheet', 'orderFormSheet', 'compareSheet', 'restockSheet', 'workSheet', 'scanSheet'];

const products = Array.from({ length: 6 }, (_, i) => ({
  id: 'p' + i, name: 'Очень длинное название товара для проверки переноса ' + i,
  code: '10' + i, group_id: 'g1', retail_price: 1234567, unit: 'шт', photos: [],
  barcodes: ['4600000000' + i], stock: 3, supplier_ids: ['s1'], created_at: '2026-08-01',
}));

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ВЁРСТКА НА УЗКОМ ЭКРАНЕ');
  for (const W of [320, 390]) {
    const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Молочные продукты и всё такое прочее' }] });
    await page.setViewportSize({ width: W, height: 800 });
    await asOwner(page, {
      suppliers: [{ id: 's1', name: 'Поставщик с очень длинным названием ООО' }],
      prices: [{ product_id: 'p1', supplier_id: 's1', price: 8, price_date: '2026-08-01', unit: 'шт' }],
    });
    await page.waitForTimeout(400);

    const bad = [];
    const scan = async (where) => {
      const out = await page.evaluate((w) => {
        const res = [];
        if (document.documentElement.scrollWidth > w + 1) res.push(`страница едет вбок (${document.documentElement.scrollWidth}px)`);
        const scroller = (el) => {
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            const ov = getComputedStyle(n).overflowX;
            if (ov === 'auto' || ov === 'scroll') return true;   // лента прокручивается нарочно
          }
          return false;
        };
        document.querySelectorAll('.sheet-backdrop:not([hidden]) *, .content > *, .header *, .tabbar *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || scroller(el)) return;
          if (r.right > w + 1.5 || r.left < -1.5) {
            const cls = (el.className || '').toString().split(' ')[0];
            res.push(`${el.tagName.toLowerCase()}.${cls} (${Math.round(r.left)}…${Math.round(r.right)})`);
          }
        });
        return [...new Set(res)].slice(0, 3);
      }, W);
      if (out.length) bad.push(`${where}: ${out.join('; ')}`);
    };

    await scan('главный экран');
    await openProduct(page, 'p1'); await page.waitForTimeout(350);
    await scan('карточка товара');
    await page.evaluate(() => document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; }));
    for (const id of SHEETS) {
      const ok = await page.evaluate((sid) => {
        const el = document.getElementById(sid);
        if (!el) return false;
        document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
        el.hidden = false;
        return true;
      }, id);
      if (!ok) { bad.push(`${id}: окна нет в разметке`); continue; }
      await page.waitForTimeout(100);
      await scan(id);
    }
    // Список сотрудника — с настоящим содержимым: пустое окно почти ничего не
    // проверяет, а вылезают за край как раз длинные названия.
    await page.evaluate(() => {
      const long = 'Молоко Простоквашино отборное пастеризованное 3.2% 930 мл';
      localStorage.setItem('wm_restock_v1', JSON.stringify([
        { id: 'p1', name: long, code: '101', supplier_id: 's1', supplier_name: 'Поставщик с очень длинным названием ООО', who: 'Смена 1', at: '2026-08-22' },
        { id: 'p2', name: long + ' второй', code: '102', supplier_id: '', supplier_name: '', who: '', at: '2026-08-22', ordered: '2026-08-22' },
      ]));
    });
    for (const [id, menu] of [['restockSheet', 'menuRestock']]) {
      await page.evaluate(async (m) => {
        document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
        document.getElementById('adminBtn').click();
        await new Promise((r) => setTimeout(r, 250));
        document.getElementById(m).click();
        await new Promise((r) => setTimeout(r, 350));
      }, menu);
      await scan(`${id} со списком`);
    }
    chk(!bad.length, `ширина ${W}px: ничего не вылезает за край${bad.length ? ' — ' + bad.join(' | ') : ''}`);

    // Размер под палец: система советует 44×44. Исключения осознанные —
    // переключатель iOS ровно 51×31 по стандарту, а галочка в списке живёт
    // внутри строки во всю ширину, и нажимается строка целиком.
    const small = await page.evaluate(() => {
      const skip = (el) => el.closest('.ios-switch') || el.classList.contains('check-cb') || el.closest('.tree-sub');
      const out = [];
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || skip(el)) return;
        if (r.height < 34 || r.width < 32) out.push(`${Math.round(r.width)}×${Math.round(r.height)} «${(el.innerText || el.id).replace(/\s+/g, ' ').slice(0, 20)}»`);
      });
      return [...new Set(out)].slice(0, 5);
    });
    chk(!small.length, `ширина ${W}px: кнопки не мельче пальца${small.length ? ' — ' + small.join(' | ') : ''}`);
    chk(!errs.length, `ширина ${W}px: нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
    await page.context().close();
  }
  await done(b);
})();
