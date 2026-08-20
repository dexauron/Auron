// Аудит разметки и обработчиков. Ловит то, что не видно глазом и не падает в
// консоли: кнопку без обработчика, ссылку на исчезнувший элемент, эмодзи в
// разметке. Такие вещи заводятся именно после переделки экранов.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dir = path.join(root, 'js', 'modules');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const all = Object.values(src).join('\n');

let fail = false;
const chk = (c, m) => { if (!c) { console.log('FAIL:', m); fail = true; } else console.log('OK:', m); };

// ── 1. Код не должен обращаться к тому, чего нет на экране ──
const htmlIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...all.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));   // создаются на лету
const missing = [];
for (const [f, s] of Object.entries(src)) {
  for (const m of s.matchAll(/\$\('([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!htmlIds.has(id) && !jsIds.has(id)) missing.push(`${f} → #${id}`);
  }
}
chk(!missing.length, `код обращается только к тому, что есть на экране${missing.length ? ': ' + [...new Set(missing)].join(', ') : ''}`);

// ── 2. У каждой кнопки есть обработчик ──
// Кнопка без обработчика молчит: человек жмёт, ничего не происходит, и по коду
// это не видно — только перебором.
const BY_FORM = ['loginSubmit', 'formSubmit', 'compSubmit', 'staffPassSubmit'];  // срабатывают через submit формы
const buttons = [...html.matchAll(/<button[^>]*\bid="([\w-]+)"/g)].map((m) => m[1]);
const dead = buttons.filter((id) => !BY_FORM.includes(id) && !new RegExp(`['"\`]${id}['"\`]`).test(all));
chk(!dead.length, `у каждой кнопки есть обработчик${dead.length ? ': молчат ' + dead.join(', ') : ''}`);

// ── 3. В разметке нет забытых элементов ──
const orphans = [...htmlIds].filter((id) => !new RegExp(`['"\`#]${id}['"\`\\s]`).test(all)
  && !html.includes(`data-close="${id}"`) && !html.includes(`for="${id}"`) && !html.includes(`aria-labelledby="${id}"`));
chk(!orphans.length, `в разметке нет забытых элементов${orphans.length ? ': ' + orphans.join(', ') : ''}`);

// ── 4. Эмодзи запрещены и в разметке, а не только в коде ──
const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
const inHtml = [...new Set(html.match(EMO) || [])];
chk(!inHtml.length, `в разметке нет эмодзи${inHtml.length ? ': ' + inHtml.join(' ') : ''}`);

console.log(fail ? '\n=== АУДИТ РАЗМЕТКИ: ЕСТЬ ОШИБКИ ===' : '\n=== АУДИТ РАЗМЕТКИ: ОК ===');
process.exit(fail ? 1 : 0);
