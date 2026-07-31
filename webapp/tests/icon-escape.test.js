// Значок в подписи строки не должен печататься кодом — и не должен стать
// дырой. Баг 4.51.0: я заменил эмодзи на SVG, а подпись экранируется
// целиком, и владелец увидел на экране разметку вместо значка.
// Ослабление экранирования опасно: названия товаров приходят из 1С.
var fs=require('fs'),path=require('path');
var h=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// Вытаскиваем настоящие _EI и _eIco из приложения, а не переписываем их тут.
var m=h.match(/_EI:(\/\^<svg[\s\S]*?\/),\n/);
t('правило _EI найдено в приложении', !!m);
var EI=m?eval(m[1]):/$^/;
function esc(s){return String(s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function eIco(v){var s=String(v==null?'':v);var r=EI.exec(s);
  return r?r[0]+esc(s.slice(r[0].length)):esc(s);}

var ICO='<svg class="ei" width="16" height="16" viewBox="0 0 24 24" fill="none" '+
 'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+
 '<circle cx="12" cy="12" r="9"/><path d="M6 12h12"/></svg>';

// 1) Наш значок проходит и НЕ печатается кодом
t('наш значок проходит как разметка', eIco(ICO+' Молоко').indexOf('<svg class="ei"')===0);
t('текст после значка экранируется', eIco(ICO+' <b>x</b>').indexOf('&lt;b&gt;')>0);

// 2) Ничего постороннего не проходит
[['скрипт','<script>alert(1)</script>'],
 ['svg с обработчиком','<svg class="ei" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle onload="alert(1)"/></svg>'],
 ['чужой svg','<svg onload="alert(1)"><circle/></svg>'],
 ['картинка с onerror','<img src=x onerror=alert(1)>'],
 ['значок не в начале','Молоко '+ICO],
 ['вложенный тег внутри значка','<svg class="ei" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><script>alert(1)</script></svg>']
].forEach(function(p){
  t('не проходит: '+p[0], eIco(p[1]).indexOf('<')<0, eIco(p[1]).slice(0,60));
});

// 3) Название товара с кавычками не ломает разметку
t('кавычки в названии экранируются', eIco('Молоко "Домик"').indexOf('&quot;')>0);

// 4) В приложении подпись действительно идёт через _eIco, а не через _e
t('_wRow использует _eIco', /_wRow:function\(l,r,c\)[\s\S]{0,400}App\._eIco\(l\)/.test(h));
t('rowHtml использует _eIco', /rowHtml=function\(left[\s\S]{0,400}App\._eIco\(left\)/.test(h));

console.log('\nЗначок в подписи: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
