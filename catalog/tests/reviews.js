// Отзывы соседей: единственное, чего не было у нас и было у сетей.
/* Сервера нет, поэтому путь такой: покупатель ставит оценку → готовое
 * сообщение уходит владельцу в WhatsApp → владелец добавляет отзыв в каталог,
 * и его видят все. Ничего не публикуется само — это главное свойство, и оно
 * здесь проверяется: покупатель НЕ может ничего опубликовать сам. */
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2%', code: '101', retail_price: 89, group_id: 'g1',
    photos: [], barcodes: ['4600000000011'], supplier_ids: [], stock_state: 'in',
    reviews: [
      { n: 'Хеда', r: 5, t: 'Свежее, беру постоянно', d: '2026-08-20' },
      { n: 'Ислам', r: 4, t: 'Нормальное', d: '2026-08-25' },
    ] },
  { id: 'p2', name: 'Хлеб Столовый', code: '102', retail_price: 45, group_id: 'g1',
    photos: [], barcodes: [], supplier_ids: [], stock_state: 'in' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ОТЗЫВЫ');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Молочное' }] });

  // ── 1. Оценка считается ──
  const r = await page.evaluate(() => {
    const P = window.WM_PUBLISH, s = P._state();
    const p1 = s.products.find((x) => x.id === 'p1');
    const p2 = s.products.find((x) => x.id === 'p2');
    return { one: P._ratingOf(p1), text: P._ratingText(p1), none: P._ratingOf(p2), noneText: P._ratingText(p2) };
  });
  chk(r.one && r.one.avg === 4.5 && r.one.n === 2, `средняя оценка посчитана (${r.one && r.one.avg} из ${r.one && r.one.n})`);
  chk(/4,5/.test(r.text) && /2 отзыва/.test(r.text), `подпись по-русски (${r.text})`);
  chk(!r.none && !r.noneText, 'у товара без отзывов ничего не пишем — пустая строка хуже её отсутствия');

  // ── 2. Покупатель видит отзывы в карточке ──
  await openProduct(page, 'p1');
  const card = await page.evaluate(() => ({
    badges: document.getElementById('sheetBadges').innerText.replace(/\s+/g, ' '),
    revs: document.getElementById('sheetReviews').innerText.replace(/\s+/g, ' '),
    rate: !document.getElementById('btnRate').hidden,
  }));
  chk(/4,5 · 2 отзыва/.test(card.badges), `оценка видна сразу в карточке (${card.badges.slice(0, 50)})`);
  chk(/Хеда/.test(card.revs) && /Свежее, беру постоянно/.test(card.revs),
    `отзыв соседа виден с именем (${card.revs.slice(0, 60)})`);
  chk(/Ислам/.test(card.revs), 'второй отзыв тоже на месте');
  chk(card.rate, 'покупателю предлагают оценить товар');

  // ── 3. Покупатель ничего не публикует сам ──
  const before = await page.evaluate(() => {
    const s = window.WM_PUBLISH._state();
    return s.products.find((x) => x.id === 'p2').reviews;
  });
  const sent = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    let opened = '';
    const real = window.open;
    window.open = (u) => { opened = u; return { closed: false }; };   // настоящий браузер возвращает окно; вернём null — приложение решит, что всплывающие запрещены, и уйдёт по адресу само
    P._openRate(P._state().products.find((x) => x.id === 'p2'));
    await new Promise((r2) => setTimeout(r2, 200));
    document.querySelector('#rateStars [data-star="5"]').click();
    document.getElementById('rateName').value = 'Марьям';
    document.getElementById('rateText').value = 'Всегда свежий';
    document.getElementById('rateSend').click();
    await new Promise((r2) => setTimeout(r2, 200));
    window.open = real;
    const s = P._state();
    return { opened, after: s.products.find((x) => x.id === 'p2').reviews };
  });
  chk(/wa\.me\//.test(sent.opened), 'отзыв уходит владельцу в WhatsApp');
  chk(/%D0%9C%D0%B0%D1%80%D1%8C%D1%8F%D0%BC|Марьям/.test(decodeURIComponent(sent.opened)),
    'в сообщении есть имя');
  chk(/код 102/.test(decodeURIComponent(sent.opened)), 'в сообщении есть код товара — владельцу не надо его искать');
  chk(/5 из 5/.test(decodeURIComponent(sent.opened)), 'в сообщении есть оценка');
  chk(!before && !sent.after, 'покупатель НИЧЕГО не опубликовал сам — отзыв в каталог не попал');

  // ── 4. Владелец добавляет отзыв ──
  await asOwner(page);
  const added = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.getElementById('revCode').value = '102';
    document.getElementById('revName').value = 'Марьям';
    document.getElementById('revStars').value = '5';
    document.getElementById('revText').value = 'Всегда свежий';
    document.getElementById('revAdd').click();
    await new Promise((r2) => setTimeout(r2, 300));
    const p = window.WM_PUBLISH._state().products.find((x) => x.id === 'p2');
    return { revs: p.reviews, body: document.getElementById('reviewsBody').innerText.replace(/\s+/g, ' ') };
  });
  chk(added.revs && added.revs.length === 1 && added.revs[0].n === 'Марьям',
    `владелец добавил отзыв (${added.revs && added.revs.length})`);
  chk(/Хлеб Столовый/.test(added.body) && /Марьям/.test(added.body),
    `отзыв виден в списке владельца (${added.body.slice(0, 60)})`);

  // ── 5. Ошибку в коде товара объясняем словами ──
  const bad = await page.evaluate(async () => {
    document.getElementById('revCode').value = '99999';
    document.getElementById('revAdd').click();
    await new Promise((r2) => setTimeout(r2, 200));
    const e = document.getElementById('revError');
    return { hidden: e.hidden, text: e.textContent };
  });
  chk(!bad.hidden && /не найден/.test(bad.text), `неверный код объяснён по-человечески (${bad.text.slice(0, 40)})`);

  // ── 6. В витрину уезжают отзывы, но обрезанные ──
  const pub = await page.evaluate(() => {
    const P = window.WM_PUBLISH, s = P._state();
    const p = s.products.find((x) => x.id === 'p1');
    p.reviews = Array.from({ length: 9 }, (_, i) => ({ n: 'Сосед ' + i, r: 5, t: 'x'.repeat(400), d: '2026-08-2' + (i % 10) }));
    const out = P.buildPublicProducts().find((x) => x.id === 'p1');
    return { n: (out.reviews || []).length, len: (out.reviews || [])[0].t.length, v: P._showcaseV };
  });
  chk(pub.n === 5, `в витрину уезжают последние пять отзывов (${pub.n})`);
  chk(pub.len === 200, `длинный отзыв обрезан (${pub.len} символов)`);
  chk(pub.v === 4, `версия витрины поднята — старая публикация попросит обновиться (${pub.v})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
