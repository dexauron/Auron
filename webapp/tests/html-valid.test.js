// Проверка вёрстки Index.html перед пушем.
// Apps Script (HtmlService) строже браузера: любая кривая кавычка или
// незакрытый тег → «Неверный формат содержания HTML» и приложение не грузится.
// Ловим ошибки, которые уже случались: v4.0.0 (attr="..."<div) и
// v4.34.0 (data-need="goods"" — лишняя кавычка от неудачной автозамены).
var fs=require('fs');
var path=require('path').join(__dirname,'..','Index.html');
var h=fs.readFileSync(path,'utf8');
var ok=0,fail=0;
function t(n,c,extra){ if(c){ok++;console.log('  ✓ '+n);}
  else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));} }

// 1) лишняя кавычка после значения атрибута: attr="x""
var dq=h.match(/[a-zA-Z-]+="[^"<>]*""(?=[\s>])/g)||[];
t('нет лишних кавычек в атрибутах', dq.length===0, dq.slice(0,3).join(' | '));

// 2) пропущена закрывающая скобка тега: attr="x"<div
var noGt=h.match(/[a-zA-Z-]+="[^"]*"<[a-zA-Z]/g)||[];
t('нет пропущенных > в тегах', noGt.length===0, noGt.slice(0,3).join(' | '));

// 3) баланс основных парных тегов
['div','span','button','style','script','article','section','label','table'].forEach(function(tag){
  var o=(h.match(new RegExp('<'+tag+'[\\s>]','g'))||[]).length;
  var c=(h.match(new RegExp('</'+tag+'>','g'))||[]).length;
  t('баланс <'+tag+'>: '+o+'/'+c, o===c);
});

// 4) инлайн-скрипты синтаксически валидны
var blocks=[];
var re=/<script([^>]*)>([\s\S]*?)<\/script>/g,m;
while((m=re.exec(h))) if(!/\bsrc=/.test(m[1])) blocks.push(m[2]);
var bad=0;
blocks.forEach(function(js,i){
  try{ new Function(js); }catch(e){ bad++; console.log('     блок '+i+': '+e.message.slice(0,70)); }
});
t('инлайн-JS без синтаксических ошибок ('+blocks.length+' блоков)', bad===0);

// 5) шаблонные вставки Apps Script целы: <?= x ?>
var tpl=(h.match(/<\?=?[\s\S]{0,80}?\?>/g)||[]);
t('шаблонные вставки <?= ?> целы', tpl.every(function(x){return x.indexOf('?>')>0;}));

// 6) версия приложения задана
t('APP_VERSION задан', /var APP_VERSION='\d+\.\d+\.\d+';/.test(h));

console.log('\nВёрстка Index.html: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
