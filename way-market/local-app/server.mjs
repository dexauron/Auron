import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { openStore, ConflictError } from './store.mjs';
import { InputError } from './domain.mjs';
import { MAX_ARCHIVE_BYTES, validateArchive } from './archive.mjs';
import { runtimeConfig, verifyStorageChoice } from './config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/advanced.html', ['public/advanced.html', 'text/html; charset=utf-8']],
  ['/excel-app.mjs', ['public/excel-app.mjs', 'text/javascript; charset=utf-8']],
  ['/difference.mjs', ['public/difference.mjs', 'text/javascript; charset=utf-8']],
  ['/excel.css', ['public/excel.css', 'text/css; charset=utf-8']],
  ['/worksheet.mjs', ['worksheet.mjs', 'text/javascript; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/domain.mjs', ['domain.mjs', 'text/javascript; charset=utf-8']]
]);
export function createApp(store, { mode = 'personal-test' } = {}) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    };
    const send = (status, value, extraHeaders = {}) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
      res.end(JSON.stringify(value));
    };
    try {
      const port = server.address().port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return send(403, { error: 'Недопустимый Host' });
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(403, { error: 'Внешний источник запрещён' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'Внешний источник запрещён' });
      const path = req.url;
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path);
        const bytes = await readFile(join(root, file));
        res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(bytes); return;
      }
      if (req.method === 'GET' && path === '/api/session') return send(200, { token, mode });
      if (req.method === 'GET' && path === '/api/shifts') return send(200, store.list());
      if (req.method === 'GET' && path === '/api/catalog') return send(200, store.catalog());
      if (req.method === 'GET' && path === '/api/catalog/history') return send(200, store.catalogHistory());
      const match = /^\/api\/shifts\/([a-f0-9-]{36})(\/history)?$/.exec(path);
      if (req.method === 'GET' && match) {
        const result = match[2] ? store.history(match[1]) : store.get(match[1]);
        return send(result ? 200 : 404, result ?? { error: 'Запись не найдена' });
      }
      if (req.method === 'POST' && ['/api/shifts', '/api/catalog', '/api/archive/download', '/api/archive/check'].includes(path)) {
        const supplied = Buffer.from(req.headers['x-way-token'] ?? '');
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(403, { error: 'Обновите страницу перед сохранением' });
        if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'Требуется JSON' });
        const limit = path === '/api/archive/check' ? MAX_ARCHIVE_BYTES : path === '/api/catalog' ? 256 * 1024 : 65536;
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > limit) { send(413, { error: 'Слишком большой запрос' }); req.resume(); return; }
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new InputError('Неверный JSON'); }
        if (path === '/api/archive/check') return send(200, validateArchive(payload));
        if (path === '/api/catalog') return send(200, store.saveCatalog(payload));
        if (path === '/api/archive/download') {
          const filename = `way-market-test-${new Date().toISOString().replace(/[-:.]/g, '')}.json`;
          return send(200, store.archive(), { 'Content-Disposition': `attachment; filename="${filename}"` });
        }
        return send(200, store.save(payload));
      }
      send(404, { error: 'Страница не найдена' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      send(error instanceof ConflictError ? 409 : error instanceof InputError ? 400 : 500,
        { error: error instanceof InputError || error instanceof ConflictError ? error.message : 'Ошибка сервера. Данные не подтверждены как сохранённые.' });
      if (!(error instanceof InputError || error instanceof ConflictError)) console.error(error);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = runtimeConfig(process.argv.slice(2), { platform: process.platform, env: process.env, home: homedir() });
  verifyStorageChoice(config, existsSync);
  const { dataDir, databasePath, recovered } = config;
  if (recovered && !(await stat(databasePath)).isFile()) throw new Error('Не найден файл восстановленной базы');
  if (!recovered) await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = openStore(databasePath, { requireSchema1: recovered });
  const server = createApp(store, { mode: config.mode });
  server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
  server.listen(config.port, config.host, () => {
    console.log('Way Market TEST: http://127.0.0.1:3210');
    console.log(`Тестовая база: ${databasePath}`);
    console.log(`Режим: ${config.mode}`);
    if (recovered) console.log('ОТКРЫТА ОТДЕЛЬНАЯ ВОССТАНОВЛЕННАЯ ТЕСТОВАЯ КОПИЯ. Изменения сохраняются в неё.');
    console.log('Только этот компьютер. Остановка: Ctrl+C. Реальные данные не вводить.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
