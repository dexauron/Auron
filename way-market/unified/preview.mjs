// Isolated browser QA only. No working database, persistent credentials or backups.
import {createServer,request} from 'node:http';
import {randomBytes} from 'node:crypto';
import {openWorkspace} from './workspace/workspace-store.mjs';
import {createWorkspaceServer} from './workspace/workspace-server.mjs';
import {sourceCatalog,root} from './start.mjs';
import {createUnifiedData} from './unified-data.mjs';
import {createUnifiedExtension} from './unified-extension.mjs';
const w=openWorkspace(':memory:');
// Start unconfigured by default, matching a user's real first launch.
let session=null;
if(process.env.WAY_PREVIEW_AUTH==='1'){
 const password=randomBytes(32).toString('hex');
 await w.accounts.bootstrapOwner({login:'preview',name:'Проверка интерфейса',password});
 session=await w.accounts.login({login:'preview',password});
}
const source=await sourceCatalog(),data=createUnifiedData(w,source.products,source.groups);
const {server}=createWorkspaceServer(w,{extension:createUnifiedExtension(root,data,w)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
// Supervisor ingress is restricted to this ephemeral QA instance. Working server policy is unchanged.
const upstream='127.0.0.1:'+server.address().port;
const preview=createServer((req,res)=>{
 const headers={...req.headers,host:upstream};
 if(session)headers.cookie='way_workspace='+session.token;
 for(const key of Object.keys(headers))if(key==='forwarded'||key.startsWith('x-forwarded-'))delete headers[key];
 if(headers.origin)headers.origin='http://'+upstream;
 const call=request({hostname:'127.0.0.1',port:server.address().port,path:req.url,method:req.method,headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
 call.on('error',()=>{res.writeHead(502);res.end('Preview upstream unavailable');});req.pipe(call);
});
preview.listen(4173,'0.0.0.0');
process.once('SIGTERM',()=>{preview.closeAllConnections();preview.close();server.closeAllConnections();server.close(()=>{w.close();process.exit(0);});});
