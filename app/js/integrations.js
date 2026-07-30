// Auron — бесплатные интеграции (без зависимостей, без чужого кода).
// Готовые функции: делиться отчётом (Web Share), курс валют ЦБ РФ, Telegram-бот.
// Все три — официально/публично бесплатны. Ключи (если есть) — только на устройстве
// владельца в localStorage, НИКОГДА не в коде и не в репозитории.
(() => {
  'use strict';

  // ── 1. Web Share — поделиться отчётом. Без ключей и сервера. ──────────────
  // Возвращает { ok, via }. via: 'native' | 'clipboard' | 'cancel' | 'none'.
  async function share(opts) {
    opts = opts || {};
    const data = {
      title: opts.title || 'Auron',
      text:  opts.text  || '',
      url:   opts.url   || (typeof location !== 'undefined' ? location.href : '')
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share(data); return { ok: true, via: 'native' }; }
      catch (e) { if (e && e.name === 'AbortError') return { ok: false, via: 'cancel' }; }
    }
    // Запасной путь: копируем текст+ссылку в буфер обмена
    try {
      const payload = (data.text ? data.text + '\n' : '') + data.url;
      await navigator.clipboard.writeText(payload);
      return { ok: true, via: 'clipboard' };
    } catch (e) { return { ok: false, via: 'none', error: String(e && e.message || e) }; }
  }
  // Прямые ссылки в мессенджеры (полуавтомат: один тап — текст уже набран)
  function waLink(phone, text) {
    return 'https://wa.me/' + String(phone || '').replace(/\D/g, '') +
      '?text=' + encodeURIComponent(text || '');
  }
  function tgShareLink(text, url) {
    return 'https://t.me/share/url?url=' + encodeURIComponent(url || (typeof location !== 'undefined' ? location.href : '')) +
      '&text=' + encodeURIComponent(text || '');
  }

  // ── 2. Курс валют ЦБ РФ — бесплатный публичный API, без ключа. ─────────────
  // Кэш на день. Возвращает { USD: рублей_за_1, EUR: ..., ... }.
  const RATES_KEY = 'auron_cbr_rates';
  function _today() { return new Date().toISOString().slice(0, 10); }
  async function cbrRates(force) {
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
        if (c && c.date === _today() && c.rates) return c.rates;
      } catch (_) {}
    }
    const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
    if (!res.ok) throw new Error('ЦБ РФ недоступен');
    const data = await res.json();
    const rates = {};
    const v = data && data.Valute ? data.Valute : {};
    Object.keys(v).forEach(k => { if (v[k] && v[k].Nominal) rates[k] = v[k].Value / v[k].Nominal; });
    try { localStorage.setItem(RATES_KEY, JSON.stringify({ date: _today(), rates })); } catch (_) {}
    return rates;
  }

  // ── 3. Telegram-бот — официальный Bot API, бесплатно. ─────────────────────
  // Токен и chat_id вводит владелец в настройках; хранятся ТОЛЬКО в localStorage
  // его устройства. В код/репозиторий не попадают. Клиентская отправка — токен
  // виден в браузере владельца; для масштаба надёжнее серверный ретранслятор.
  const TG_TOKEN = 'auron_tg_token', TG_CHAT = 'auron_tg_chat';
  function tgConfigure(token, chatId) {
    try {
      token  ? localStorage.setItem(TG_TOKEN, token) : localStorage.removeItem(TG_TOKEN);
      chatId ? localStorage.setItem(TG_CHAT, chatId) : localStorage.removeItem(TG_CHAT);
    } catch (_) {}
  }
  function tgReady() {
    try { return !!localStorage.getItem(TG_TOKEN) && !!localStorage.getItem(TG_CHAT); }
    catch (_) { return false; }
  }
  async function tgSend(text) {
    const token = localStorage.getItem(TG_TOKEN);
    const chat  = localStorage.getItem(TG_CHAT);
    if (!token || !chat) throw new Error('Telegram не настроен');
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(text || ''), parse_mode: 'HTML' })
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data.ok) throw new Error(data.description || ('Ошибка ' + res.status));
    return true;
  }

  const Integrations = { share, waLink, tgShareLink, cbrRates, tgConfigure, tgReady, tgSend };
  if (typeof window !== 'undefined') window.Integrations = Integrations;
  if (typeof module !== 'undefined' && module.exports) module.exports = Integrations; // для юнит-теста
})();
