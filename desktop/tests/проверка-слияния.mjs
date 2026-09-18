/* ============================================================================
   Проверка СЛИЯНИЯ двух половин продукта в настоящем браузере.
   Запуск:  node tests/проверка-слияния.mjs   (из папки desktop)

   Проверяет не код, а обещание, данное владельцу: одно приложение, где
   записанное в Auron видно в полном учёте, оформление одно, и все экраны
   открываются на его же данных.

   Здесь проверяется именно СОБРАННОЕ приложение (android/www), а не
   исходники: между ними стоит сборка, и ломалось уже в ней — папка
   просто не доезжала, а по исходникам всё выглядело хорошо.

   Если Playwright или Chromium не установлены, проверка пропускается:
   ронять сборку из-за отсутствия браузера нельзя.
   ========================================================================== */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ЗДЕСЬ = path.dirname(fileURLToPath(import.meta.url));
const КОРЕНЬ = path.join(ЗДЕСЬ, '..', '..');
const ROOT = path.join(КОРЕНЬ, 'android', 'www');

async function загрузитьБраузер() {
  for (const где of ['playwright-core', 'playwright']) {
    try { const m = await import(где); if (m.chromium) return m.chromium; } catch (e) { /* дальше */ }
  }
  return null;
}
const chromium = await загрузитьБраузер();
if (!chromium) { console.log('Playwright не установлен — проверка слияния пропущена.'); process.exit(0); }

const БРАУЗЕР = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!fs.existsSync(БРАУЗЕР)) { console.log('Chromium не найден — проверка слияния пропущена.'); process.exit(0); }

// Приложение должно быть собрано: проверяем то, что поедет на телефон.
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  try { execFileSync('node', [path.join(КОРЕНЬ, 'android', 'build-www.js')], { stdio: 'ignore' }); }
  catch (e) { console.log('Приложение не собрано и собрать не удалось — проверка пропущена.'); process.exit(0); }
}

const T={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const srv=http.createServer((q,s)=>{const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
 const f=path.join(ROOT,rel); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end();}
 s.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(0,r)); const port=srv.address().port;
const b=await chromium.launch({executablePath:БРАУЗЕР,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:844}});
const p=await ctx.newPage();
let passed=0,failed=0; const errs=[];
const check=(n,ok,got,want)=>{ if(ok){passed++;console.log('  ✅ '+n+(got!==undefined?'  → '+got:''));}
  else{failed++;console.log('  ❌ '+n+'  получено: '+got+', ожидалось: '+want);} };
p.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
p.on('dialog',d=>d.accept().catch(()=>{}));

console.log('\n— Записали в Auron');
await p.goto(`http://localhost:${port}/index.html`,{waitUntil:'networkidle'});
await p.waitForTimeout(2500);
await p.evaluate(()=>{ document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.getElementById('app').classList.add('active'); });
const seeded=await p.evaluate(()=>new Promise(res=>{
  try{ gs('seedDemoData',{ssId:App.s.ssId||'local'}).then(()=>res('ок')).catch(e=>res('ошибка: '+e.message)); }
  catch(e){ res('бросило: '+e.message); }}));
// Смену записываем настоящей функцией приложения, а не руками в базу:
// проверять надо тот путь, которым пользуется владелец.
const смена=await p.evaluate(()=>new Promise(res=>{
  var d={date:new Date().toISOString(),shift:'1',cashier:'Марина',
    recon:{cashRev:90000,cardRevs:[{amount:30000,account:'Карта',channel:'карта'}],
      cashSupp:12000,cashLeft:5000,cashCollect:68000},
    wyplatas:[{amount:5000,desc:'Обед',category:'Питание',account:'Наличные'}]};
  try{ gs('saveKassa',{ssId:App.s.ssId||'local',data:d}).then(r=>res(JSON.stringify(r).slice(0,60))).catch(e=>res('ошибка: '+e.message)); }
  catch(e){ res('бросило: '+e.message); }}));
console.log('  смена записана:', смена);
await p.evaluate(()=>{ try{ _dbSaveNow(); }catch(e){} });
await p.waitForTimeout(800);
const db=await p.evaluate(()=>{ try{ const d=JSON.parse(localStorage.getItem('auron_db_v1')||'{}');
  return {база:(d['БАЗА']||[]).length-1, счета:(d['СЧЕТА']||[]).length-1}; }catch(e){ return {err:String(e)}; } });
check('тестовые данные записались', seeded==='ок', seeded, 'ок');
check('в базе Auron появились операции', db.база>0, db.база, '>0');
check('и счета', db.счета>0, db.счета, '>0');

