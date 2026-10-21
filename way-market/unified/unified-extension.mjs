import {goodsDocuments} from './goods-documents.mjs';
import {goodsWorkbook} from './goods-export.mjs';
import {onecExchange} from './onec-exchange.mjs';
import {InputError} from './workspace/domain.mjs';
import {unifiedCommands,financeDevice} from './unified-commands.mjs';
import {businessDate,businessRange,businessMoney} from './unified-business.mjs';
import {productOptions} from './unified-product-options.mjs';
import {parseUnifiedAgreement} from './unified-agreement.mjs';
import {unifiedCalendar} from './unified-calendar.mjs';
import {unifiedOrderMethods} from './unified-orders.mjs';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {AccessError} from './workspace/access.mjs';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.webp':'image/webp','.jpg':'image/jpeg','.enc':'application/octet-stream'};
export function createUnifiedExtension(root,data,workspace){
 const goods=workspace?goodsDocuments(workspace):null;
 const onec=workspace?onecExchange(workspace):null;
 const orders=workspace?unifiedOrderMethods(workspace):null;
 const commands=workspace?unifiedCommands(workspace,data):null;
 const served=async({req,res,headers,path},folder,suffix,finance=false)=>{
  let decoded;try{decoded=decodeURIComponent(suffix);}catch{res.writeHead(400);res.end();return true;}
  if(decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(x=>x.startsWith('.'))){res.writeHead(403);res.end();return true;}
  const base=resolve(root,folder),file=resolve(base,'.'+decoded+(decoded.endsWith('/')?'index.html':''));
  if(relative(base,file).startsWith('..'))throw new AccessError();
  let body,type=MIME[extname(file)]||'application/octet-stream';
  if(decoded==='/sw.js'){
   // All protected API responses remain network-only. Never cache sessions or finance.
   body="self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));";
  }else if(finance&&decoded==='/js/config.js')body="window.SUPABASE_URL='/integration';window.SUPABASE_ANON_KEY='';";
  else {try{const actual=await realpath(file);if(relative(base,actual).startsWith('..')||!(await stat(actual)).isFile())throw new AccessError();body=await readFile(actual);}catch(e){if(e.code==='ENOENT'){res.writeHead(404,headers);res.end();return true;}throw e;}}
  if(finance&&decoded==='/js/api.js'){
   body=body.toString().replace(/function periodRange\(period\) \{[\s\S]*?\n  \}/, 'function periodRange(period){return window.wayBusiness.range(period);}');
   body="window.wayBusiness=(()=>{"+businessDate.toString()+";"+businessRange.toString()+";"+businessMoney.toString()+";return {date:businessDate,range:businessRange,money:businessMoney};})();\n"+body;
   body=body.replace('type:          r.type,','type:          r.type,\n      transfer: !!r.transfer,');
   body=body.replace('const now  = new Date();',"const now  = new Date(window.wayBusiness.date()+'T12:00:00Z');").replace('from.setDate(now.getDate() - 90);','from.setUTCDate(now.getUTCDate()-90);');
   body=body.replace('periodRows.forEach(r => {','periodRows.forEach(r => {\n      if(r.transfer)return;');
   body=body.replace('rows.forEach(r => {\n      const amt', 'rows.forEach(r => {\n      if(r.transfer)return;\n      const amt');
   body=body.replace("if (tx.type === 'income')  seen","if (!tx.transfer && tx.type === 'income')  seen").replace("if (tx.type === 'expense') seen","if (!tx.transfer && tx.type === 'expense') seen");
  }
  if(type.startsWith('text/html')){
   body=body.toString();
   if(finance){body=body.replace(/function fmtRub\(kopecks\) \{[\s\S]*?\n  \}/, 'function fmtRub(kopecks){return window.wayBusiness.money(kopecks);}').replace('function today() { return new Date().toISOString().slice(0, 10); }','function today() { return window.wayBusiness.date(); }').replace("if (dateStr === now.toISOString().slice(0, 10))","if (dateStr === today())").replace("const yest = new Date(now); yest.setDate(now.getDate() - 1);","const yest = new Date(today()+'T12:00:00Z'); yest.setUTCDate(yest.getUTCDate()-1);");body=body.replace('groups[tx.date][tx.type] += tx.amountKopecks;', 'if(!tx.transfer)groups[tx.date][tx.type] += tx.amountKopecks;');body=body.replace('const App = (() => {','window.App = (() => {');body=body.replace('<script src="./js/api.js"></script>','<script src="./js/api.js"></script><script src="/unified/finance-adapter.js"></script>');body=body.replace(/P&amp;L|P&L/g,'Движение денег');body=body.replace('initHeaderActions();',"initHeaderActions(); const desiredTab = new URLSearchParams(location.search).get('tab'); if (['home','analytics','journal','kassa','settings'].includes(desiredTab)) navigate(desiredTab); window.wayFinanceReady=true; document.dispatchEvent(new Event('way:finance-ready'));");}
   if(!finance)body=body.replace('Пароль каталога (ваш)','Пароль аккаунта').replace('Пароль сотрудника','Доступ сотрудников').replace('Только выгнать все устройства сотрудников','Управление доступом сотрудников');
   body=body.replace(/,?maximum-scale=1|,?user-scalable=no/g,'');
   body=body.replace(/<title>[^<]*<\/title>/,'<title>Way Market · '+(finance?'Финансы':'Каталог')+'</title>');
   body=body.replace('</head>','<link rel="stylesheet" href="/unified/shell.css"><script type="module" src="/unified/shell.js"></script></head>');
  }
  // Runtime changes are separate, original source files stay untouched.
  if(folder==='catalog'&&decoded==='/js/modules/data.js')body=body.toString().replace('export async function loadCache() {','export async function loadCache() {\n  return false; // Protected shared data is fetched for the current account.').replace('export function saveCache() {','export function saveCache() {\n  return; // Do not persist private fields in the legacy unscoped cache.');
  if(folder==='catalog'&&decoded==='/js/modules/app.js')body=body.toString().replace('async function init() {','async function init() {\n  await import("/unified/catalog-adapter.js").then(m=>m.initialize());').replace("const saved = JSON.parse(localStorage.getItem(SV_AUTH_KEY) || 'null');",'const saved = null; // One shared account, no legacy password recovery.');
  if(folder==='catalog'&&decoded==='/js/modules/imports.js'){
   body=body.toString().replace('export async function svSaveAndPublish(okMsg) {','export async function svSaveAndPublish(okMsg) {\n  if(ui.unifiedSave) return ui.unifiedSave(okMsg);').replace("export async function refresh({ silent = false } = {}) {","export async function refresh({ silent = false } = {}) {\n  if(ui.unifiedRefresh) return ui.unifiedRefresh();");
  }
  if(folder==='catalog'&&decoded==='/js/modules/catalog.js')body=body.toString().replace('export const todayISO = () => localISO(new Date());','export const todayISO = '+businessDate.toString()+';').replace('export const daysAgoISO = (n) => localISO(new Date(Date.now() - n * 86400000));',"export const daysAgoISO = (n) => {const date=new Date(todayISO()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-n);return date.toISOString().slice(0,10);};");
  if(folder==='catalog'&&decoded==='/js/modules/card.js')body=body.toString().replace('state.isAdmin && ghConfigured()', 'state.isAdmin && (ghConfigured() || ui.unifiedSave)');
  if(folder==='catalog'&&decoded==='/js/modules/competitors.js')body=body.toString().replace('if (!ghConfigured())','if (!ghConfigured() && !ui.unifiedSave)').replace('if (!ui.secretPw)','if (!ui.secretPw && !ui.unifiedSave)').replace('new Date().toISOString().slice(0, 10)','('+businessDate.toString().replace(/\n/g,' ')+')()');
  if(folder==='catalog'&&decoded==='/js/modules/render.js')body=body.toString().replace('export function toggleTheme() {','export function toggleTheme() {\n  if(window.waySetTheme) return window.waySetTheme();');
  if(folder==='catalog'&&decoded==='/js/modules/publish.js')body=body.toString().replace('export async function publishFull(password, { onProgress = null, rotate = false } = {}) {','export async function publishFull(password, { onProgress = null, rotate = false } = {}) {\n  if(ui.unifiedSave) return ui.unifiedSave("Сохранено в Way Market");');
  const policy="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  res.writeHead(200,{...headers,'Content-Type':type,'Content-Security-Policy':policy});res.end(req.method==='HEAD'?undefined:body);return true;
 };
 return async ctx=>{
  const {req,path,actor,token,url,payload,send}=ctx;
  if(goods&&path.startsWith('/api/unified/goods')){
   if(req.method==='GET'&&path==='/api/unified/goods'){send(200,goods.list(token));return true;}
   if(req.method==='GET'&&path==='/api/unified/goods/products'){send(200,goods.products(token,url.searchParams.get('q')||''));return true;}
   const match=/^\/api\/unified\/goods\/documents\/([a-f0-9-]{36})(?:\/(history|export|contract))?$/.exec(path);
   if(req.method==='GET'&&match){
    const [,id,action]=match;
    if(action==='history')send(200,goods.history(token,id));
    else if(action==='export'||action==='contract'){
     const v=url.searchParams.get('version'),version=v&&/^\d+$/.test(v)?Number(v):null,envelope=goods.export(token,id,version);
     if(action==='contract')send(200,envelope);
     else{const bytes=goodsWorkbook(envelope);ctx.res.writeHead(200,{...ctx.headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+envelope.document.number+'.xlsx"'});ctx.res.end(bytes);}
    }else send(200,goods.get(token,id));return true;
   }
   const action={'/api/unified/goods/save':'save','/api/unified/goods/transition':'transition','/api/unified/goods/articles':'saveArticles'}[path];
   if(req.method==='POST'&&action){send(200,goods[action](token,payload));return true;}
  }
  if(onec&&path.startsWith('/api/unified/1c')){
   if(req.method==='GET'&&path==='/api/unified/1c'){send(200,onec.state(token));return true;}
   if(req.method==='GET'&&path.startsWith('/api/unified/1c/stages/')){send(200,onec.stage(token,path.slice('/api/unified/1c/stages/'.length)));return true;}
   const action={'/api/unified/1c/profile':'saveProfile','/api/unified/1c/preview':'preview','/api/unified/1c/apply':'apply'}[path];
   if(req.method==='POST'&&action){send(200,onec[action](token,payload));return true;}
  }

  if(commands&&path.startsWith('/api/unified/commands')){
   const device=financeDevice(req,token);
   if(req.method==='GET'&&path==='/api/unified/commands'){send(200,commands.list(token,device));return true;}
   if(req.method==='POST'&&path==='/api/unified/commands/prepare'){send(200,commands.prepare(token,device,payload));return true;}
   if(req.method==='POST'&&path==='/api/unified/commands/execute'){const result=commands.execute(token,device,payload?.id);send(result.ok?200:422,result);return true;}
   if(req.method==='POST'&&path==='/api/unified/commands/dismiss'){send(200,commands.dismiss(token,device,payload?.id));return true;}
  }
  if(workspace&&req.method==='GET'&&path==='/api/unified/product-options'){send(200,productOptions(workspace,token,url.searchParams.get('q')||''));return true;}
  if(workspace&&req.method==='POST'&&path==='/api/unified/parse-agreement'){send(200,parseUnifiedAgreement(workspace,token,payload));return true;}
  if(workspace&&req.method==='GET'&&path==='/api/unified/calendar'){send(200,unifiedCalendar(workspace,token));return true;}
  if(orders&&req.method==='GET'&&path==='/api/unified/orders'){send(200,orders.list(token));return true;}
  if(orders&&req.method==='POST'&&path==='/api/unified/orders/convert'){send(200,orders.convert(token,payload));return true;}
  if(req.method==='GET'&&path.startsWith('/integration/rest/v1/')){if(!['owner','accountant'].includes(actor.role))throw new AccessError();send(200,data.financeRead(token,path.slice('/integration/rest/v1/'.length),url.searchParams));return true;}
  if(req.method==='GET'&&path==='/api/unified/catalog'){send(200,data.catalog(token));return true;}
  if(req.method==='POST'&&path==='/api/unified/seed'){send(200,data.seed(token));return true;}
  if(req.method==='POST'&&path==='/api/unified/finance'){if(payload?.method==='saveShift')throw new InputError('Сдача и приём смены выполняются в кассовом листе по Excel-форме: раздел «Касса»');send(200,data.financeWrite(token,payload));return true;}
  if(req.method==='POST'&&path==='/api/unified/preferences'){send(200,data.preferences(token,payload));return true;}
  if(req.method==='POST'&&path==='/api/unified/catalog-save'){send(200,data.catalogSave(token,payload));return true;}
  if(['GET','HEAD'].includes(req.method)){
   if(path.startsWith('/catalog/'))return served(ctx,'catalog',path.slice('/catalog'.length));
   if(path.startsWith('/finance/')){if(!['owner','accountant'].includes(actor.role))throw new AccessError();if(url.searchParams.get('tab')==='kassa'){ctx.res.writeHead(303,{...ctx.headers,Location:'/?view=cash'});ctx.res.end();return true;}return served(ctx,'finance',path.slice('/finance'.length),true);}
   if(path.startsWith('/unified/'))return served(ctx,'unified',path.slice('/unified'.length));
  }
  return false;
 };
}
