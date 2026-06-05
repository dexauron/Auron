/**
 * Auron — Cloudflare Worker: прокси для Supabase API
 *
 * Зачем: supabase.co работает через AWS, который в России бывает заблокирован.
 * Этот Worker запускается на серверах Cloudflare (есть в Москве и СПб),
 * поэтому работает без VPN.
 *
 * Деплой (бесплатно, 5 мин):
 *   1. Зайдите на https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Вставьте этот код, нажмите Deploy
 *   3. Скопируйте URL воркера (вида https://auron-proxy.ВАШ_НИК.workers.dev)
 *   4. Вставьте в app/js/config.js:
 *        window.SUPABASE_PROXY_URL = 'https://auron-proxy.ВАШ_НИК.workers.dev';
 *   5. Закоммитьте и запушите
 */

const SUPABASE_URL = 'https://zdxkhlxbmwyvvrmvjnfy.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, x-supabase-auth, prefer, accept, accept-profile, content-profile, range',
  'Access-Control-Expose-Headers': 'Content-Range, X-Total-Count',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const target = SUPABASE_URL + url.pathname + url.search;

    // Форвардим запрос в Supabase
    const upstream = new Request(target, {
      method:  request.method,
      headers: request.headers,
      body:    ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    let resp;
    try {
      resp = await fetch(upstream);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'proxy_error', message: e.message }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // Копируем заголовки + добавляем CORS
    const headers = new Headers(resp.headers);
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));

    return new Response(resp.body, {
      status:  resp.status,
      headers,
    });
  },
};
