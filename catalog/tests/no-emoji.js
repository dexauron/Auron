// В интерфейсе не должно быть эмодзи: они рисуются шрифтом системы и на
// Android, iPhone и Windows выглядят по-разному — разного размера, веса и
// цвета. Вместо них один набор контурных значков (ICONS в app.js).
// Проверка читает исходники, браузер тут не нужен.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
// эмодзи и пиктограммы; рамки в комментариях (─ ═) и обычную типографику не трогаем
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{FF0B}]/u;
const SKIP = /^\s*(\/\/|\*|\/\*)|═|──/;

let fail = false;
const chk = (c, m) => { if (!c) { console.log('FAIL:', m); fail = true; } else console.log('OK:', m); };

const MODULES = fs.readdirSync(path.join(dir, 'js/modules')).map((f) => 'js/modules/' + f);
for (const f of ['index.html', ...MODULES]) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  const bad = [];
  lines.forEach((l, i) => {
    if (SKIP.test(l)) return;                      // комментарии — не интерфейс
    const m = l.match(EMOJI);
    if (m) bad.push(`${i + 1}: ${m[0]} → ${l.trim().slice(0, 60)}`);
  });
  chk(!bad.length, `${f}: эмодзи в интерфейсе нет${bad.length ? ` (${bad.length}) ` + bad.slice(0, 3).join(' | ') : ''}`);
}

// набор значков на месте и каждая категория умеет рисоваться
const app = MODULES.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
chk(/const ICONS = \{/.test(app) && /function ic\(name, cls\)/.test(app), 'набор значков и функция ic() на месте');
const cats = [...app.matchAll(/\{ name: '([^']+)',\s*icon: null/g)].map((m) => m[1]);
const drawn = [...app.matchAll(/^\s*'([^']+)':\s*'<(?:path|circle|rect)/gm)].map((m) => m[1]);
const missing = cats.filter((c) => !drawn.includes(c));
chk(cats.length >= 12, `категорий без эмодзи: ${cats.length}`);
chk(!missing.length, `у каждой категории есть рисунок${missing.length ? ': нет у ' + missing.join(', ') : ''}`);

console.log(fail ? '\n=== ЭМОДЗИ В ИНТЕРФЕЙСЕ: ЕСТЬ ОШИБКИ ===' : '\n=== ЭМОДЗИ В ИНТЕРФЕЙСЕ: ОК ===');
process.exit(fail ? 1 : 0);
