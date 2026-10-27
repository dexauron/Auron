// Проверки границы данных на настоящем Web Crypto, без сети и данных магазина.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
function harness() {
  const files = new Map(), blobs = new Map(), disk = new Map();
  const state = { isAdmin: true, serverless: true, products: [{ id: 'p1', name: 'Товар', code: '001',
    barcodes: ['00123'], photos: [], stock: 7, supplier_ids: ['s1'] }], groups: [],
    suppliers: [{ id: 's1', name: 'Поставщик' }], prices: [{ product_id: 'p1', price: 123 }],
    sales: [], contacts: { s1: { phone: 'fixture' } }, orders: [], requests: [{ private: 'owner-only' }],
    staffPassword: 'fixture-staff-password', popularity: {} };
  let n = 0;
  const local = new Map();
  const ctx = { state, ui: { secretPw: 'fixture-owner-password' },
    CFG: { DATA_PATH: 'data', STATIC_URL: 'data/', GITHUB_OWNER: 'fixture', GITHUB_REPO: 'fixture' },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob, URL, setTimeout, clearTimeout, networkDown: false,
    console, structuredClone, requestIdleCallback: () => {},
    $: () => ({ hidden: false, classList: { toggle() {} } }),
    localStorage: { getItem: k => local.get(k) || null, setItem: (k,v) => local.set(k,v), removeItem: k => local.delete(k) },
    idbGet: async k => disk.get(k), idbSet: async (k,v) => disk.set(k, structuredClone(v)), idbDelete: async k => disk.delete(k),
    CACHE_KEY: 'fixture-public', norm: x => String(x || '').toLowerCase(), toast() {}, buildIndex() {}, renderAll() {},
    tidyMemory() {}, autoDedup() {}, saveCache() {}, byName: (a,b) => a.name.localeCompare(b.name),
    partName: i => String(i).padStart(2,'0'), digest: async s => createHash('sha256').update(s).digest('hex'),
    shard: (a,n) => Array.from({length:n}, (_,i) => i===0 ? a : []),
    pool: async (a,n,fn) => Promise.all(a.map(fn)),
    fetch: async (url, opts = {}) => {
      if (ctx.networkDown) throw new TypeError('fixture offline');
      const response = (s,v) => ({ status:s, ok:s>=200&&s<300, text:async()=>typeof v==='string'?v:JSON.stringify(v), json:async()=>typeof v==='string'?JSON.parse(v):v });
      const u = String(url);
      if (u.includes('api.github.com')) {
        const body = opts.body ? JSON.parse(opts.body) : {};
        if (u.includes('/git/ref/heads/')) return response(200,{object:{sha:'base'}});
        if (u.includes('/git/commits/') && !opts.method) return response(200,{tree:{sha:'tree'}});
        if (u.endsWith('/git/blobs')) { const sha='b'+(++n); blobs.set(sha,body.content); return response(200,{sha}); }
        if (u.endsWith('/git/trees')) { for(const e of body.tree) e.sha===null?files.delete(e.path):files.set(e.path,blobs.get(e.sha)); return response(200,{sha:'tree'}); }
        return response(200,{sha:'commit'});
      }
      const key = 'data/' + u.split('data/').pop().split('?')[0];
      return files.has(key) ? response(200,files.get(key)) : response(404,'missing');
    },
  };
  vm.createContext(ctx);
  for (const file of ['publication-data.js','catalog-crypto.js','publish.js']) {
    const p = path.join(root,'js/modules',file);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p,'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+/g,''),ctx,{filename:file});
  }
  vm.runInContext('globalThis.api = { publishFull, unlockAny, unlockSecret, unlockStaff, buildPublicProducts, encryptJSON, decryptJSON, applyServerless, applyStaff, clearSvAuth, rememberSession, restoreSession }; globalThis.cryptoTest = { unwrapCatalogKey, importCatalogKey, keyDecrypt, keyEncrypt };',ctx);
  return {ctx,files,disk,local,state,api:ctx.api};
}