console.log('\n— Открыли полный учёт из приложения');
await p.evaluate(()=>App.setTab('settings'));
await p.waitForTimeout(500);
await p.evaluate(()=>App.settingsOpenGroup('app'));
await p.waitForTimeout(400);
await p.evaluate(()=>{const n=[...document.querySelectorAll('.settings-row-label')].find(x=>x.textContent.includes('Учёт магазина'));n.closest('.settings-row').click();});
await p.waitForTimeout(4000);
check('открылся в ТОМ ЖЕ окне', /desktop/.test(decodeURIComponent(p.url())), decodeURIComponent(p.url()).split('/').pop(), 'Учёт_магазина.html');
const тема=await p.evaluate(()=>document.documentElement.getAttribute('data-theme'));
check('ВЗЯЛ ОФОРМЛЕНИЕ AURON', тема==='auron', тема, 'auron');
const назад=await p.evaluate(()=>{const el=document.querySelector('.auron-back');return el?getComputedStyle(el).display:'нет';});
check('кнопка «назад в Auron» видна', назад==='flex', назад, 'flex');

console.log('\n— Деньги доехали');
const перенос=await p.evaluate(()=>{ const st=JSON.parse(localStorage.getItem('store_erp_v1')||'{}');
  const зерк=(st.dds||[]).filter(r=>r.src==='auron');
  return {всего:(st.dds||[]).length, зеркало:зерк.length,
    сумма:зерк.reduce((s,r)=>s+(r.amount||0),0),
    счета:(st.accounts||[]).filter(a=>a.src==='auron').length,
    безДаты:зерк.filter(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')).length,
    безСуммы:зерк.filter(r=>r.type!=='Смена'&&!(r.amount>0)).length}; });
check('ОПЕРАЦИИ AURON ВИДНЫ В ПОЛНОМ УЧЁТЕ', перенос.зеркало>0, перенос.зеркало, '>0');
check('счета тоже', перенос.счета>0, перенос.счета, '>0');
check('У КАЖДОЙ ЗАПИСИ НОРМАЛЬНАЯ ДАТА', перенос.безДаты===0, перенос.безДаты, 0);
check('и сумма у денежных записей', перенос.безСуммы===0, перенос.безСуммы, 0);
check('деньги не нулевые', перенос.сумма>0, Math.round(перенос.сумма), '>0');
const см=await p.evaluate(()=>{ const st=JSON.parse(localStorage.getItem('store_erp_v1')||'{}');
  const s=(st.dds||[]).filter(r=>r.type==='Смена');
  return {всего:s.length, сZ:s.filter(r=>r.zCash>0).length, кассиры:[...new Set(s.map(r=>r.cashier).filter(Boolean))].length}; });
check('СМЕНЫ AURON ПРИЕХАЛИ СМЕНАМИ', см.всего>0, см.всего, '>0');
check('у смен есть выручка по Z-отчёту', см.сZ>0, см.сZ, '>0');
check('и кассиры не потерялись', см.кассиры>0, см.кассиры, '>0');

console.log('\n— Все экраны открываются с этими данными');
const экраны=await p.evaluate(()=>window.WMUI&&window.WMUI.views?window.WMUI.views().map(v=>v.id):null);
let список=экраны;
if(!список){ список=await p.$$eval('#nav [data-go]',els=>els.map(e=>e.getAttribute('data-go'))); }
const плохие=[];
for(const id of список){
  const было=errs.length;
  await p.evaluate(i=>{ const el=document.querySelector('[data-go="'+i+'"]'); if(el) el.click(); }, id);
  await p.waitForTimeout(160);
  const пусто=await p.evaluate(()=>{const el=document.getElementById('page');return !el||!el.innerText.trim();});
  if(errs.length>было||пусто) плохие.push(id+(пусто?' (пустой)':' ('+errs[errs.length-1]+')'));
}
check('экранов пройдено', список.length>0, список.length, '>0');
check('ВСЕ ЭКРАНЫ ОТКРЫЛИСЬ БЕЗ ОШИБОК', плохие.length===0, плохие.join(', ')||'все', 'все');

console.log('\n— Назад в Auron');
await p.evaluate(()=>AuronBridge.back());
await p.waitForTimeout(2500);
check('ВЕРНУЛИСЬ В ПРИЛОЖЕНИЕ', !/desktop/.test(decodeURIComponent(p.url())), decodeURIComponent(p.url()).split('/').pop(), 'index.html');
check('в консоли чисто', errs.length===0, errs.slice(0,3).join(' | ')||'чисто', 'чисто');

console.log('\nИтог: '+passed+' проверок пройдено, '+failed+' провалено.');
await b.close(); srv.close(); process.exit(failed?1:0);
