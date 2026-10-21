// CommonJS preflight stays readable even on an unsupported Node installation.
'use strict';
const {existsSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
function diagnose(error){
 const messages={EADDRINUSE:'Порт 3211 уже занят. Если прежнее окно Way Market открыто, откройте http://127.0.0.1:3211 в браузере. Для обновления сначала закройте прежний сервер.',EACCES:'Нет доступа к папке данных или к локальному порту. Проверьте сообщение ниже; не удаляйте базу.',EPERM:'Windows запретила доступ к файлу. Проверьте права на папку приложения и данных; не удаляйте базу.',ENOENT:'Не найден необходимый файл. Извлеките ВЕСЬ архив приложения в отдельную папку и запустите start-way-market.cmd оттуда.'};
 return messages[error.code]||'Приложение не запустилось. Пришлите текст ошибки ниже или снимок этого окна.';
}
function preflight(version=process.versions.node,hasFile=existsSync){
 if(Number(version.split('.')[0])!==24)throw Object.assign(Error('Нужен Node.js 24. Сейчас установлен: '+version+'. После установки версии 24 заново откройте start-way-market.cmd.'),{code:'WAY_NODE_VERSION'});
 for(const file of ['start.mjs','unified-extension.mjs','workspace/workspace/index.html','workspace/workspace/startup.js','workspace/workspace/app.mjs','workspace/workspace/list-controls.mjs','workspace/workspace/request-id.mjs','workspace/workspace-store.mjs','catalog/data/index.json','finance/index.html'])if(!hasFile(join(__dirname,file)))throw Object.assign(Error('Отсутствует файл: '+file),{code:'ENOENT'});
}
function openBrowser(url,platform=process.platform,run=spawn){
 const command=platform==='win32'?['cmd.exe',['/d','/s','/c','start "" "'+url+'"']]:platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 return new Promise(resolve=>{let child;try{child=run(command[0],command[1],{stdio:'ignore',windowsHide:true});}catch{return resolve(false);}child.once('error',()=>resolve(false));child.once('exit',code=>resolve(code===0));});
}
async function launch({load=()=>import(pathToFileURL(join(__dirname,'start.mjs')).href),browser=openBrowser,options,version}={}){
 preflight(version);const {startSuite}=await load();const suite=await startSuite(options);
 const url='http://127.0.0.1:'+suite.server.address().port;
 const opened=await browser(url).catch(()=>false);
 console.log(opened?'Приложение открыто в браузере.':'Браузер не открылся автоматически. Откройте вручную: '+url);
 console.log('Оставьте это окно открытым во время работы. Для остановки сервера нажмите Ctrl+C.');
 return suite;
}
function report(error){
 console.error('\nWAY MARKET — ОШИБКА ЗАПУСКА\n'+diagnose(error)+'\n'+(error.code||error.name||'Error')+': '+error.message);
 // Only startup failures are logged: the owner's one-time setup code and sessions are not copied here.
 try{writeFileSync(join(__dirname,'launch-error.txt'),'Way Market 0.16\n'+new Date().toISOString()+'\nNode '+process.versions.node+'\n'+process.platform+' '+process.arch+'\n'+(error.code||error.name)+': '+error.message+'\n',{mode:0o600});console.error('Подробности записаны в launch-error.txt рядом с файлом запуска.');}catch{}
 process.exitCode=1;
}
module.exports={preflight,diagnose,openBrowser,launch};
if(require.main===module){launch().then(suite=>{let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(stopping)return;stopping=true;suite.close().catch(report);});}).catch(report);}
