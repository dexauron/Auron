import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join, dirname, isAbsolute, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openWorkspace } from './workspace-store.mjs';
import { AccessError } from './access.mjs';
import { InputError } from './domain.mjs';
import { VersionError } from './workspace-store.mjs';
import { AccountConflictError } from './accounts.mjs';
import { createBackupService } from './workspace-backups.mjs';
import { DraftConflictError } from './workspace-drafts.mjs';
import { validateNetworkConfig, allowedNetworkPeer } from './workspace-network.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/workspace.mjs', ['workspace/app.mjs', 'text/javascript; charset=utf-8']],
  ['/finance.mjs', ['workspace/finance.mjs', 'text/javascript; charset=utf-8']],
  ['/procurement.mjs', ['workspace/procurement.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace.css', ['workspace/style.css', 'text/css; charset=utf-8']],
  ['/worksheet.mjs', ['worksheet.mjs', 'text/javascript; charset=utf-8']],
  ['/domain.mjs', ['domain.mjs', 'text/javascript; charset=utf-8']],
  ['/amount.mjs', ['public/amount.mjs', 'text/javascript; charset=utf-8']]
]);
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createWorkspaceServer(workspace, { setupCode = randomBytes(32).toString('hex'), backupService = null, network = null } = {}) {
  const csrf = randomBytes(32).toString('hex');
  const a = workspace.accounts;
  const net = network ? validateNetworkConfig(network.config) : null;
  if (network && (!network.tlsOptions || !a.configured())) throw new Error('Перед HTTPS создайте владельца в локальном режиме');
  const handler = async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...(net ? { 'Strict-Transport-Security': 'max-age=86400' } : {}),
      'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
    const send = (status, body, extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(body)); };
    const cookieName = net ? '__Host-way_workspace' : 'way_workspace';
    const cookie = value => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; ${net ? 'Secure; ' : ''}${value ? 'Max-Age=28800' : 'Max-Age=0'}`;
    try {
      const port = server.address().port;
      const protocol = net ? 'https:' : 'http:', origin = net?.publicOrigin ?? `http://${req.headers.host}`;
      if (net ? !req.socket.encrypted || !allowedNetworkPeer(req.socket.remoteAddress,net) || req.headers.host !== new URL(origin).host : ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw new AccessError('Недопустимый адрес');
      if (Object.keys(req.headers).some(h => h === 'forwarded' || h.startsWith('x-forwarded-'))) throw new AccessError('Прокси-подключение не настроено');
      if (req.headers.origin && req.headers.origin !== origin) throw new AccessError('Внешний источник запрещён');
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new AccessError('Внешний источник запрещён');
      const url = new URL(req.url, `${protocol}//${req.headers.host}`), path = url.pathname;
      const token = new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie ?? '')?.[1] ?? '';
      if (req.method === 'GET' && files.has(path)) {
        const [file, type] = files.get(path);
        res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(await readFile(join(root, file))); return;
      }
      if (req.method === 'GET' && path === '/api/session') {
        let user = null;
        try { user = a.session(token, false); } catch (error) { if (!(error instanceof AccessError)) throw error; }
        const backupHealth = user?.role === 'owner' && backupService ? backupService.health({ id: user.id, version: user.version }) : null;
        return send(200, { csrf, configured: a.configured(), user, capabilities: { backups: Boolean(backupService) }, backupHealth });
      }
      let payload;
      if (req.method === 'POST') {
        if (!equal(req.headers['x-way-token'], csrf)) throw new AccessError('Обновите страницу');
        if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'Требуется JSON' });
        const parts = []; let bytes = 0;
        for await (const part of req) { bytes += part.length; if (bytes > 65536) { send(413, { error: 'Слишком большой запрос' }); req.resume(); return; } parts.push(part); }
        try { payload = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new InputError('Неверный JSON'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new InputError('Неверные данные');
        if (path === '/api/bootstrap') {
          if (net) throw new AccessError('Первоначальная настройка доступна только в локальном режиме');
          if (a.configured() || !equal(payload.code, setupCode)) throw new AccessError('Первичная настройка недоступна или неверен код');
          await a.bootstrapOwner(payload); return send(200, { created: true });
        }
        if (path === '/api/login') {
          try { const session = await a.login(payload); return send(200, { user: session.user }, { 'Set-Cookie': cookie(session.token) }); }
          catch (error) { if (error instanceof AccessError) return send(401, { error: error.message }); throw error; }
        }
      }
      let actor;
      try { actor = a.session(token); } catch (error) { if (error instanceof AccessError) return send(401, { error: 'Войдите в аккаунт' }, { 'Set-Cookie': cookie('') }); throw error; }
      // Reject a stale tab's write if another tab has replaced the browser cookie.
      if (req.method === 'POST' && req.headers['x-way-account'] && req.headers['x-way-account'] !== actor.id) throw new AccessError('Аккаунт изменён. Обновите страницу перед сохранением.');
      if (req.method === 'GET') {
        if (path === '/api/backups' && backupService) return send(200, await backupService.status(token));
        if (path === '/api/directory') return send(200, workspace.directory(token));
        if (path === '/api/users') return send(200, a.listUsers(token));
        if (path === '/api/security') return send(200, a.securityHistory(token));
        if (path === '/api/cash') return send(200, workspace.cashList(token));
        if (path === '/api/cash-drafts') return send(200, workspace.draftList(token));
        const draft = /^\/api\/cash-drafts\/(new|[a-f0-9-]{36})$/.exec(path);
        if (draft) return send(200, workspace.draftGet(token, draft[1]));
        const match = /^\/api\/cash\/([a-f0-9-]{36})(\/history)?$/.exec(path);
        if (match) return send(200, workspace.cashGet(token, match[1], Boolean(match[2])));
        if (path === '/api/tasks') return send(200, workspace.tasks(token));
        if (path === '/api/products') return send(200, workspace.products(token));
        if (path === '/api/procurement') return send(200, workspace.procurement(token));
        if (path === '/api/finance') return send(200, workspace.finance(token));
        if (path.startsWith('/api/finance/history/')) return send(200, workspace.financeHistory(token, path.slice('/api/finance/history/'.length)));
        if (path === '/api/finance/report') { const query = new URL(req.url, origin).searchParams; return send(200, workspace.financeReport(token, query.get('start'), query.get('end'))); }
        if (path.startsWith('/api/procurement/history/')) return send(200, workspace.procurementHistory(token, path.slice('/api/procurement/history/'.length)));
      }
      if (req.method === 'POST') {
        if (path.startsWith('/api/backups/') && backupService) {
          if (path === '/api/backups/create') return send(200, await backupService.create(token, payload));
          if (path === '/api/backups/verify') return send(200, await backupService.verify(token, payload));
          if (path === '/api/backups/restore') return send(200, await backupService.restore(token, payload));
          if (path === '/api/backups/schedule') return send(200, await backupService.configure(token, payload));
          if (path === '/api/backups/disable') return send(200, await backupService.disable(token, payload));
          if (path === '/api/backups/download') {
            const bytes = await backupService.download(token, payload);
            res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${payload.id}"` }); res.end(bytes); return;
          }
        }
        if (path === '/api/logout') { a.logout(token); return send(200, { loggedOut: true }, { 'Set-Cookie': cookie('') }); }
        if (path === '/api/password') { await a.changePassword(token, payload); return send(200, { changed: true }, { 'Set-Cookie': cookie('') }); }
        if (path === '/api/users') return send(200, await a.createUser(token, payload));
        if (path === '/api/users/update') return send(200, a.updateUser(token, payload));
        if (path === '/api/cash') return send(200, workspace.cashSave(token, payload));
        if (path === '/api/cash-drafts') return send(200, workspace.draftSave(token, payload));
        if (path === '/api/tasks') return send(200, workspace.taskSave(token, payload));
        if (path === '/api/products') return send(200, workspace.productSave(token, payload));
        if (path === '/api/procurement') return send(200, workspace.procurementSave(token, payload));
        if (path === '/api/finance') return send(200, workspace.financeSave(token, payload));
      }
      return send(404, { error: 'Раздел не найден' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const expected = error instanceof AccessError || error instanceof VersionError || error instanceof AccountConflictError || error instanceof DraftConflictError || error instanceof InputError;
      const status = error instanceof AccessError ? 403 : error instanceof VersionError || error instanceof AccountConflictError || error instanceof DraftConflictError ? 409 : error instanceof InputError ? 400 : 500;
      // No database paths, stack traces, request bodies or credential material.
      send(status, { error: expected ? error.message : 'Ошибка сервера. Сохранение не подтверждено.' });
    }
  };
  const server = net ? createHttpsServer(network.tlsOptions,handler) : createHttpServer(handler);
  if (net) server.on('connection', socket => { if (!allowedNetworkPeer(socket.remoteAddress,net)) socket.destroy(); });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000; server.maxHeadersCount = 40; server.maxConnections = 64; server.maxRequestsPerSocket = 100;
  return { server, setupCode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.platform === 'win32' ? join(process.env.ProgramData ?? homedir(), 'WayMarket-Workspace-Test') : join(homedir(), '.way-market-workspace-test');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const args = process.argv.slice(2); let databasePath = join(dir, 'workspace-test.sqlite');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--restored-test' || !isAbsolute(args[1])) throw new Error('Допустимо: --restored-test "абсолютный путь отдельной восстановленной базы"');
    const local = relative(join(dir, 'restored'), args[1]);
    if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('Выберите копию из папки restored этой рабочей области');
    if (!(await lstat(args[1])).isFile()) throw new Error('Не найден обычный файл восстановленной базы'); databasePath = args[1];
  }
  const workspace = openWorkspace(databasePath);
  const backupService = createBackupService(workspace, { directory: process.env.WAY_MARKET_BACKUP_DIR || join(dir, 'backups'), restoreDirectory: join(dir, 'restored') });
  const { server, setupCode } = createWorkspaceServer(workspace, { backupService });
  server.on('error', e => { console.error(e.message); workspace.close(); process.exitCode = 1; });
  server.listen(3211, '127.0.0.1', () => {
    console.log('Way Market WORKSPACE TEST: http://127.0.0.1:3211');
    console.log(`Отдельная тестовая база: ${databasePath}`);
    if (args.length) console.log('ОТКРЫТА ВОССТАНОВЛЕННАЯ КОПИЯ. Обычная база не заменена.');
    if (!workspace.accounts.configured()) console.log(`Код первичной настройки (ввести в браузере сервера): ${setupCode}`);
    console.log('Только вымышленные данные. LAN выключен. Прежняя кассовая база не изменяется.');
  });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (stopping) return; stopping = true; const stopped = backupService.close(); server.close(async () => { await stopped; workspace.close(); process.exit(0); }); });
}
