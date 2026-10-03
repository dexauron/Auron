// Шифрование входа зала: верный код открывает, неверный — нет, денег внутри нет.
const { chromium, newPage, runner } = require('./helpers');
const SENT = ['777.77', '4242424242', 'ТАЙНЫЙ_ПОСТАВЩИК'];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ШИФР ВХОДА ЗАЛА');
  const { page } = await newPage(b, {});

  const out = await page.evaluate(async (sent) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = [{
      id: 'p1', name: 'Молоко 1л', code: '100500', article: 'A-1', department: 'Молочка',
      group_id: 'g1', unit: 'шт', retail_price: 89, photos: [], barcodes: ['4600000000011'],
      cost: sent[0], supplier_ids: [sent[2]], stock: 7,
    }];
    s.groups = [{ id: 'g1', name: 'Молочные', sort_order: 1 }];
    const data = P.buildFloorData(s.products, s.groups);
    const blob = await P.encryptFloor(data, 'okno-kover-slon-42');
    const okData = await P.decryptFloor(blob, 'okno-kover-slon-42');
    let wrongThrew = false;
    try { await P.decryptFloor(blob, 'ne-tot-kod'); } catch (e) { wrongThrew = true; }
    return {
      blob, okData, wrongThrew,
      okJson: JSON.stringify(okData),
      blobHasMoney: sent.some((v) => blob.includes(v)),
      okKeys: Object.keys(okData.products[0]),
    };
  }, SENT);

  chk(out.okData && out.okData.products && out.okData.products.length === 1, 'верный код открывает данные зала');
  chk(out.okData.products[0].code === '100500' && out.okData.products[0].department === 'Молочка',
    'после расшифровки на месте код и отдел');
  chk(out.wrongThrew === true, 'неверный код НЕ открывает (ошибка расшифровки)');
  chk(out.blobHasMoney === false, 'в зашифрованном файле нет денежных меток');
  chk(!SENT.some((v) => out.okJson.includes(v)), 'в расшифрованных данных зала денег нет');
  chk(!out.okKeys.includes('cost') && !out.okKeys.includes('supplier_ids') && !out.okKeys.includes('stock'),
    'в данных зала нет закупки/поставщиков/остатка числом');

  await done(b);
})();
