// Когда GitHub отказал, владелец должен понять, что случилось и что делать.
// Раньше ему показывали кусок ответа сервера: «401 {"message":"Bad credentials"…}».
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [] }];
const groups = [{ id: 'g1', name: 'Молочные' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }];
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОНЯТНЫЕ ОТКАЗЫ ПУБЛИКАЦИИ');
  const { page, ctx, errs } = await newPage(b, { products, groups });
  // GitHub отвечает «ключ не годится» — как в жизни, когда ключ просрочен
  await ctx.route('https://api.github.com/**', (r) => r.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' }),
  }));
  await asOwner(page, { suppliers });
  await page.waitForTimeout(300);

  const res = await page.evaluate(async (due) => {
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    window.WM_PUBLISH._work('orders');
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('ordSupplier').value = 's1';
    document.getElementById('ordAmount').value = '6000';
    document.getElementById('ordDue').value = due;
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 1500));
    const banner = document.getElementById('publishBanner');
    return {
      saved: window.WM_PUBLISH._state().orders.length,
      shown: !banner.hidden,
      text: banner.textContent,
      journal: JSON.parse(localStorage.getItem('wm_errors_v1') || '[]').map((x) => x.msg || x.where || '').join(' | '),
    };
  }, local(new Date()));

  chk(res.saved === 1, `заказ сохранён, несмотря на отказ публикации (${res.saved})`);
  chk(res.shown, 'наверху появилась плашка о том, что опубликовать не вышло');
  chk(/ключ доступа/i.test(res.text) && /новый ключ/i.test(res.text),
    `сказано по-человечески, что делать (${res.text})`);
  chk(!/401|Bad credentials|documentation_url|\/repos\//.test(res.text),
    `никаких кодов и кусков ответа сервера в тексте (${res.text.slice(0, 60)}…)`);
  chk(/401|Bad credentials/.test(res.journal), 'подробности сохранены в журнале ошибок — для разбора');

  const go = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    document.getElementById('publishBanner').click();
    await new Promise((r) => setTimeout(r, 500));
    return !document.getElementById('publishSheet').hidden;
  });
  chk(go, 'нажатие на плашку открывает окно публикации, где вставляют ключ');

  // другие причины отказа тоже объясняются словами
  const reasons = await page.evaluate(() => {
    const P = window.WM_PUBLISH;
    return {
      notFound: P._ghReason(404, '{"message":"Not Found"}').msg,
      rate: P._ghReason(403, '{"message":"API rate limit exceeded"}').msg,
      down: P._ghReason(502, 'Bad gateway').msg,
      // 422 — «не принял запись». Владелец однажды увидел голое «код 422» и не
      // понял ничего. Причин две, и они совсем разные
      race: P._ghReason(422, '{"message":"Update is not a fast forward"}'),
      other: P._ghReason(422, '{"message":"Tree entry not found"}').msg,
      naked: P._ghReason(422, 'что-то непонятное').msg,
    };
  });
  chk(/не нашёл/i.test(reasons.notFound), `404 объясняется словами (${reasons.notFound})`);
  chk(/подождать/i.test(reasons.rate), `«слишком часто» объясняется словами (${reasons.rate})`);
  chk(/недоступен/i.test(reasons.down), `сбой на стороне GitHub объясняется словами (${reasons.down})`);
  chk(/менял кто-то ещё/.test(reasons.race.msg) && /ещё раз/.test(reasons.race.msg),
    `гонка объяснена и сказано, что делать (${reasons.race.msg})`);
  chk(reasons.race.code === 'wait', 'гонка помечена как «попробуй снова», а не как поломка ключа');
  chk(/Tree entry not found/.test(reasons.other),
    `непонятный отказ показывает слова самого GitHub (${reasons.other})`);
  chk(/без объяснения/.test(reasons.naked), `если GitHub промолчал — так и пишем (${reasons.naked})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
