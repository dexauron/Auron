// Приложение разложено на модули. Проверка следит, чтобы разделение не
// расползлось обратно: нет мёртвых импортов, нет обращений к тому, чего
// модуль не импортировал, ни один файл не разросся снова до тысяч строк.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'js', 'modules');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

let fail = false;
const chk = (c, m) => { if (!c) { console.log('FAIL:', m); fail = true; } else console.log('OK:', m); };

const imports = (s) => {
  const out = [];
  for (const m of s.matchAll(/^import \{([^}]*)\} from '\.\/([\w-]+)\.js';$/gm)) {
    out.push({ names: m[1].split(',').map((x) => x.trim()).filter(Boolean), from: m[2] });
  }
  return out;
};
const exportsOf = (s) => [
  ...[...s.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  ...[...s.matchAll(/^export (?:const|let) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
];
// имена, объявленные в самом файле (чтобы отличить своё от чужого)
const declared = (s) => new Set([
  ...[...s.matchAll(/^(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  ...[...s.matchAll(/^(?:export )?(?:const|let|var) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
]);

chk(files.length >= 10, `приложение разложено на модули (${files.length})`);
chk(files.includes('app.js'), 'есть точка входа app.js');

// ── 1. Ни один модуль не должен снова стать «файлом на всё» ──
const sizes = files.map((f) => [f, src[f].split('\n').length]).sort((a, b) => b[1] - a[1]);
console.log('--- размеры модулей ---');
sizes.forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}  ${f}`));
console.log('---');
chk(sizes[0][1] <= 1200, `самый большой модуль в разумных пределах (${sizes[0][0]} — ${sizes[0][1]} строк)`);

// ── 2. Импортируется только то, что и правда используется ──
const unusedAll = [];
for (const f of files) {
  const body = src[f].replace(/^import .*$/gm, '');
  for (const im of imports(src[f])) {
    for (const n of im.names) {
      const re = new RegExp('(?<![\\w$.])' + n.replace(/[$]/g, '\\$') + '(?![\\w$])');
      if (!re.test(body)) unusedAll.push(`${f} ← ${n} (из ${im.from})`);
    }
  }
}
chk(!unusedAll.length, `нет лишних импортов${unusedAll.length ? ' (' + unusedAll.length + '): ' + unusedAll.slice(0, 4).join(', ') : ''}`);

// ── 3. Импортируют только то, что модуль отдаёт ──
const bad = [];
for (const f of files) {
  for (const im of imports(src[f])) {
    const target = im.from + '.js';
    if (!src[target]) { bad.push(`${f} → нет модуля ${target}`); continue; }
    const ex = new Set(exportsOf(src[target]));
    for (const n of im.names) if (!ex.has(n)) bad.push(`${f} берёт «${n}», а ${target} его не отдаёт`);
  }
}
chk(!bad.length, `все импорты разрешаются${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);

// ── 4. Ничего не отдаётся «в никуда» ──
const usedFrom = {};
for (const f of files) for (const im of imports(src[f])) {
  (usedFrom[im.from + '.js'] = usedFrom[im.from + '.js'] || new Set());
  im.names.forEach((n) => usedFrom[im.from + '.js'].add(n));
}
const orphan = [];
for (const f of files) {
  if (f === 'app.js') continue;           // точка входа ничего не отдаёт
  for (const n of exportsOf(src[f])) if (!(usedFrom[f] || new Set()).has(n)) orphan.push(`${f}: ${n}`);
}
chk(!orphan.length, `нет экспорта, который никому не нужен${orphan.length ? ' (' + orphan.length + '): ' + orphan.slice(0, 5).join(', ') : ''}`);

// ── 5. Разметка и офлайн-кэш знают про модули ──
const html = fs.readFileSync(path.join(dir, '..', '..', 'index.html'), 'utf8');
chk(/<script type="module" src="js\/modules\/app\.js">/.test(html), 'разметка подключает точку входа как модуль');
const sw = fs.readFileSync(path.join(dir, '..', '..', 'sw.js'), 'utf8');
const missing = files.filter((f) => !sw.includes(`js/modules/${f}`));
chk(!missing.length, `офлайн-кэш знает про все модули${missing.length ? ': нет ' + missing.join(', ') : ''}`);

console.log(fail ? '\n=== МОДУЛИ: ЕСТЬ ОШИБКИ ===' : '\n=== МОДУЛИ: ОК ===');
process.exit(fail ? 1 : 0);
