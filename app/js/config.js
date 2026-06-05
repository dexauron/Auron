// Auron Finance — Configuration
window.SUPABASE_URL      = 'https://zdxkhlxbmwyvvrmvjnfy.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkeGtobHhibXd5dnZybXZqbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MTk1ODMsImV4cCI6MjA5NjE5NTU4M30.ZrZDc7HIQzCPHo4tQjImRIyg53Hzi5Y1nBMf22aGS0E';

// Cloudflare Worker прокси (оставьте '' если не используете)
window.SUPABASE_PROXY_URL = '';

// Проверка конфига при старте
window.checkConfig = function () {
  var urlOk = window.SUPABASE_URL  && !window.SUPABASE_URL.includes('ВСТАВЬ_СЮДА');
  var keyOk = window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes('ВСТАВЬ_СЮДА');
  if (!urlOk || !keyOk) {
    var loader = document.getElementById('loader');
    if (loader) loader.innerHTML =
      '<div style="max-width:340px;padding:0 24px;text-align:center;">' +
      '<div style="font-size:48px;margin-bottom:20px;">⚙️</div>' +
      '<div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:12px;">Нужна настройка</div>' +
      '<div style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.7;">' +
        'Откройте <code>app/js/config.js</code> и вставьте SUPABASE_URL и SUPABASE_ANON_KEY.' +
      '</div></div>';
    return false;
  }
  return true;
};
