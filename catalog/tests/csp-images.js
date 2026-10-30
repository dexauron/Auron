// Ошибка фотографии обрабатывается при CSP без inline JavaScript.
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');
(async () => {
  const b = await chromium.launch(), { chk, done } = runner('ФОТО ПРИ CSP');
  const { page, ctx, errs } = await newPage(b, { products: [
    { id: 'p1', name: 'А сломанное фото', code: '1', photos: ['https://fixture.test/missing.jpg'], barcodes: [] },
    { id: 'p2', name: 'Б исправное фото', code: '2', photos: ['icons/logo-round.png'], barcodes: [] },
  ] });
  await ctx.route('https://fixture.test/**', (r) => r.fulfill({ status: 404, body: 'fixture missing image' }));
  await asOwner(page);
  await page.evaluate(() => { const P = window.WM_PUBLISH; P._state().view = 'normal'; P.renderAll(); });
  await page.waitForTimeout(600);
  const tile = await page.evaluate(() => {
    const box = document.querySelector('#productGrid [data-id="p1"] .card-photo');
    const good = document.querySelector('#productGrid [data-id="p2"] .card-photo img');
    return { fallback: box && box.classList.contains('no-photo') && !box.querySelector('img') && !!box.querySelector('svg'),
      good: !!good && good.complete && good.naturalWidth > 0, inline: document.querySelectorAll('img[onerror]').length };
  });
  chk(tile.fallback, 'битая фотография заменяется заглушкой в плитке');
  chk(tile.good, 'исправная фотография соседнего товара сохранена');
  chk(tile.inline === 0, 'в фотографиях нет inline-обработчиков');
  await openProduct(page, 'p1');
  await page.waitForTimeout(300);
  chk(await page.evaluate(() => !document.querySelector('#sheetPhotos img') && !!document.querySelector('#sheetPhotos svg')),
    'заглушка работает и в галерее карточки');
  chk(!errs.length, `нет сбоев JS (${errs.length})`);
  await done(b);
})().catch((e) => { console.error(e); process.exitCode = 1; });
