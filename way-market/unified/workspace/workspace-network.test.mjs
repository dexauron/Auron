import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,readFile,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { checkServerIdentity } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { privateIPv4,validateNetworkConfig,allowedNetworkPeer,readNetworkConfig,loadNetworkTransport } from './workspace-network.mjs';
import { askSecret } from './secret-input.mjs';
import { openWorkspace } from './workspace-store.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';
import { createBackupService } from './workspace-backups.mjs';

const password='Длинная тестовая фраза владельца 123', pfxPassword='Local test PFX phrase 456', backupPassword='Отдельная тестовая фраза копии 789';
let dir,config,transport,w,owner,server,ca,csrf,cookie;
async function freePort(){const s=netServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
function certs(folder,ip='127.0.0.1'){
  const run=(...args)=>execFileSync('openssl',args,{cwd:folder,stdio:'ignore'});
  run('req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','5','-subj','/CN=Way Market Test CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout','root.key','-out','root.pem');
  run('req','-newkey','rsa:2048','-nodes','-sha256','-subj','/CN=Way Market Test','-keyout','server.key','-out','server.csr');
  run('x509','-req','-in','server.csr','-CA','root.pem','-CAkey','root.key','-CAcreateserial','-days','3','-sha256','-extfile','extensions.cnf','-out','server.pem');
  run('pkcs12','-export','-inkey','server.key','-in','server.pem','-out','server.pfx','-passout',`pass:${pfxPassword}`);
}
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'way-https-'));
  await writeFile(join(dir,'extensions.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');certs(dir);
  await chmod(join(dir,'server.pfx'),0o600);
  const port=await freePort();config={version:1,bindAddress:'127.0.0.1',port,publicOrigin:`https://127.0.0.1:${port}`,clientAddresses:['127.0.0.1'],pfxPath:join(dir,'server.pfx'),certificatePath:join(dir,'server.pem'),caPath:join(dir,'root.pem'),maxBackupAgeMinutes:1440};
  transport=await loadNetworkTransport(config,pfxPassword);ca=await readFile(config.caPath);
  w=openWorkspace(':memory:');await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});owner=await w.accounts.login({login:'owner',password});
  ({server}=createWorkspaceServer(w,{network:transport}));await new Promise(r=>server.listen(port,'127.0.0.1',r));
  csrf=(await http('/api/session')).body.csrf;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));w?.close();if(dir)await rm(dir,{recursive:true,force:true});});
