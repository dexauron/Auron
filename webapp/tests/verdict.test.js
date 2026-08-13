// «Норма или не норма» под цифрой: сравнение с прошлым таким же отрезком.
// Решение владельца: цифра сама по себе ничего не говорит непрограммисту.
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
function grab(name){
  var i=html.indexOf('  '+name+':function');
  if(i<0) throw new Error('нет метода '+name);
  var j=html.indexOf('{',i), d=0;
  for(var k=j;k<html.length;k++){ if(html[k]==='{')d++; else if(html[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return html.slice(html.indexOf(':',i)+1, j);
}
var _verdict=eval('('+grab('_verdict')+')');

// ── Сравнивать не с чем ──────────────────────────────────────────────
// Первый месяц работы, или в прошлом отрезке не было ни одной записи.
// Тогда честнее промолчать, чем написать «рост на 100%».
t('нет прошлого — молчим', _verdict(100,null,'up')===null);
t('в прошлом ноль — молчим', _verdict(100,0,'up')===null);
t('в прошлом мусор — молчим', _verdict(100,NaN,'up')===null);

// ── Порог шума ───────────────────────────────────────────────────────
// Торговля колеблется каждый день. Если подписывать «выросло» на любое
// движение, владелец перестанет читать подписи вообще.
t('+5% — это как обычно', _verdict(105,100,'up').text==='как обычно');
t('−7% — тоже как обычно', _verdict(93,100,'up').text==='как обычно');
t('ровно столько же', _verdict(100,100,'up').text==='как обычно');
t('«как обычно» цветом не кричит', _verdict(100,100,'up').tone==='flat');

// ── Рост выручки — хорошо, рост расхода — плохо ──────────────────────
var incUp=_verdict(150,100,'up');
t('выручка выросла — это хорошо', incUp.tone==='good', incUp.tone);
t('и сказано словами', /выше обычного на 50%/.test(incUp.text), incUp.text);
var incDn=_verdict(50,100,'up');
t('выручка упала — это плохо', incDn.tone==='bad');
t('падение названо падением', /ниже обычного на 50%/.test(incDn.text), incDn.text);

var expUp=_verdict(150,100,'dn');
t('расход вырос — это плохо', expUp.tone==='bad', expUp.tone);
var expDn=_verdict(50,100,'dn');
t('расход упал — это хорошо', expDn.tone==='good', expDn.tone);

// ── Убыток ───────────────────────────────────────────────────────────
// Прибыль бывает отрицательной, и деление на неё меняло бы знак.
// Поэтому в знаменателе модуль: «−50 против −100» это улучшение.
var loss=_verdict(-50,-100,'up');
t('убыток стал вдвое меньше — это хорошо', loss.tone==='good', loss.tone);
var worse=_verdict(-200,-100,'up');
t('убыток вырос вдвое — это плохо', worse.tone==='bad', worse.tone);

// ── Сервер отдаёт прошлый период ─────────────────────────────────────
t('прошлый отрезок считается', /var pFrom=null,pTo=null,pInc=0,pExp=0;/.test(code));
t('длина отрезка берётся от текущего',
  /var len=pd\.to-pd\.from; pTo=pd\.from-1; pFrom=pd\.from-len-1;/.test(code));
t('переводы между своими счетами не считаются доходом',
  /if\(pFrom!==null[\s\S]{0,260}!=='Перевод'/.test(code));
t('прошлый период уходит на телефон', /prev:\{income:Math\.round\(pInc\)/.test(code));
t('маржа прошлого периода тоже', /margin:pInc>0\?Math\.round\(\(pInc-pExp\)\/pInc\*100\):null/.test(code));
// Прошлый период не должен стоить второго обращения к таблице: лист
// и так читается целиком, а даты отбираются уже в памяти. Иначе на
// 22 000 строк истории мы бы вдвое приблизились к лимиту в 6 минут.
var anBody=(function(){
  var i=code.indexOf('function getAnalytics('), d=0, j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){ if(code[k]==='{')d++; else if(code[k]==='}'){d--; if(!d)return code.slice(i,k+1);} }
  return '';
})();
t('getAnalytics найдена', anBody.length>500);
t('таблица читается один раз за вызов',
  (anBody.match(/getRange\(2,1,[^)]*getLastRow\(\)-1,B_COLS\)/g)||[]).length===1,
  (anBody.match(/getRange\(2,1,[^)]*getLastRow\(\)-1,B_COLS\)/g)||[]).length);
t('прошлый период отбирается в том же проходе по строкам',
  /rows\.forEach\(function\(r\)\{[\s\S]{0,400}pFrom!==null/.test(anBody));

// ── Подпись доходит до экрана ────────────────────────────────────────
t('подпись под выручкой', /class="metric-label">Выручка[\s\S]{0,140}'\+vI\+'/.test(html));
t('подпись под расходами', /class="metric-label">Расходы[\s\S]{0,140}'\+vE\+'/.test(html));
t('подпись под прибылью', /'\+vP\+/.test(html));
t('маржа подписана и прошлым значением', /было '\+pv\.margin\+'%/.test(html));

console.log('\nНорма или не норма: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
