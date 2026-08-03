// Окна: полные страницы вместо мини-окошек и кнопки во всех из них.
//
// Владелец: «мне не нравится как появляются мини-окошки — сделай
// полноценную страницу», «чтобы все нужные кнопки везде присутствовали:
// добавить, изменить, сохранить, отменить, удалить».
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

// Окна, которые открывает сам владелец, должны быть полной страницей.
var FULL=['openProductCard','openImport','openContractorForm','openObligForm',
 'openBudgetEdit','openShiftDetail','openRevision','openCompare','openTrash',
 'openAuditLog','openAddCashier','editDebtEntry','openPaymentForm','openDebtModal',
 'openRepForm','openTsDay','openTsEntry','openTsBonus','openTsEmpForm','openTsPerson'];
// Разбирать скобки внутри строк с onclick оказалось ненадёжно: в них
// живут и кавычки, и скобки, и экранирование. Проверяем проще и честнее
// — есть ли подпись полной страницы в теле функции до следующей.
function bodyOf(fn){
  var i=html.indexOf(fn+':function'); if(i<0)i=html.indexOf(fn+':async function');
  if(i<0)return null;
  var j=html.indexOf('App.openModal(',i); if(j<0)return null;
  var nxt=html.indexOf('\n  },',j);
  return html.slice(j, nxt>0?nxt:j+9000);
}
var notFull=FULL.filter(function(fn){var b=bodyOf(fn);return !b||!/,'(full|wide)'\)/.test(b);});
t('все окна владельца — полные страницы ('+FULL.length+')', notFull.length===0, notFull);

// На полной странице обязана быть ВИДИМАЯ кнопка выхода. Раньше её не
// было почти нигде: системная «назад» есть не у всех, а на компьютере
// её нет вовсе — человек оказывался заперт в окне.
t('у полной страницы есть шапка «Назад»', /<div class="modal-topbar">/.test(html));
t('шапка ставится автоматически всем полным окнам',
  /var head=isFull\?\('<div class="modal-topbar">'/.test(html));
t('кнопка «Назад» закрывает окно', /class="modal-back" onclick="App\.closeModal\(\)"/.test(html));
t('шапка липкая — видна на длинной форме', /\.modal-topbar\{position:sticky/.test(html));
t('в маленьком окне шапки нет', /\.modal-overlay:not\(\.full\) \.modal-topbar\{display:none;\}/.test(html));

// Поля по краям: на полной странице содержимое упиралось в край экрана.
t('у полной страницы есть поля по бокам',
  /padding:max\(18px,env\(safe-area-inset-top\)\) 16px calc\(var\(--safe-bot\) \+ 24px\)/.test(html));

// Запас снизу под нижнюю панель — на КАЖДОМ экране. Экраны со своим
// padding затирали общее правило, и последняя строка пряталась.
t('общее правило запаса снизу есть', /\.panel\{[\s\S]{0,220}padding-bottom:calc\(var\(--nav-h\)/.test(html));
var bad=(html.match(/class="panel" style="padding:0;"/g)||[]);
t('ни один экран не затирает запас снизу', bad.length===0, bad.length);
t('экраны со своим отступом сохраняют запас',
  (html.match(/class="panel" style="padding:0 0 calc\(var\(--nav-h\)/g)||[]).length===4);

// Формы табеля: сохранить, отменить, удалить.
['saveTsEntry','saveTsBonus','saveTsEmp','deleteTsEmp','tsDelete','saveSalaryPay'].forEach(function(f){
  t('есть действие: '+f, html.indexOf(f+':function')>0||html.indexOf(f+':async function')>0);
});
t('удаление спрашивает подтверждение',
  /tsDelete:async function[\s\S]{0,200}App\._confirm/.test(html) &&
  /deleteTsEmp:async function[\s\S]{0,200}App\._confirm/.test(html));

console.log('\nОкна и кнопки: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
