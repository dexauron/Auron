import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp,rm,writeFile,readFile,chmod,mkdir,access } from 'node:fs/promises';
import { tmpdir,homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { openWorkspace } from '../local-app/workspace-store.mjs';
import { createWorkspaceServer } from '../local-app/workspace-server.mjs';
import { loadNetworkTransport } from '../local-app/workspace-network.mjs';

const require=createRequire(process.env.PLAYWRIGHT_FROM??import.meta.url),{chromium}=require('playwright');
const certutil=process.env.WAY_NSS_CERTUTIL;
if(!certutil)throw new Error('Set WAY_NSS_CERTUTIL to the NSS certutil executable for this isolated Linux browser test');
const dir=await mkdtemp(join(tmpdir(),'way-browser-https-')),trust=join(homedir(),'.pki','nssdb'),nickname=`way-https-test-${randomUUID()}`;
const password='Длинный тестовый пароль для HTTPS',pfxPassword='Separate test PFX phrase 123';
let trusted=false,browser,phoneBrowser,server,w;
try{
  const openssl=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
  await writeFile(join(dir,'extensions.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','5','-subj','/CN=Way Market Browser Test CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout','root.key','-out','root.pem');
  openssl('req','-newkey','rsa:2048','-nodes','-sha256','-subj','/CN=Way Market HTTPS','-keyout','server.key','-out','server.csr');
  openssl('x509','-req','-in','server.csr','-CA','root.pem','-CAkey','root.key','-CAcreateserial','-days','3','-sha256','-extfile','extensions.cnf','-out','server.pem');
  openssl('pkcs12','-export','-inkey','server.key','-in','server.pem','-out','server.pfx','-passout',`pass:${pfxPassword}`);
  await chmod(join(dir,'server.pfx'),0o600);
  await mkdir(trust,{recursive:true,mode:0o700});
  try{await access(join(trust,'cert9.db'));}catch{execFileSync(certutil,['-N','-d',`sql:${trust}`,'--empty-password'],{stdio:'pipe'});}
  execFileSync(certutil,['-A','-d',`sql:${trust}`,'-n',nickname,'-t','C,,','-i',join(dir,'root.pem')],{stdio:'pipe'});trusted=true;
  const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const config={version:1,bindAddress:'127.0.0.1',port,publicOrigin:`https://127.0.0.1:${port}`,clientAddresses:['127.0.0.1'],pfxPath:join(dir,'server.pfx'),certificatePath:join(dir,'server.pem'),caPath:join(dir,'root.pem'),maxBackupAgeMinutes:1440};
  const network=await loadNetworkTransport(config,pfxPassword);
  w=openWorkspace(':memory:');await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const owner=await w.accounts.login({login:'owner',password});await w.accounts.createUser(owner.token,{login:'cashier',name:'Кассир',role:'cashier',password});
  ({server}=createWorkspaceServer(w,{network}));await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const launch=()=>chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),...(process.env.WAY_BROWSER_SINGLE_PROCESS?{args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']}:{})});
  browser=await launch();phoneBrowser=await launch();
  const desktop=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:false}),phone=await phoneBrowser.newContext({viewport:{width:390,height:844},ignoreHTTPSErrors:false});
  const errors=[];
  async function login(ctx,who){
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const response=await page.goto(config.publicOrigin);assert.equal(response.status(),200);assert.match((await response.securityDetails()).protocol,/TLS/);
    await page.locator('#entry').waitFor({state:'visible'});
    await page.locator('#login-form [name=login]').fill(who);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-button').click();await page.locator('#app').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>isSecureContext),true);assert.equal(await page.evaluate(()=>document.cookie),'');
    const cookie=(await ctx.cookies()).find(c=>c.name==='__Host-way_workspace');assert.ok(cookie?.secure&&cookie.httpOnly);assert.equal(cookie.sameSite,'Strict');return page;
  }
  const ownerPage=await login(desktop,'owner');
  await ownerPage.locator('#navigation').getByRole('button',{name:'Каталог',exact:true}).click();await ownerPage.getByRole('button',{name:'Добавить товар'}).click();
  await ownerPage.locator('#modal [name=name]').fill('HTTPS тестовый товар');await ownerPage.locator('#modal [name=price]').fill('123,45');await ownerPage.getByRole('button',{name:'Сохранить товар',exact:true}).click();await ownerPage.locator('#modal').waitFor({state:'hidden'});
  await ownerPage.locator('#navigation').getByRole('button',{name:'Касса',exact:true}).click();await ownerPage.getByRole('button',{name:'Новая сдача',exact:true}).click();await ownerPage.locator('#page [name=cashReport]').fill('12,');await ownerPage.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await ownerPage.waitForFunction(()=>document.querySelector('.save-bar small')?.textContent.includes('Черновик сохранён на сервере'));
  await ownerPage.reload();await ownerPage.locator('#navigation').getByRole('button',{name:'Касса',exact:true}).click();await ownerPage.getByRole('button',{name:'Продолжить',exact:true}).click();assert.equal(await ownerPage.locator('#page [name=cashReport]').inputValue(),'12,');
  console.log('✓ Chromium trusts the test CA without ignoring TLS errors; HTTPS login, Secure cookie and draft recovery pass');
  const cashierPage=await login(phone,'cashier');await cashierPage.locator('#mobile-navigation').getByRole('button',{name:'Каталог',exact:true}).click();await cashierPage.getByText('HTTPS тестовый товар',{exact:true}).waitFor();
  await cashierPage.locator('#mobile-navigation').getByRole('button',{name:'Касса',exact:true}).click();assert.equal(await cashierPage.getByRole('heading',{name:'Мои черновики',exact:true}).count(),0);
  await cashierPage.getByRole('button',{name:'Новая сдача',exact:true}).click();await cashierPage.locator('#page [name=cashReport]').fill('34,');await cashierPage.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await cashierPage.waitForFunction(()=>document.querySelector('.save-bar small')?.textContent.includes('Черновик сохранён на сервере'));
  assert.equal(w.draftGet(owner.token,'new').fields.cashReport,'12,');assert.equal(await cashierPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await cashierPage.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.deepEqual(errors,[]);console.log('✓ Independent desktop/phone cookie contexts share catalog and isolate private drafts over verified HTTPS');
}finally{
  await phoneBrowser?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));w?.close();
  if(trusted)execFileSync(certutil,['-D','-d',`sql:${trust}`,'-n',nickname],{stdio:'pipe'});
  await rm(dir,{recursive:true,force:true});
}
