// Кнопка «назад» и слои окон.
//
// Владелец: «сделай, чтобы каждая кнопка имела своё окно». Разобрались:
// не хватало не окон, а возможности ВЕРНУТЬСЯ. Истории переходов в
// приложении не было вовсе, поэтому системная кнопка «назад» на телефоне
// не закрывала окно, а выбрасывала из приложения целиком.
//
// Живая проверка в браузере — .claude/skills/look/scripts/back.js
// (14 проверок: открытие, закрытие крестиком, два слоя, разделы).
// Здесь — то, что можно проверить по коду.
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

t('есть стек слоёв', /_layers:\[\]/.test(html));
t('открытие окна кладёт слой', /_pushLayer:function\(type,closeFn\)/.test(html));
t('модальное окно регистрируется', /App\._pushLayer\('modal',App\._closeModalNow\)/.test(html));
t('лист снизу регистрируется', /App\._pushLayer\('sheet',App\._closeSheetNow\)/.test(html));

// Главная ловушка: history.back() без записи в истории уводит СО
// СТРАНИЦЫ. Робот на это и напоролся — приложение закрылось.
t('назад только если запись легла', /if\(top&&top\.pushed\)\{ try\{ history\.back\(\)/.test(html));
t('запись помечается как удавшаяся', /pushed=true; \}catch\(e\)\{\}/.test(html));
t('без записи слой снимается напрямую', /if\(top\)\{ App\._popLayer\(\); return true; \}/.test(html));

// Закрытие идёт ОДНИМ путём, иначе история и экран разъезжаются.
t('крестик ведёт туда же, куда системная кнопка',
  /closeModal:function\(\)\{\s*App\._closeTop\(App\._closeModalNow\);/.test(html));
t('то же для листа снизу',
  /closeSheet:function\(\)\{\s*App\._closeTop\(App\._closeSheetNow\);/.test(html));

// Разделы тоже в истории.
t('переход в раздел пишется в историю', /history\.pushState\(\{auron:'tab',tab:tab\}/.test(html));
t('переключение вынесено отдельно', /_setTabRaw:function\(tab,btn\)/.test(html));
t('«назад» возвращает в предыдущий раздел', /App\._setTabRaw\(App\._tabStack\[App\._tabStack\.length-1\]\)/.test(html));
t('история разделов не растёт бесконечно', /if\(App\._tabStack\.length>10\)App\._tabStack\.shift\(\)/.test(html));

// Механизм должен быть готов с первой секунды.
t('запускается при старте приложения', /init:function\(\)\{[\s\S]{0,200}App\._navInit\(\);/.test(html));
t('подписка на «назад» одна', /if\(App\._navReady\)return; App\._navReady=true;/.test(html));

// Ловушку не ставим: с главной «назад» должен выпускать.
t('приложение не удерживает силой',
  html.indexOf('Ловушку не ставим')>0 &&
  !/base:1\},''\); \}catch\(e\)\{\}\n\s*\}\);/.test(html));

// Окно с неверным именем больше не роняет экран.
t('несуществующее окно не падает на null', /if\(!sh\)\{ App\.toast\('Окно не найдено',true\); return; \}/.test(html));

console.log('\nКнопка «назад»: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