(async () => {
  let bad = 0, total = 0;
  const check = (ok,label) => { total++; console.log((ok?'OK: ':'FAIL: ')+label); if(!ok) bad++; };
  const h = harness();
  const damaged=harness();damaged.files.set('data/catalog.enc','existing protected catalog');
  let lostKeys=false;try{await damaged.api.unlockAny('new-owner-fixture')}catch(e){lostKeys=e.message==='INVALID_CATALOG'}
  check(lostKeys,'потерянные ключи не превращают существующий каталог в первую настройку');
  await h.api.publishFull('fixture-owner-password');
  const keys = JSON.parse(h.files.get('data/keys.json'));
  check(keys.v===4, 'публикация использует раздельные наборы v4');
  check(h.files.has('data/staff-catalog.enc') && [...h.files.keys()].some(k=>k.includes('/sec-staff/')), 'для сотрудника есть отдельная опись и части');
  const C = h.ctx.cryptoTest;
  const ownerRaw = await C.unwrapCatalogKey(keys.owner,'fixture-owner-password','wm.catalog.v4/owner/key');
  const staffRaw = await C.unwrapCatalogKey(keys.staff,'fixture-staff-password','wm.catalog.v4/staff/key');
  check(!Buffer.from(ownerRaw).equals(Buffer.from(staffRaw)), 'ключи owner и staff криптографически различны');
  let cannotRead = false;
  const staffKey = await C.importCatalogKey(staffRaw);
  try { await C.keyDecrypt(staffKey,h.files.get('data/catalog.enc'),'wm.catalog.v4/owner/manifest'); } catch { cannotRead=true; }
  check(cannotRead, 'ключ сотрудника не расшифровывает опись владельца');
  let swapped = false;
  try { await C.keyDecrypt(staffKey,h.files.get('data/sec-staff/products-00.enc'),'wm.catalog.v4/staff/prices/0'); } catch { swapped=true; }
  check(swapped, 'подмена назначения зашифрованной части отклоняется');
  const ownerKey=await C.importCatalogKey(ownerRaw), original=h.files.get('data/sec/products-00.enc');
  h.files.set('data/sec/products-00.enc',await C.keyEncrypt(ownerKey,[{id:'p1',name:'Другая версия'}],'wm.catalog.v4/owner/products/0'));
  let mixed=false;try{await h.api.unlockSecret('fixture-owner-password')}catch(e){mixed=e.message==='CATALOG_CHANGED'}
  check(mixed,'часть другой версии не смешивается с ранее прочитанной описью');
  h.files.set('data/sec/products-00.enc',original);
  let badWork = false;
  try { await C.unwrapCatalogKey({...keys.owner,iter:900000000},'fixture-owner-password','wm.catalog.v4/owner/key'); } catch { badWork=true; }
  check(badWork, 'неограниченная стоимость KDF из файла не принимается');
  await h.api.unlockStaff('fixture-staff-password');
  check(h.state.prices.length===1 && h.state.contacts.s1.phone==='fixture', 'разрешённые сотруднику закупки и контакты сохранены');
  check(h.state.staffPassword===null && h.state.requests.length===0, 'секреты управления доступом и заявки владельца сотруднику не выданы');
  let denied = false; try { await h.api.unlockSecret('fixture-staff-password'); } catch { denied=true; }
  check(denied, 'пароль сотрудника не принимается за пароль владельца');

  h.state.products = [{ id:'p1', name:'Товар', description:{secret:777}, photos:[{url:'https://example.test/photo.jpg',cost:777}], barcodes:[{secret:777},'00123'] }];
  const pub = h.api.buildPublicProducts();
  check(!JSON.stringify(pub).includes('secret')&&!JSON.stringify(pub).includes('cost'), 'вложенные внутренние поля не попадают в публичный JSON');
  check(pub[0].barcodes.length===1 && pub[0].barcodes[0]==='00123', 'строковые штрихкоды сохранены, объекты отброшены');
  check(pub[0].photos[0]==='https://example.test/photo.jpg', 'фото публикуется только как допустимая ссылка');
  await h.api.unlockSecret('fixture-owner-password');
  h.api.applyServerless('fixture-owner-password');
  await h.api.rememberSession();
  check(![...h.local.values()].some(v=>String(v).includes('fixture-owner-password')), 'запомненный вход не хранит пароль открыто в localStorage');
  check([...h.disk.values()].some(v=>v.key && v.key.extractable===false), 'устройство сохраняет неизвлекаемый CryptoKey');
  check(!JSON.stringify([...h.disk.values()]).includes('fixture-owner-password'), 'в IndexedDB также нет исходного пароля');
  h.state.isAdmin=false; h.state.session=null;
  check(await h.api.restoreSession() && h.state.isAdmin===true, 'вход владельца восстанавливается после проверки ключа');
  await h.api.rememberSession();
  h.state.staffPassword='fixture-owner-password';
  let samePassword=false;
  try { await h.api.publishFull(null); } catch(e) { samePassword=/должны отличаться/.test(e.message); }
  check(samePassword, 'при восстановленном входе пароль сотрудника не может совпасть с паролем владельца');
  h.state.staffPassword='fixture-staff-password';
  const revoked = JSON.parse(h.files.get('data/keys.json')); revoked.owner.data='AAAA'+revoked.owner.data.slice(4);
  h.files.set('data/keys.json',JSON.stringify(revoked)); h.state.isAdmin=false; h.state.session=null;
  check(await h.api.restoreSession()===false && h.state.isAdmin===false, 'явное изменение ключа отзывает вход и не считается отсутствием сети');
  h.files.set('data/keys.json',JSON.stringify(keys));
  await h.api.unlockStaff('fixture-staff-password'); h.api.applyStaff(null); await h.api.rememberSession();
  h.ctx.networkDown=true; h.state.isAdmin=false; h.state.session=null;
  check(await h.api.restoreSession() && h.state.role==='staff' && h.state.prices[0].price===123, 'без сети доступна только своя зашифрованная офлайн-копия');
  h.ctx.networkDown=false;
  h.local.set('wm_sv_auth',JSON.stringify({v:2,role:'owner'})); h.state.isAdmin=false;
  check(await h.api.restoreSession()===false && !h.state.isAdmin, 'подмена роли в localStorage не повышает права');
  await h.api.clearSvAuth();
  check(!h.local.has('wm_sv_auth')&&!h.disk.has('wm_auth_device_v2')&&!h.disk.has('wm_private_device_v2'), 'выход удаляет ключ и закрытую копию с устройства');

  // Переход с настоящего прежнего формата: один ключ, PBKDF2 150 000,
  // части v1 без контекста. Старые файлы генерируем независимо от нового кода.
  const legacy = harness(), keyBytes=webcrypto.getRandomValues(new Uint8Array(32));
  const oldKey=await webcrypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const b64=x=>Buffer.from(x).toString('base64');
  const oldEncrypt=async obj=>{
    const iv=webcrypto.getRandomValues(new Uint8Array(12));
    const data=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},oldKey,new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({v:1,z:null,iv:b64(iv),data:b64(data)});
  };
  const oldWrap=async pw=>{
    const salt=webcrypto.getRandomValues(new Uint8Array(16)),iv=webcrypto.getRandomValues(new Uint8Array(12));
    const base=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
    const k=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);
    return {kdf:'PBKDF2',iter:150000,salt:b64(salt),iv:b64(iv),data:b64(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},k,keyBytes))};
  };
  const oldKeys={v:3,owner:await oldWrap('old-owner-fixture'),staff:await oldWrap('old-staff-fixture')};
  legacy.files.set('data/keys.json',JSON.stringify(oldKeys));
  const oldHead={groups:[],suppliers:legacy.state.suppliers,contacts:legacy.state.contacts,staffPassword:'old-staff-fixture',requests:legacy.state.requests};
  const oldSets={};
  for(const [name,count] of [['products',24],['prices',12],['sales',6]]){
    const hashes=[];
    for(let i=0;i<count;i++){
      const rows=i===0?(legacy.state[name]||[]):[];
      hashes.push(createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,16));
      legacy.files.set(`data/sec/${name}-${String(i).padStart(2,'0')}.enc`,await oldEncrypt(rows));
    }
    oldSets[name]={n:count,h:hashes};
  }
  legacy.files.set('data/catalog.enc',await oldEncrypt({v:3,head:oldHead,sets:oldSets}));
  let oldStaffBlocked=false;
  try{await legacy.api.unlockStaff('old-staff-fixture')}catch(e){oldStaffBlocked=e.message==='SECURITY_UPGRADE_REQUIRED'}
  check(oldStaffBlocked,'общий ключ v3 не выдаётся сотруднику до перехода владельца');
  await legacy.api.unlockSecret('old-owner-fixture');
  check(legacy.state.products.length===1&&legacy.state.prices[0].price===123,'владелец читает прежние конверты 150 000 без потери данных');
  legacy.state.staffPassword='new-staff-fixture';
  await legacy.api.publishFull('new-owner-fixture',{rotate:true});
  check(JSON.parse(legacy.files.get('data/keys.json')).v===4,'успешная публикация переводит v3 в v4');
  await legacy.api.unlockSecret('new-owner-fixture');
  check(legacy.state.products[0].id==='p1'&&legacy.state.prices[0].price===123&&legacy.state.requests.length===1,'после перехода у владельца сохранены id, цена и заявки');
  await legacy.api.unlockStaff('new-staff-fixture');
  check(legacy.state.products[0].id==='p1'&&legacy.state.prices[0].price===123&&legacy.state.requests.length===0,'после перехода сотрудник получает разрешённые данные своего набора');
  console.log(`ПРОВЕРОК: ${total}; ОШИБОК: ${bad}`);
  process.exitCode = bad?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
