// Прогоняет все проверки подряд и печатает итог.
// Требует поднятого сервера: python3 -m http.server 8123 --directory catalog
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.js') && !['run.js', 'helpers.js'].includes(f))
  .sort();

let bad = 0;
for (const f of files) {
  process.stdout.write(`\n──────── ${f} ────────\n`);
  try {
    execFileSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: process.env });
  } catch (e) { bad++; }
}
console.log(bad ? `\n════ ПРОВАЛИЛОСЬ ФАЙЛОВ: ${bad} из ${files.length} ════`
  : `\n════ ВСЕ ПРОВЕРКИ ПРОШЛИ (${files.length}) ════`);
process.exit(bad ? 1 : 0);
