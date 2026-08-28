/* Свой сетевой канал для браузера.
 * Прокси среды пропускает обычные программы, но сбрасывает соединения самого
 * Chromium. Поэтому браузер в сеть не ходит вовсе: он только рисует страницу,
 * а каждый запрос перехватывается и выполняется здесь — через CONNECT-туннель,
 * который прокси разрешает. */
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

const CA = fs.readFileSync('/root/.ccr/ca-bundle.crt');
const PROXY = new URL(process.env.HTTPS_PROXY || process.env.https_proxy);

function once(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  const u = new URL(urlStr);
  const port = u.port || (u.protocol === 'https:' ? 443 : 80);
  return new Promise((resolve, reject) => {
    const tunnel = http.request({
      host: PROXY.hostname, port: PROXY.port, method: 'CONNECT',
      path: `${u.hostname}:${port}`, headers: { Host: `${u.hostname}:${port}` },
      timeout: 30000,
    });
    tunnel.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error('CONNECT ' + res.statusCode)); }
      const h = { ...headers };
      delete h['accept-encoding'];
      h['accept-encoding'] = 'gzip, deflate';
      h.host = u.host;
      delete h.connection;
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        method, host: u.hostname, port, path: u.pathname + u.search,
        headers: h, socket, agent: false, ca: CA, servername: u.hostname, timeout: 30000,
      }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => {
          let buf = Buffer.concat(chunks);
          const enc = String(r.headers['content-encoding'] || '').toLowerCase();
          try {
            if (enc === 'gzip') buf = zlib.gunzipSync(buf);
            else if (enc === 'deflate') buf = zlib.inflateSync(buf);
            else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
          } catch (e) { /* пришло не тем, чем обещали — отдаём как есть */ }
          const out = { ...r.headers };
          // тело уже распаковано и, возможно, другой длины — эти заголовки соврут
          delete out['content-encoding']; delete out['content-length'];
          delete out['transfer-encoding']; delete out['content-security-policy'];
          resolve({ status: r.statusCode, headers: out, body: buf });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('таймаут ответа')));
      if (body) req.write(body);
      req.end();
    });
    tunnel.on('error', reject);
    tunnel.on('timeout', () => tunnel.destroy(new Error('таймаут туннеля')));
    tunnel.end();
  });
}

// переходы 30x проходим сами: браузер их не увидит
async function fetchVia(urlStr, opts = {}, depth = 0) {
  const r = await once(urlStr, opts);
  const loc = r.headers.location;
  if (loc && r.status >= 300 && r.status < 400 && depth < 6) {
    const next = new URL(loc, urlStr).toString();
    const o = { ...opts };
    if (r.status === 303 || ((r.status === 301 || r.status === 302) && opts.method === 'POST')) { o.method = 'GET'; o.body = null; }
    return fetchVia(next, o, depth + 1);
  }
  return r;
}

module.exports = { fetchVia };
