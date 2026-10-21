// Deliberately narrow ingress for an ephemeral Cloudflare Quick Tunnel.
// The working application's loopback Host, Origin, CSRF and role checks stay intact.
import {createServer,request} from 'node:http';
export function quickOrigin(value) {
 const u=new URL(value);
 if(u.protocol!=='https:'||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(u.hostname)||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Неверный адрес Quick Tunnel');
 return u.origin;
}
const loopback=ip=>ip==='127.0.0.1'||ip==='::ffff:127.0.0.1';
const hop=['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];
function cleanHeaders(raw){
 const out={...raw},named=String(raw.connection||'').split(',').map(v=>v.trim().toLowerCase());
 for(const name of [...hop,...named])delete out[name];
 for(const name of Object.keys(out))if(name==='forwarded'||name.startsWith('x-forwarded-'))delete out[name];
 return out;
}
export function createTunnelGateway({upstreamPort,configured}) {
 if(!Number.isInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535||typeof configured!=='function')throw Error('Неверная настройка шлюза');
 let publicOrigin=null;
 const upstream='127.0.0.1:'+upstreamPort;
 const server=createServer((req,res)=>{
  const reject=(status,message)=>{req.resume();res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error:message}));};
  if(!loopback(req.socket.remoteAddress)||!publicOrigin)return reject(503,'Тестовый туннель не подключён');
  if(req.headers.host!==new URL(publicOrigin).host||req.headers['x-forwarded-proto']!=='https')return reject(403,'Недопустимый адрес или протокол');
  if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))return reject(400,'Неверный путь');
  let path;try{path=new URL(req.url,publicOrigin).pathname;}catch{return reject(400,'Неверный путь');}
  if(!configured())return reject(503,'Сначала создайте тестового владельца локально на сервере');
  if(path==='/api/bootstrap')return reject(403,'Первичная настройка доступна только локально');
  if(req.headers.origin&&req.headers.origin!==publicOrigin)return reject(403,'Внешний источник запрещён');
  if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return reject(403,'Внешний источник запрещён');
  if(!['GET','HEAD','POST'].includes(req.method))return reject(405,'Метод не поддерживается');
  const headers=cleanHeaders(req.headers);headers.host=upstream;
  if(headers.origin)headers.origin='http://'+upstream;
  const call=request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers},reply=>{
   const responseHeaders=cleanHeaders(reply.headers);
   if(reply.headers['set-cookie'])responseHeaders['set-cookie']=reply.headers['set-cookie'].map(cookie=>/;\s*secure(?:;|$)/i.test(cookie)?cookie:cookie+'; Secure');
   res.writeHead(reply.statusCode,responseHeaders);reply.on('error',()=>res.destroy());reply.pipe(res);
  });
  call.setTimeout(30000,()=>call.destroy());
  call.on('error',()=>{if(res.headersSent)res.destroy();else reject(502,'Нет связи с тестовым приложением. Результат сохранения не подтверждён.');});
  req.on('aborted',()=>call.destroy());res.on('close',()=>{if(!res.writableEnded)call.destroy();});req.pipe(call);
 });
 server.requestTimeout=35000;server.headersTimeout=15000;
 return {server,setOrigin(value){const next=quickOrigin(value);if(publicOrigin&&next!==publicOrigin)throw Error('Адрес туннеля изменился. Перезапустите тестовый запуск.');publicOrigin=next;},disable(){publicOrigin=null;}};
}