function http(path,data,extras={}){
  return new Promise((resolve,reject)=>{
    const headers={...(data===undefined?{}:{'Content-Type':'application/json','X-Way-Token':csrf,Origin:config.publicOrigin}),...extras.headers};
    const req=httpsRequest({hostname:config.bindAddress,port:config.port,path,method:data===undefined?'GET':'POST',ca,rejectUnauthorized:true,checkServerIdentity:(_,cert)=>checkServerIdentity(config.bindAddress,cert),agent:false,...extras,headers},res=>{
      const parts=[];res.on('data',x=>parts.push(x));res.on('end',()=>{const text=Buffer.concat(parts).toString();let body;try{body=JSON.parse(text);}catch{body=text;}resolve({status:res.statusCode,headers:res.headers,body});});
    });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Request timed out')));if(data!==undefined)req.write(JSON.stringify(data));req.end();
  });
}
test('network configuration permits explicit private IPv4 devices and rejects open binds, proxies and malformed origins',()=>{
  for(const ip of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.1.132'])assert.equal(privateIPv4(ip),true);
  for(const ip of ['0.0.0.0','8.8.8.8','172.32.0.1','192.168.1.1/24','::1','192.168.001.1','127.0.0.1'])assert.equal(privateIPv4(ip),false);
  for(const bad of [{bindAddress:'0.0.0.0'},{bindAddress:'8.8.8.8'},{clientAddresses:[]},{clientAddresses:['192.168.1.0/24']},{clientAddresses:['127.0.0.1','127.0.0.1']},{publicOrigin:'http://127.0.0.1:3443'},{publicOrigin:config.publicOrigin+'/'},{publicOrigin:'https://example.com:3443'},{port:0},{port:443},{pfxPath:'relative.pfx'},{password:'secret'}])assert.throws(()=>validateNetworkConfig({...config,...bad}));
  assert.equal(allowedNetworkPeer('::ffff:127.0.0.1',config),true);assert.equal(allowedNetworkPeer('192.168.1.50',config),false);
});
test('configuration file is bounded, private and secret-free',async()=>{
  const file=join(dir,'network.json');await writeFile(file,JSON.stringify(config),{mode:0o600});assert.equal((await readNetworkConfig(file)).publicOrigin,config.publicOrigin);
  await writeFile(file,JSON.stringify({...config,password:'secret'}));await assert.rejects(readNetworkConfig(file));
  await writeFile(file,'x'.repeat(16385));await assert.rejects(readNetworkConfig(file));
  if(process.platform!=='win32'){await writeFile(file,JSON.stringify(config));await chmod(file,0o644);await assert.rejects(readNetworkConfig(file));}
});
test('PFX chain is proved by a validating TLS handshake; wrong password, IP, expiry and leaf mismatch fail',async()=>{
  assert.equal(transport.config.publicOrigin,config.publicOrigin);assert.match(transport.caFingerprint,/^[A-F0-9:]+$/);
  await assert.rejects(loadNetworkTransport(config,pfxPassword+'wrong'),/PFX/);
  await assert.rejects(loadNetworkTransport({...config,bindAddress:'192.168.1.132',publicOrigin:`https://192.168.1.132:${config.port}`},pfxPassword),/сертификат/);
  await assert.rejects(loadNetworkTransport(config,pfxPassword,{clock:()=>Date.now()+7*86400000}),/Сертификат/);
  const other=join(dir,'other');await (await import('node:fs/promises')).mkdir(other);await writeFile(join(other,'extensions.cnf'),await readFile(join(dir,'extensions.cnf')));certs(other);await chmod(join(other,'server.pfx'),0o600);
  // Different, valid leaf signed by the same CA, to exercise served-certificate comparison.
  execFileSync('openssl',['x509','-req','-in',join(other,'server.csr'),'-CA',config.caPath,'-CAkey',join(dir,'root.key'),'-CAcreateserial','-days','3','-sha256','-extfile',join(dir,'extensions.cnf'),'-out',join(other,'same-ca.pem')],{stdio:'ignore'});
  execFileSync('openssl',['pkcs12','-export','-inkey',join(other,'server.key'),'-in',join(other,'same-ca.pem'),'-out',join(dir,'same-ca.pfx'),'-passout',`pass:${pfxPassword}`],{stdio:'ignore'});await chmod(join(dir,'same-ca.pfx'),0o600);
  await assert.rejects(loadNetworkTransport({...config,pfxPath:join(dir,'same-ca.pfx')},pfxPassword),/TLS/);
});
test('HTTPS login uses a distinct Host-prefixed Secure cookie and does not accept the HTTP cookie',async()=>{
  assert.equal((await http('/api/cash')).status,401);
  assert.equal((await http('/api/cash',undefined,{headers:{Cookie:`way_workspace=${owner.token}`}})).status,401);
  const login=await http('/api/login',{login:'owner',password});assert.equal(login.status,200);cookie=login.headers['set-cookie'][0].split(';')[0];
  assert.match(cookie,/^__Host-way_workspace=/);assert.match(login.headers['set-cookie'][0],/; Secure;/);assert.match(login.headers['set-cookie'][0],/HttpOnly/);assert.match(login.headers['set-cookie'][0],/SameSite=Strict/);assert.doesNotMatch(login.headers['set-cookie'][0],/Domain=/i);
  assert.equal((await http('/api/cash',undefined,{headers:{Cookie:cookie}})).status,200);
  for(const path of ['/server.pfx','/trust-root.cer','/https-test.json','/workspace-network.mjs'])assert.equal((await http(path,undefined,{headers:{Cookie:cookie}})).status,404);
});
test('HTTPS rejects wrong Host, Origin, Fetch Metadata, proxy headers and CSRF before business writes',async()=>{
  assert.equal((await http('/api/session',undefined,{headers:{Host:'example.com'}})).status,403);
  assert.equal((await http('/api/session',undefined,{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await http('/api/session',undefined,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  for(const headers of [{'X-Forwarded-For':'127.0.0.1'},{Forwarded:'for=127.0.0.1'},{'X-Forwarded-Proto':'https'}])assert.equal((await http('/api/session',undefined,{headers})).status,403);
  const p={slot:'new',expectedVersion:0,baseVersion:0,requestId:randomUUID(),fields:{cashReport:'12,'}};
  assert.equal((await http('/api/cash-drafts',p,{headers:{Cookie:cookie,'X-Way-Token':'bad'}})).status,403);
  assert.equal((await http('/api/cash-drafts',p,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await http('/api/bootstrap',{code:'anything'})).status,403);
});
test('unapproved source is dropped before TLS; untrusted CA, old TLS and plaintext HTTP cannot connect',async()=>{
  await assert.rejects(http('/api/session',undefined,{localAddress:'127.0.0.2'}));
  await assert.rejects(http('/api/session',undefined,{ca:undefined}));
  await assert.rejects(http('/api/session',undefined,{minVersion:'TLSv1',maxVersion:'TLSv1.1',ciphers:'DEFAULT@SECLEVEL=0'}));
  await assert.rejects(new Promise((resolve,reject)=>{const r=httpRequest({host:'127.0.0.1',port:config.port,path:'/'},resolve);r.on('error',reject);r.setTimeout(3000,()=>r.destroy(new Error('Plain HTTP refused')));r.end();}));
});
test('HTTPS cannot bootstrap an unconfigured database and logout expires only the secure cookie',async()=>{
  const empty=openWorkspace(':memory:');try{assert.throws(()=>createWorkspaceServer(empty,{network:transport}),/владельца/);}finally{empty.close();}
  const out=await http('/api/logout',{}, {headers:{Cookie:cookie}});assert.equal(out.status,200);assert.match(out.headers['set-cookie'][0],/^__Host-way_workspace=;/);assert.match(out.headers['set-cookie'][0],/Secure/);assert.match(out.headers['set-cookie'][0],/Max-Age=0/);
  assert.equal((await http('/api/cash',undefined,{headers:{Cookie:cookie}})).status,401);
});
test('network startup requires a present, unchanged, recent backup with checked restoration',async t=>{
  let now=Date.now();const db=openWorkspace(':memory:',{clock:()=>now});const backups=createBackupService(db,{directory:join(dir,'copies'),restoreDirectory:join(dir,'restored')});
  t.after(async()=>{await backups.close();db.close();});await db.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const session=await db.accounts.login({login:'owner',password});
  await assert.rejects(backups.startupReadiness(1440));
  const auth={password:backupPassword,passwordAgain:backupPassword,currentPassword:password};const copy=await backups.create(session.token,auth);
  await assert.rejects(backups.startupReadiness(1440));await backups.restore(session.token,{...auth,id:copy.id});
  assert.equal((await backups.startupReadiness(1440)).checkedCopyId,copy.id);
  const path=join(dir,'copies',copy.id),original=await readFile(path),broken=Buffer.from(original);broken[broken.length-1]^=1;await writeFile(path,broken);await assert.rejects(backups.startupReadiness(1440));await writeFile(path,original);
  now+=1441*60000;await assert.rejects(backups.startupReadiness(1440));
});
test('console password input is not echoed and restores terminal state on completion or cancellation',async()=>{
  const input=new PassThrough();input.isTTY=true;input.isRaw=false;input.setRawMode=v=>{input.isRaw=v;};const output=new PassThrough();let printed='';output.on('data',b=>{printed+=b.toString();});
  const secret=askSecret('Password: ',input,output);input.emit('keypress','секрет',{name:'x'});input.emit('keypress','',{name:'return'});assert.equal(await secret,'секрет');assert.equal(input.isRaw,false);assert.equal(printed.includes('секрет'),false);
  const cancelled=askSecret('Password: ',input,output);input.emit('keypress','c',{name:'c',ctrl:true});await assert.rejects(cancelled,/отменён/);assert.equal(input.isRaw,false);
});
