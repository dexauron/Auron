// Карточка товара: «все данные, вся история, любые операции + отдельная
// кнопка показать всю информацию» (слова владельца).
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// ── Сервер отдаёт всё, что есть по товару ────────────────────────────
t('поступления и цены', /priceHist:priceHist/.test(code));
t('поставщики с ценами', /suppliers:suppliers/.test(code));
t('прошлые розничные цены', /retailHist:retailHist/.test(code));
t('списания и возвраты', /losses:losses/.test(code));
t('итоги за всё время', /totals:totals/.test(code));
t('списания ищутся по названию товара',
  /SH_LOSSES[\s\S]{0,600}nm\.indexOf\(nameLow\)<0/.test(code));
t('новые списания сверху', /losses\.sort\(function\(a,b\)\{return b\.t-a\.t;\}\)/.test(code));
t('в итогах есть разброс закупочной цены',
  /priceMin/.test(code) && /priceMax/.test(code));
t('в итогах есть сумма списаний', /lossSum\+=x\.amount/.test(code));
t('пустой лист списаний не роняет карточку',
  /catch\(eL\)\{\}/.test(code));

// Товар без названия не должен подтянуть ЧУЖИЕ списания: пустая строка
// внутри любой другой строки находится всегда.
var m=code.match(/if \(!nm \|\| !nameLow \|\| nm\.indexOf\(nameLow\)<0\) return;/);
t('без названия чужие списания не подтягиваются', !!m);

// ── Экран ────────────────────────────────────────────────────────────
t('есть кнопка «показать всю информацию»',
  /Показать всю информацию/.test(html) && /_productToggleAll:function/.test(html));
t('по кнопке блок разворачивается и сворачивается',
  /btn\.textContent=on\?'Свернуть'/.test(html));
t('подробности спрятаны по умолчанию',
  /id="pc-all" style="display:none;"/.test(html));
t('главное остаётся на виду (плитки и поставщики не спрятаны)',
  html.indexOf("hd+='<div class=\"pc-sec\">Поставщики")<0);
t('итоговая строка «за всё время» есть', /За всё время:/.test(html));
t('списания показаны красным', /rowHtml\(left, fm\(x\.amount\)\+' ₽', 'var\(--neg\)'\)/.test(html));
t('кнопки нет, когда показывать нечего', /if\(hd\)h\+=/.test(html));

console.log('\nКарточка товара: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
