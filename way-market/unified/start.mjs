import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {openWorkspace} from './workspace/workspace-store.mjs';
import {createWorkspaceServer} from './workspace/workspace-server.mjs';
import {createBackupService} from './workspace/workspace-backups.mjs';
import {createUnifiedData} from './unified-data.mjs';
import {createUnifiedExtension} from './unified-extension.mjs';
export const root=fileURLToPath(new URL('.',import.meta.url));
export async function sourceCatalog(){const index=JSON.parse(await readFile(join(root,'catalog/data/index.json'),'utf8'));const chunks=await Promise.all(index.parts.map((_,i)=>readFile(join(root,'catalog/data/p/'+String(i).padStart(2,'0')+'.json'),'utf8').then(JSON.parse)));return {products:chunks.flat(),groups:JSON.parse(await readFile(join(root,'catalog/data/groups.json'),'utf8'))};}
export async function startSuite({dataDirectory,port=3211,sessions=true}={}){
 const dir=dataDirectory||(process.platform==='win32'?join(process.env.ProgramData||homedir(),'WayMarket-Unified-Test'):join(homedir(),'.way-market-unified-test'));
 await mkdir(dir,{recursive:true,mode:0o700});const w=openWorkspace(join(dir,'workspace.sqlite'),{persistentSessions:sessions});
 const source=await sourceCatalog(),data=createUnifiedData(w,source.products,source.groups),backupService=createBackupService(w,{directory:join(dir,'backups'),restoreDirectory:join(dir,'restored')});
 const app=createWorkspaceServer(w,{persistentSessions:true,backupService,extension:createUnifiedExtension(root,data,w)});
 try{await new Promise((ok,fail)=>{app.server.once('error',fail);app.server.listen(port,'127.0.0.1',ok);});}catch(error){await backupService.close();w.close();throw error;}
 console.log('Way Market · единая система: http://127.0.0.1:'+app.server.address().port);
 if(!w.accounts.configured())console.log('Код настройки владельца: '+app.setupCode);
 return {workspace:w,data,server:app.server,setupCode:app.setupCode,close:async()=>{await backupService.close();app.server.closeAllConnections();await new Promise(ok=>app.server.close(ok));w.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const suite=await startSuite();let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{if(stopping)return;stopping=true;await suite.close();});}
