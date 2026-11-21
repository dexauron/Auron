// Проверки границы данных на настоящем Web Crypto, без сети и данных магазина.
const { legacyCatalogFiles, legacyWholeFile } = require('./fixtures/legacy-crypto.cjs');
const { harness } = require('./fixtures/publish-harness.cjs');

(async () => {
  let bad = 0, total = 0;
  const check = (ok,label) => { total++; console.log((ok?'OK: ':'FAIL: ')+label); if(!ok) bad++; };
  const h = harness();
  const damaged=harness();damaged.files.set('data/catalog.enc','existing protected catalog');
  let lostKeys=false;try{await damaged.api.unlockAny('new-owner-fixture')}catch(e){lostKeys=e.message==='INVALID_CATALOG'}
  check(lostKeys,'потерянные ключи не превращают существующий каталог в первую настройку');
  await h.api.publishFull('fixture-owner-password');
  const keys = JSON.parse(h.files.get('data/keys.json'));
  const existingManifest = h.files.get('data/catalog.enc');
  h.files.delete('data/catalog.enc');
  let missingManifest = false;
  try { await h.api.unlockSecret('fixture-owner-password'); }
  catch(e) { missingManifest = e.message === 'INVALID_CATALOG' && e.passwordAccepted === true; }
  check(missingManifest, 'при известном ключе потеря описи не разрешает первую настройку и не объявляется неверным паролем');
  h.files.set('data/catalog.enc', existingManifest);
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
  for (const failure of ['missing-manifest', 'invalid-manifest', 'missing-part']) {
    const file = failure === 'missing-part' ? 'data/sec/products-00.enc' : 'data/catalog.enc';
    const original = h.files.get(file);
    if (failure === 'invalid-manifest') h.files.set(file, '{fixture interrupted'); else h.files.delete(file);
    h.state.isAdmin=false; h.state.session=null;
    check(await h.api.restoreSession() && h.local.has('wm_sv_auth') && h.state.products[0].code==='001' && h.state.sessionWarning,
      failure+': ошибка данных при подтверждённом ключе сохраняет вход и свою зашифрованную копию');
    let blocked=false;try{await h.api.publishFull(null)}catch(e){blocked=/сохранённая копия/.test(e.message)}
    check(blocked, failure+': сохранённая копия не перезаписывает непроверенный каталог сервера');
    h.files.set(file,original);
    await h.api.unlockSecret('fixture-owner-password');h.api.applyServerless(null);await h.api.rememberSession();
  }
  const normalFetch=h.ctx.fetch,normalTimer=h.ctx.setTimeout;
  h.ctx.setTimeout=(fn,ms)=>setTimeout(fn,ms===12000?15:ms);
  h.ctx.fetch=(_url,opts)=>new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('fixture timeout'))));
  h.state.isAdmin=false;h.state.session=null;
  check(await h.api.restoreSession() && h.state.isAdmin, 'зависший ответ прерывается по сроку и открывается своя сохранённая копия');
  h.ctx.fetch=normalFetch;h.ctx.setTimeout=normalTimer;
  await h.api.unlockSecret('fixture-owner-password');h.api.applyServerless(null);await h.api.rememberSession();
  const normalGet=h.ctx.idbGet;
  h.ctx.idbGet=async()=>{throw new Error('fixture storage busy')};h.state.isAdmin=false;h.state.session=null;
  check(await h.api.restoreSession()===false && h.local.has('wm_sv_auth') && h.disk.has('wm_auth_device_v2'), 'временная ошибка памяти устройства не удаляет сохранённый вход');
  h.ctx.idbGet=normalGet;
  check(await h.api.restoreSession() && h.state.isAdmin, 'после восстановления памяти вход возвращается без повторного ввода пароля');
  /* Файл ключей не прочитался (нет его или пришёл обрывок). Раньше это
     возвращало человека к паролю; с 30.10.2026 решение владельца — «чтобы
     постоянно с аккаунта не выкидывало, пока сам пользователь не выйдет», —
     и открывается своя зашифрованная копия. Безопасность от этого не слабеет:
     ту же копию прежний код отдавал при выключенном интернете, а расшифровать
     её может только ключ ЭТОГО устройства. Что остаётся запретным и проверяется
     здесь же: непроверенным входом нельзя ПУБЛИКОВАТЬ — иначе сохранённая
     копия перезаписала бы настоящий каталог. */
  for(const body of [null,'{fixture interrupted keys']) {
    const original=h.files.get('data/keys.json');
    body===null?h.files.delete('data/keys.json'):h.files.set('data/keys.json',body);
    h.state.isAdmin=false;h.state.session=null;
    check(await h.api.restoreSession()===true && h.state.products[0].code==='001' && h.local.has('wm_sv_auth') && h.disk.has('wm_auth_device_v2') && h.state.sessionWarning,
      'непрочитанный файл ключей не выбрасывает из аккаунта: открывается своя копия, ключ устройства цел');
    let blocked=false;try{await h.api.publishFull(null)}catch(e){blocked=/сохранённая копия/.test(e.message)}
    check(blocked, 'при непрочитанном файле ключей публикация запрещена');
    h.files.set('data/keys.json',original);await h.api.restoreSession();
  }
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
  const legacy = harness();
  const oldSnapshot={products:legacy.state.products,prices:legacy.state.prices,sales:[],groups:[],
    suppliers:legacy.state.suppliers,contacts:legacy.state.contacts,requests:legacy.state.requests};
  const legacyFiles=await legacyCatalogFiles(oldSnapshot,'old-owner-fixture','old-staff-fixture');
  for(const [name,body] of legacyFiles) legacy.files.set(name,body);
  let oldStaffBlocked=false;
  try{await legacy.api.unlockStaff('old-staff-fixture')}catch(e){oldStaffBlocked=e.message==='SECURITY_UPGRADE_REQUIRED'}
  check(oldStaffBlocked,'общий ключ v3 не выдаётся сотруднику до перехода владельца');
  await legacy.api.unlockSecret('old-owner-fixture');
  check(legacy.state.products.length===1&&legacy.state.prices[0].price===123,'владелец читает настоящий формат v3: gzip, отсутствие v/alg, PBKDF2 150 000');
  legacy.state.staffPassword='new-staff-fixture';
  await legacy.api.publishFull('new-owner-fixture',{rotate:true});
  check(JSON.parse(legacy.files.get('data/keys.json')).v===4,'успешная публикация переводит v3 в v4');
  await legacy.api.unlockSecret('new-owner-fixture');
  check(legacy.state.products[0].id==='p1'&&legacy.state.prices[0].price===123&&legacy.state.requests.length===1,'после перехода у владельца сохранены id, цена и заявки');
  await legacy.api.unlockStaff('new-staff-fixture');
  check(legacy.state.products[0].id==='p1'&&legacy.state.prices[0].price===123&&legacy.state.requests.length===0,'после перехода сотрудник получает разрешённые данные своего набора');
  const uncompressed=harness();
  for(const [name,body] of await legacyCatalogFiles(oldSnapshot,'old-owner-fixture','old-staff-fixture',{compress:false})) uncompressed.files.set(name,body);
  await uncompressed.api.unlockSecret('old-owner-fixture');
  check(uncompressed.state.products[0].code==='001','прежние части без v и без сжатия тоже читаются');
  for(const compress of [true,false]){
    const whole=harness();
    whole.files.set('data/secret-catalog.enc',await legacyWholeFile(oldSnapshot,'old-owner-fixture',compress));
    await whole.api.unlockSecret('old-owner-fixture');
    check(whole.state.products[0].code==='001'&&whole.state.prices[0].price===123,`прежний цельный файл читается: ${compress?'gzip':'без сжатия'}`);
  }
  const noVersion=JSON.parse(h.files.get('data/catalog.enc'));delete noVersion.v;
  let noDowngrade=false;
  try{await C.keyDecrypt(ownerKey,noVersion,'wm.catalog.v4/owner/manifest')}catch(e){noDowngrade=e.message==='INVALID_CATALOG'}
  check(noDowngrade,'допуск прежней оболочки без v не действует на контекст v4');
  console.log(`ПРОВЕРОК: ${total}; ОШИБОК: ${bad}`);
  process.exitCode = bad?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
