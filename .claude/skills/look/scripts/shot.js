// Снимок экрана приложения — чтобы смотреть на результат, а не воображать его.
//
// Запуск:
//   node .claude/skills/look/scripts/shot.js app/index.html
//   node .claude/skills/look/scripts/shot.js app/index.html --wide      (только компьютер)
//   node .claude/skills/look/scripts/shot.js app/index.html --out /tmp/x
//
// Кладёт два файла: <имя>-phone.png (390×844) и <имя>-desktop.png (1440×900).
// Требует playwright-core; браузер уже стоит в /opt/pw-browsers.
const path = require('path');
const fs   = require('fs');
const http = require('http');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
if (!target) { console.error('Укажи файл: node shot.js app/index.html'); process.exit(1); }

const OUT  = (args.indexOf('--out') >= 0) ? args[args.indexOf('--out') + 1] : '.';
const ONLY = args.includes('--wide') ? 'desktop' : args.includes('--phone') ? 'phone' : null;
const ROOT = path.dirname(path.resolve(target));
const FILE = path.basename(target);
const NAME = FILE.replace(/\.[^.]+$/, '');

// Локальный сервер: file:// ломает часть браузерных возможностей, а нам нужен
// экран максимально близкий к тому, что увидит владелец.
const TYPES = {'.html':'text/html;charset=utf-8', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.webp':'image/webp', '.ico':'image/x-icon'};
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
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch (e) { console.error('Нет playwright-core. Установи: npm i playwright-core'); process.exit(1); }

  const b = await chromium.launch({ executablePath: chrome(), args: ['--no-sandbox'] });
  const sizes = [['phone', 390, 844], ['desktop', 1440, 900]]
    .filter(s => !ONLY || s[0] === ONLY);

  for (const [label, width, height] of sizes) {
    const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    try {
      await p.goto(`http://localhost:${port}/${FILE}`, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (e) { console.log('  загрузка:', e.message.split('\n')[0]); }
    await p.waitForTimeout(1200);
    const out = path.join(OUT, `${NAME}-${label}.png`);
    await p.screenshot({ path: out });
    console.log(`${label.padEnd(8)} → ${out}`);
    // Ошибки на странице важнее картинки: экран может выглядеть целым и быть мёртвым.
    if (errs.length) console.log('  ошибки на странице: ' + errs.slice(0, 3).join(' | '));
    await p.close();
  }
  await b.close();
  srv.close();
});
