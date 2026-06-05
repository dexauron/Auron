// Auron Finance — Configuration
// ─────────────────────────────────────────────────────────────────────────────
// Supabase: Project Settings → API → Project URL + anon public key
// ─────────────────────────────────────────────────────────────────────────────
window.SUPABASE_URL      = 'https://zdxkhlxbmwyvvrmvjnfy.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkeGtobHhibXd5dnZybXZqbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MTk1ODMsImV4cCI6MjA5NjE5NTU4M30.ZrZDc7HIQzCPHo4tQjImRIyg53Hzi5Y1nBMf22aGS0E';

// Cloudflare Worker прокси (для работы без VPN в России).
// Оставьте пустым ('') если не используете Worker.
// Инструкция: см. cloudflare/worker.js в репозитории.
window.SUPABASE_PROXY_URL = '';

// CONFIG CHECK — вызывается из App.init() при старте
window.checkConfig = function () {
  var urlOk = window.SUPABASE_URL  && !window.SUPABASE_URL.includes('ВСТАВЬ_СЮДА');
  var keyOk = window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes('ВСТАВЬ_СЮДА');
  if (!urlOk || !keyOk) {
    var loader = document.getElementById('loader');
    if (loader) loader.innerHTML =
      '<div style="max-width:340px;padding:0 24px;text-align:center;">' +
      '<div style="font-size:48px;margin-bottom:20px;">⚙️</div>' +
      '<div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:12px;">Нужна настройка</div>' +
      '<div style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.7;margin-bottom:20px;">' +
        'Откройте файл <code style="background:rgba(255,255,255,.1);padding:2px 7px;border-radius:5px;font-size:13px;">app/js/config.js</code> ' +
        'и вставьте <b style="color:#fff;">SUPABASE_URL</b> и <b style="color:#fff;">SUPABASE_ANON_KEY</b> ' +
        'из вашего проекта на <a href="https://supabase.com" target="_blank" style="color:#818CF8;text-decoration:underline;">supabase.com</a>.' +
      '</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.35);">Project Settings → API → Project URL + anon public key</div>' +
      '</div>';
    return false;
  }
  return true;
};
