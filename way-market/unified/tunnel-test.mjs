// Test-only launcher. Never opens the ordinary working database or edits router/DNS.
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {startSuite} from './start.mjs';
import {createTunnelGateway,quickOrigin} from './tunnel-gateway.mjs';
import launcher from './launch.cjs';
// Internet sessions end after 14 days or 3 days without use; local launch keeps sign-in until logout.
export const TUNNEL_SESSIONS=Object.freeze({absoluteMs:14*86400000,idleMs:3*86400000});
export const testDirectory=(platform=process.platform,env=process.env,home=homedir())=>platform==='win32'?join(env.ProgramData||home,'WayMarket-Quick-Tunnel-Test'):join(home,'.way-market-quick-tunnel-test');
export function quickUrlFromLog(line){const value=/https:\/\/[-a-z0-9]+\.trycloudflare\.com\b/.exec(line)?.[0];return value?quickOrigin(value):null;}
async function checkCloudflared(){
 await new Promise((ok,fail)=>{const child=spawn('cloudflared',['--version'],{stdio:'ignore',windowsHide:true});child.once('error',()=>fail(Error('cloudflared не найден. Установите официальный cloudflared и заново откройте окно запуска.')));child.once('exit',code=>code===0?ok():fail(Error('Не удалось выполнить cloudflared --version')));});
}
export async function main(){
 launcher.preflight();await checkCloudflared();
 const suite=await startSuite({dataDirectory:testDirectory(),port:0,sessions:TUNNEL_SESSIONS});let child,gateway,rl,closing=false;
 async function close(){if(closing)return;closing=true;gateway?.disable();if(child&&!child.killed)child.kill();if(gateway){gateway.server.closeAllConnections();await new Promise(r=>gateway.server.close(r));}rl?.close();await suite.close();}
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{close().then(()=>process.exit(0));});
 try {
  const local='http://127.0.0.1:'+suite.server.address().port;
  console.log('\nОТДЕЛЬНАЯ ТЕСТОВАЯ БАЗА: '+testDirectory());
  console.log('Используйте вымышленные аккаунты и данные. Доступ будет идти через Cloudflare.');
  console.log('Локальный адрес: '+local);await launcher.openBrowser(local);
  if(!suite.workspace.accounts.configured()){
   rl=createInterface({input:process.stdin,output:process.stdout});
   while(!suite.workspace.accounts.configured())await rl.question('Создайте тестового владельца в браузере с кодом выше. После создания нажмите Enter здесь. ');
   rl.close();rl=null;
  }
  gateway=createTunnelGateway({upstreamPort:suite.server.address().port,configured:()=>suite.workspace.accounts.configured()});
  await new Promise((ok,fail)=>{gateway.server.once('error',fail);gateway.server.listen(0,'127.0.0.1',ok);});
  child=spawn('cloudflared',['tunnel','--url','http://127.0.0.1:'+gateway.server.address().port,'--protocol','http2','--no-autoupdate'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let announced=false,buffer='';
  const timer=setTimeout(()=>{if(!announced){console.error('Не удалось получить адрес туннеля за 90 секунд. Проверьте доступность Cloudflare в сети; тестовый запуск остановлен.');close().then(()=>process.exit(1));}},90000);timer.unref();
  const onData=chunk=>{
   buffer=(buffer+chunk.toString('utf8')).slice(-32768);
   const lines=buffer.split(/\r?\n/);buffer=lines.pop();
   for(const line of lines){
    const url=quickUrlFromLog(line);
    if(url){try{gateway.setOrigin(url);}catch(error){console.error(error.message);close().then(()=>process.exit(1));return;}
     if(!announced){announced=true;clearTimeout(timer);console.log('\nТЕСТОВЫЙ АДРЕС: '+url+'\nОткройте его с телефона без Wi-Fi и VPN. Войдите тестовым аккаунтом.\nАдрес временный: после перезапуска он может измениться. Для остановки — Ctrl+C.');}
    }else if(/ERR|error|failed|config\.ya?ml/i.test(line))console.error(line.slice(0,1600));
   }
  };
  child.stdout.on('data',onData);child.stderr.on('data',onData);
  child.once('error',error=>{clearTimeout(timer);console.error('cloudflared не запустился: '+error.message);close().then(()=>process.exit(1));});
  child.once('exit',()=>{clearTimeout(timer);if(!closing){console.error('Соединение Cloudflare завершено. Тестовый запуск остановлен.');close().then(()=>process.exit(1));}});
 }catch(error){await close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
