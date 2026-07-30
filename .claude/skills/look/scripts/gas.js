// Подготовка webapp/Index.html к снимку.
//
// Файл живёт внутри Google Apps Script и сам по себе в браузере пустой:
// сервера нет, поэтому все вызовы google.script.run повисают, и экран не
// доходит до отрисовки. Здесь мы подставляем заглушку сервера — вёрстку
// это показывает честно, данные, разумеется, нет.
//
//   node .claude/skills/look/scripts/gas.js webapp/Index.html /tmp/out.html
//   node .claude/skills/look/scripts/shot.js /tmp/out.html
//
// Что видно на таком снимке: отступы, ширины, шрифты, поведение на широком
// экране, переносы длинного текста, пустые состояния.
// Чего НЕ видно: реальные цифры, списки, всё что приходит с сервера.
// Не выдавай такой снимок за проверку работы приложения.
const fs = require('fs');
const src0 = process.argv[2] || 'webapp/Index.html';
const dst  = process.argv[3] || '/tmp/gas-preview.html';

let src = fs.readFileSync(src0, 'utf8');

// Шаблонные вставки Apps Script (<?= name ?>) браузер не понимает.
src = src.replace(/<\?[!=]?=?\s*[\w.]+\s*\?>/g, '');

// Заглушка: любой серверный вызов «успешно» отвечает пустым объектом.
// Экран при этом показывает пустые состояния — их как раз полезно увидеть.
const stub = `<script>
(function(){
  var api={ withSuccessHandler:function(f){api._ok=f;return proxy;},
            withFailureHandler:function(f){api._err=f;return proxy;},
            withUserObject:function(){return proxy;} };
  var proxy=new Proxy(api,{get:function(t,k){
    if(k in t) return t[k];
    return function(){ var ok=t._ok; setTimeout(function(){ ok&&ok({}); },30); };
  }});
  Object.defineProperty(window,'google',{writable:true,value:{script:{
    run:proxy,
    host:{close:function(){},setHeight:function(){},editor:{focus:function(){}}},
    url:{getLocation:function(f){f({parameter:{},hash:''});}}
  }}});
})();
</script>`;

fs.writeFileSync(dst, src.replace('</head>', stub + '\n</head>'), 'utf8');
console.log('готово →', dst);
