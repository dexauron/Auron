// Чек по итогам смены: то, что видно на экране, и то, что уходит
// в WhatsApp, обязано совпадать — чек читают как документ.
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
function grab(name){
  var i=html.indexOf('  '+name+':function');
  if(i<0) throw new Error('нет метода '+name);
  var j=html.indexOf('{',i), d=0;
  for(var k=j;k<html.length;k++){ if(html[k]==='{')d++; else if(html[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return html.slice(html.indexOf(':',i)+1, j);
}
global.fmt=function(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');};
global.fmtDate=function(d){return d;};
var App={s:{orgName:'Way Market'},_e:function(v){return String(v==null?'':v);}};
App._receiptHtml=eval('('+grab('_receiptHtml')+')');
App._receiptText=eval('('+grab('_receiptText')+')');

var R={date:'2026-08-06',shift:'День',total:348000,diff:-1200,
  lines:[['Кассир','Мадина'],['Выручка наличными','₽ 300 000'],
         ['Оплачено поставщикам','−₽ 84 000']]};

// ── Экран и текст говорят одно и то же ───────────────────────────────
// Если отправленный чек разойдётся с показанным, спорить будут о том,
// какой из них настоящий.
var h=App._receiptHtml(R), txt=App._receiptText(R);
['Way Market','Мадина','300 000','84 000','348 000'].forEach(function(v){
  t('«'+v+'» есть на экране', h.indexOf(v)>=0);
  t('«'+v+'» есть в тексте', txt.indexOf(v)>=0);
});
t('смена названа и там и там',
  h.indexOf('смена День')>=0 && txt.indexOf('смена День')>=0);

// ── Расхождение по кассе ─────────────────────────────────────────────
// Самое важное число в чеке: из-за него разговаривают с кассиром.
t('недостача названа словом', /недостача/.test(h) && /недостача/.test(txt));
t('недостача со знаком минус', /недостача −₽ 1 200/.test(txt), txt);
t('и красным на экране', /недостача[\s\S]{0,40}/.test(h) && /var\(--neg\)/.test(h));
var over=App._receiptText({date:'d',shift:'',total:100,diff:500,lines:[]});
t('излишек назван излишком', /излишек \+₽ 500/.test(over), over);
var even=App._receiptText({date:'d',shift:'',total:100,diff:0,lines:[]});
t('сошлось — так и написано', /Касса: сходится/.test(even), even);
t('когда сошлось, минуса нет', !/−/.test(even.split('Касса')[1]));

// ── Мелочи, на которых чек ломается ──────────────────────────────────
t('без смены лишнего разделителя нет', !/·\s*смена\s*$/.test(
  App._receiptText({date:'d',shift:'',total:0,diff:0,lines:[]})));
// Магазин может быть ещё без названия — первый день работы.
var savedName=App.s.orgName; App.s.orgName='';
t('магазин без названия не рушит чек — пишем «Магазин»',
  /Магазин/.test(App._receiptText(R)));
t('и на экране тоже', /Магазин/.test(App._receiptHtml(R)));
App.s.orgName=savedName;
t('пустой список строк не рушит чек',
  App._receiptText({date:'d',shift:'',total:0,diff:0,lines:[]}).length>0);
t('текст переносится строками, а не в одну кучу',
  txt.split('\n').length>=6, txt.split('\n').length);

// ── Разметка и отправка ──────────────────────────────────────────────
t('рваный край рисуется маской, без картинок',
  /-webkit-mask:\s*\n?\s*radial-gradient/.test(html) && /mask-composite/.test(html));
t('бумага светлее окна — иначе зубцов не видно',
  /\.receipt\{[\s\S]{0,300}background:var\(--surface-2\)/.test(html));
t('чек показывается после записи смены', /App\._receiptHtml\(App\._lastReceipt\)/.test(html));
t('чек запоминается для отправки', /App\._lastReceipt=\{date:date/.test(html));
t('есть кнопка «Отправить»', /App\.shareReceipt\(\)/.test(html));
t('отправка берёт тот же чек', /_shareText=App\._receiptText\(r\)/.test(html));
t('без чека отправка не падает', /if\(!r\)\{App\.toast\('Чек не найден',true\);return;\}/.test(html));

console.log('\nЧек по смене: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
