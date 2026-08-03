const {chromium}=require('playwright-core');
const path=require('path'),fs=require('fs'),http=require('http');
const F=process.argv[2];const ROOT=path.dirname(F),FILE=path.basename(F);
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,(q.url.split('?')[0].slice(1))||FILE);
  if(!fs.existsSync(f))return r.writeHead(404).end();
  r.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});fs.createReadStream(f).pipe(r);});
srv.listen(0,async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://localhost:${srv.address().port}/${FILE}`,{waitUntil:'networkidle'});
  await p.waitForTimeout(1500);
  const ok=[],bad=[];
  const t=(n,c,x)=>{(c?ok:bad).push(n+(c?'':' → '+x));};

  // 1. Окно закрывается кнопкой «назад»
  await p.evaluate(()=>App.openModal('<div class="modal-title">Проверка</div>'));
  await p.waitForTimeout(300);
  let open=await p.evaluate(()=>document.getElementById('modal-overlay').classList.contains('show'));
  t('окно открылось',open);
  let layers=await p.evaluate(()=>App._layers.length);
  t('слой записан',layers===1,layers);
  await p.goBack(); await p.waitForTimeout(400);
  open=await p.evaluate(()=>document.getElementById('modal-overlay').classList.contains('show'));
  layers=await p.evaluate(()=>App._layers.length);
  t('«назад» закрыло окно',!open);
  t('слой снят',layers===0,layers);
  t('со страницы не ушли',p.url().includes(FILE));

  // 2. Крестик тоже снимает слой и не ломает историю
  await p.evaluate(()=>App.openModal('<div>1</div>'));
  await p.waitForTimeout(250);
  await p.evaluate(()=>App.closeModal());
  await p.waitForTimeout(400);
  open=await p.evaluate(()=>document.getElementById('modal-overlay').classList.contains('show'));
  layers=await p.evaluate(()=>App._layers.length);
  t('крестик закрыл окно',!open);
  t('слой снят и после крестика',layers===0,layers);

  // 3. Два окна подряд — «назад» снимает по одному
  await p.evaluate(()=>{App.openModal('<div>A</div>');});
  await p.waitForTimeout(200);
  await p.evaluate(()=>{App.openSheet('sheet-numpad');});
  await p.waitForTimeout(200);
  layers=await p.evaluate(()=>App._layers.length);
  t('два слоя',layers===2,layers);
  await p.goBack(); await p.waitForTimeout(350);
  layers=await p.evaluate(()=>App._layers.length);
  t('«назад» снял верхний, нижний остался',layers===1,layers);
  await p.goBack(); await p.waitForTimeout(350);
  layers=await p.evaluate(()=>App._layers.length);
  t('второе «назад» снял нижний',layers===0,layers);

  // 4. Разделы: «назад» возвращает в предыдущий
  await p.evaluate(()=>App.setTab('goods'));
  await p.waitForTimeout(500);
  await p.evaluate(()=>App.setTab('suppliers'));
  await p.waitForTimeout(600);
  let cur=await p.evaluate(()=>App._curTab);
  t('перешли в Поставщиков',cur==='suppliers',cur);
  await p.goBack(); await p.waitForTimeout(600);
  cur=await p.evaluate(()=>App._curTab);
  t('«назад» вернуло в Товары',cur==='goods',cur);

  // 5. Пока есть куда возвращаться — приложение не покидаем.
  await p.evaluate(()=>App.setTab('journal'));
  await p.waitForTimeout(500);
  await p.goBack(); await p.waitForTimeout(500);
  t('вернулись в приложение, а не наружу',p.url().includes(FILE),p.url());
  const alive=await p.evaluate(()=>!!(window.App&&App._curTab));
  t('приложение живое',alive);
  // С главной «назад» ВЫПУСКАЕТ — так ведёт себя телефон, ловушку не ставим.

  ok.forEach(x=>console.log('  ✓ '+x));
  bad.forEach(x=>console.log('  ✗ '+x));
  if(errs.length)console.log('ошибки страницы: '+errs.join(' | '));
  console.log('\nКнопка «назад»: '+ok.length+' passed, '+bad.length+' failed');
  await b.close(); srv.close(); process.exit(bad.length?1:0);
});
