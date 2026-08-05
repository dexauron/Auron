// Прокликать ВСЕ кнопки приложения и записать, что сломалось.
//
//   node .claude/skills/look/scripts/gas.js webapp/Index.html /tmp/click.html
//   node .claude/skills/look/scripts/clickall.js /tmp/click.html
//
// Зачем: проверка «функция существует» ничего не говорит о том, что будет
// при нажатии. Здесь кнопки действительно нажимаются, а всё, что упало,
// попадает в список. Сервер — заглушка, поэтому проверяется поведение
// экрана, а не расчёты.
const path = require('path');
const fs   = require('fs');
const http = require('http');

const target = process.argv[2] || '/tmp/click.html';
const ROOT = path.dirname(path.resolve(target));
const FILE = path.basename(target);

const TYPES = {'.html':'text/html;charset=utf-8', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml'};
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || FILE;
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

function chrome() {
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).filter(d => /^chromium-/.test(d))) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

srv.listen(0, async () => {
  const port = srv.address().port;
  const { chromium } = require('playwright-core');
  const b = await chromium.launch({ executablePath: chrome(), args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

  const errs = [];
  p.on('pageerror', e => errs.push({ where: '(страница)', msg: e.message.split('\n')[0] }));
  // confirm/alert в автопрогоне повесили бы страницу
  p.on('dialog', d => d.dismiss().catch(() => {}));

  await p.goto(`http://localhost:${port}/${FILE}`, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(1000);

  // Все элементы с onclick — именно то, что владелец видит как «кнопку».
  // Кнопки «выйти» и «обновить» уводят со страницы, и всё, что нажимается
  // после них, проверяется уже вхолостую. На время прогона запрещаем уход.
  await p.evaluate(() => {
    try { window.open = function(){ return null; }; } catch(e){}
    try { history.pushState = function(){}; history.replaceState = function(){}; } catch(e){}
    try { Object.defineProperty(window, 'onbeforeunload', { value: null, writable: true }); } catch(e){}
  });
  await p.route('**/*', route => {
    const u = route.request().url();
    if (route.request().isNavigationRequest() && u.indexOf('localhost') < 0) return route.abort();
    return route.continue();
  });

  // Кнопку ищем по её же коду, а не по номеру: нажатие перерисовывает
  // разметку, и номер начинает попадать не в ту кнопку. Хранить ссылки на
  // элементы тоже нельзя — часть кнопок перезагружает страницу.
  const targets = await p.$$eval('[onclick]', els => els.map((el, i) => ({
    i,
    full: el.getAttribute('onclick') || '',
    code: (el.getAttribute('onclick') || '').slice(0, 90),
    text: (el.innerText || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  })));
  console.log('кнопок с действием на странице: ' + targets.length);

  const bad = [];
  for (const t of targets) {
    const before = errs.length;
    // Жмём через сам обработчик, а не мышью: часть кнопок перекрыта
    // модальными окнами, и клик мышью до них просто не дойдёт.
    const r = await p.evaluate((code) => {
      const el = Array.from(document.querySelectorAll('[onclick]'))
        .find(x => x.getAttribute('onclick') === code);
      if (!el) return '';           // кнопки сейчас нет на экране — не ошибка
      try { el.onclick.call(el, new MouseEvent('click', { bubbles: true })); return ''; }
      catch (e) { return e.message; }
    }, t.full).catch(e => 'страница перезагрузилась');
    await p.waitForTimeout(35);
    // Некоторые кнопки перезагружают страницу — возвращаемся на место.
    const alive = await p.evaluate(() => !!window.App).catch(() => false);
    if (!alive) {
      await p.goto(`http://localhost:${port}/${FILE}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{});
      await p.waitForTimeout(600);
    }
    // Закрываем всё, что открылось, чтобы следующая кнопка была доступна.
    await p.evaluate(() => {
      try { if (window.App && App.closeModal) App.closeModal(); } catch (e) {}
      try { if (window.App && App.closeSheet) App.closeSheet(); } catch (e) {}
      document.querySelectorAll('.modal.show,.sheet.show').forEach(x => x.classList.remove('show'));
    }).catch(() => {});
    if (r) bad.push({ text: t.text, code: t.code, msg: r });
    else if (errs.length > before)
      bad.push({ text: t.text, code: t.code, msg: errs[errs.length - 1].msg });
  }

  if (!bad.length) console.log('\n✓ все кнопки отработали без ошибок');
  else {
    console.log('\n✗ упало кнопок: ' + bad.length);
    bad.forEach(x => console.log('  • ' + (x.text || '(без подписи)') + ' [' + x.code + '] → ' + x.msg));
  }
  await b.close();
  srv.close();
  process.exit(bad.length ? 1 : 0);
});
