// Правила движения. Задача не «есть ли анимация», а не мешает ли она.
// Ловим: анимацию тяжёлых свойств (дёргается вся страница), забытый
// prefers-reduced-motion, слишком долгие переходы, безлимитный стаггер
// в каталоге (10 000 плиток собирались бы минуту).
var fs=require('fs'), path=require('path');
var h=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var css=(h.match(/<style[^>]*>([\s\S]*?)<\/style>/)||[])[1]||'';
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// 1) в @keyframes меняем только transform/opacity/filter/цвет
var bad=[];
(css.match(/@keyframes[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g)||[]).forEach(function(kf){
  var name=(kf.match(/@keyframes\s+([\w-]+)/)||[])[1];
  var props=(kf.match(/[\s{;]([a-z-]+)\s*:/g)||[]).map(function(x){return x.replace(/[\s{;:]/g,'');});
  props.forEach(function(pr){
    if(/^(width|height|top|left|right|bottom|margin|padding|font-size)$/.test(pr))
      bad.push(name+' → '+pr);
  });
});
t('в анимациях нет тяжёлых свойств', bad.length===0, bad.slice(0,4).join(', '));

// 2) движение можно отключить одним правилом
t('prefers-reduced-motion обрабатывается', /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css));
var glob=css.match(/@media\s*\(\s*prefers-reduced-motion[^{]*\)\s*\{[\s\S]{0,400}?\}\s*\}/);
t('и отключается глобально (*), а не по одному классу',
  !!glob && /\*\s*,\s*\*::before/.test(glob[0]));

// 3) переходы не затянуты: обычные ≤ 0.45с
var slow=[];
(css.match(/(?:animation|transition)(?:-duration)?\s*:[^;}]+/g)||[]).forEach(function(d){
  (d.match(/(\d*\.?\d+)s/g)||[]).forEach(function(v){
    var sec=parseFloat(v);
    if(sec>0.45 && !/spin|shimmer|skel|gsslide|pulse/.test(d)) slow.push(d.trim().slice(0,44)+' ('+v+')');
  });
});
t('нет затянутых переходов (>0.45с)', slow.length===0, slow.slice(0,3).join(' | '));

// 4) стаггер в каталоге ограничен — есть правило для «всех остальных»
t('стаггер плиток каталога ограничен', /\.g-grid\s+\.g-card:nth-child\(n\+\d+\)/.test(css));
t('стаггер строк списков ограничен',   /\.row-anim>\*:nth-child\(n\+\d+\)/.test(css));

// 5) единые токены, а не магические числа в каждом месте
['--dur-fast','--dur-base','--dur-slow','--ease-out'].forEach(function(v){
  t('есть токен '+v, css.indexOf(v+':')>=0);
});
t('токены реально используются', (css.match(/var\(--dur-(fast|base|slow)\)/g)||[]).length>=8);

// 6) вход в приложение проигрывается один раз и класс снимается
t('вход в приложение снимает свой класс', /_appEntered/.test(h) && /remove\('app-enter'\)/.test(h));

console.log('\nДвижение: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
