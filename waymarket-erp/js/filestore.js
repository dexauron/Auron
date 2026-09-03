/* ============================================================================
   Сохранение данных в файлы прямо в рабочей папке программы.
   Работает без установки: браузер один раз спрашивает разрешение на папку,
   дальше дашборд сам пишет туда «база.json» после каждого изменения.
   Если браузер такое не умеет (Safari, старый Firefox) — остаётся резервное
   сохранение внутри браузера плюс кнопки «сохранить в файл» / «загрузить из файла».
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMFiles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = 'waymarket_erp', STORE = 'handles', KEY = 'workdir';
  var DATA_DIR = 'Данные_дашборда';
  var DATA_FILE = 'база.json';
  var BACKUP_DIR = 'копии';
  var BOOK_FILE = 'Бухгалтерия.xlsx';   // книга лежит на виду, в корне рабочей папки

  var dirHandle = null;
  var bookStamp = null;      // отпечаток книги, которую мы сами записали последней
  var bookSaved = null;      // когда книга записана
  var dataStamp = null;      // отпечаток «база.json», записанного нами
  var state = 'unsupported';   // unsupported | off | needs-permission | ready
  var lastSaved = null;
  var saveTimer = null;
  var listeners = [];

  function supported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  function notify() { listeners.forEach(function (fn) { try { fn(state, lastSaved); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  /* --- хранение ссылки на папку между запусками --- */
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbSet(key, val) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { reject(rq.error); };
      });
    });
  }

  /* --- подключение папки --- */
  async function connect() {
    if (!supported()) throw new Error('Браузер не умеет сохранять в папку. Откройте дашборд в Chrome, Edge или Яндекс.Браузере.');
    var handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'waymarket-data' });
    var perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Разрешение на папку не выдано.');
    dirHandle = handle;
    await idbSet(KEY, handle);
    state = 'ready'; notify();
    return handle;
  }

  // Тихо восстановить папку при запуске (разрешение может потребовать клика)
  async function restore() {
    if (!supported()) { state = 'unsupported'; notify(); return state; }
    try {
      var handle = await idbGet(KEY);
      if (!handle) { state = 'off'; notify(); return state; }
      dirHandle = handle;
      var perm = await handle.queryPermission({ mode: 'readwrite' });
      state = perm === 'granted' ? 'ready' : 'needs-permission';
    } catch (e) {
      state = 'off';
    }
    notify();
    return state;
  }

  // Повторно запросить разрешение — вызывать только из обработчика клика
  async function reconnect() {
    if (!dirHandle) return connect();
    var perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Разрешение на папку не выдано.');
    state = 'ready'; notify();
    return dirHandle;
  }

  function forget() {
    dirHandle = null; state = supported() ? 'off' : 'unsupported';
    idbSet(KEY, null).catch(function () {});
    notify();
  }

  /* --- запись и чтение файлов --- */
  async function dataDir() {
    if (!dirHandle) throw new Error('Папка не подключена');
    return dirHandle.getDirectoryHandle(DATA_DIR, { create: true });
  }

  async function writeFile(name, content, subdir) {
    var dir = await dataDir();
    if (subdir) dir = await dir.getDirectoryHandle(subdir, { create: true });
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(content);
    await w.close();
    return true;
  }

  /* --- книга «Бухгалтерия.xlsx» в корне рабочей папки --- */
  async function writeRoot(name, content) {
    if (!dirHandle) throw new Error('Папка не подключена');
    var fh = await dirHandle.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(content);
    await w.close();
    var f = await fh.getFile();
    return f.lastModified + ':' + f.size;
  }

  async function rootFile(name) {
    if (!dirHandle) return null;
    try {
      var fh = await dirHandle.getFileHandle(name);
      return await fh.getFile();
    } catch (e) { return null; }
  }

  // Записать книгу; отпечаток запоминаем, чтобы отличить свою запись от правки владельца
  async function saveBook(bytes) {
    if (state !== 'ready') return false;
    try {
      bookStamp = await writeRoot(BOOK_FILE, bytes);
      bookSaved = new Date();
      notify();
      return true;
    } catch (e) { return false; }
  }

  // Книга, изменённая снаружи (владелец правил её в Excel), или null
  async function bookChangedOutside() {
    var f = await rootFile(BOOK_FILE);
    if (!f) return null;
    var stamp = f.lastModified + ':' + f.size;
    if (bookStamp && stamp === bookStamp) return null;
    bookStamp = stamp;
    return f;
  }

  async function readFile(name) {
    var dir = await dataDir();
    try {
      var fh = await dir.getFileHandle(name);
      var f = await fh.getFile();
      return await f.text();
    } catch (e) { return null; }
  }

  /* --- сохранение базы --- */
  // Пишем не чаще раза в секунду: при быстром вводе не дёргаем диск на каждую букву
  function scheduleSave(getData) {
    if (state !== 'ready') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(getData); }, 900);
  }

  // Сколько копий храним (из настроек программы, по умолчанию 30)
  var keepBackups = 30;
  function setKeepBackups(n) { keepBackups = Math.max(1, +n || 30); }

  // Старые копии удаляем сами, чтобы папка не разрасталась
  async function trimBackups() {
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BACKUP_DIR, { create: true });
      var names = [];
      for await (var entry of dir.values()) {
        if (entry.kind === 'file' && /^база-.*\.json$/i.test(entry.name)) names.push(entry.name);
      }
      names.sort();
      while (names.length > keepBackups) {
        var old = names.shift();
        try { await dir.removeEntry(old); } catch (e) { break; }
      }
    } catch (e) { /* чистка не должна мешать сохранению */ }
  }

  // Проверка перед записью: не менял ли базу кто-то ещё (вторая вкладка,
  // другой компьютер, ручная правка файла). Возвращает содержимое чужой версии.
  async function foreignChange() {
    if (state !== 'ready') return null;
    try {
      var dir = await dataDir();
      var fh = await dir.getFileHandle(DATA_FILE);
      var f = await fh.getFile();
      var stamp = f.lastModified + ':' + f.size;
      if (!dataStamp || stamp === dataStamp) return null;
      return { stamp: stamp, text: await f.text() };
    } catch (e) { return null; }
  }

  async function saveNow(getData, force) {
    if (state !== 'ready') return false;
    try {
      // если файл изменил кто-то другой — не затираем молча
      if (!force) {
        var other = await foreignChange();
        if (other) {
          listeners.forEach(function (fn) { try { fn(state, lastSaved, other); } catch (e) {} });
          return false;
        }
      }
      var stampTime = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      var payload = JSON.stringify({ saved: new Date().toISOString(), data: getData() }, null, 2);
      var st = await writeFileStamped(DATA_FILE, payload);
      dataStamp = st;
      // копия с датой и временем: перезагрузка страницы больше не затирает
      // сегодняшнюю копию, а лишние удаляются по настройке
      if (lastBackup !== stampTime) {
        await writeFile('база-' + stampTime + '.json', payload, BACKUP_DIR);
        lastBackup = stampTime;
        await trimBackups();
      }
      lastSaved = new Date();
      notify();
      return true;
    } catch (e) {
      state = 'needs-permission'; notify();
      return false;
    }
  }
  var lastBackup = null;

  // Запись с возвратом отпечатка файла — по нему видно чужие изменения
  async function writeFileStamped(name, content) {
    var dir = await dataDir();
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(content);
    await w.close();
    var f = await fh.getFile();
    return f.lastModified + ':' + f.size;
  }

  async function loadSaved() {
    if (state !== 'ready') return null;
    var text = await readFile(DATA_FILE);
    if (!text) return null;
    try {
      var obj = JSON.parse(text);
      lastSaved = obj.saved ? new Date(obj.saved) : null;
      // запоминаем отпечаток прочитанного файла: с ним сверяемся перед записью
      try {
        var f = await (await (await dataDir()).getFileHandle(DATA_FILE)).getFile();
        dataStamp = f.lastModified + ':' + f.size;
      } catch (e) { dataStamp = null; }
      notify();
      return obj.data || obj;
    } catch (e) { return null; }
  }

  /* --- чтение выгрузок 1С из подключённой папки --- */
  // Ищем файлы в самой папке и во вложенной «Данные_1С_и_Excel»
  async function listExports() {
    if (state !== 'ready') return [];
    var out = [];
    async function scan(handle, prefix) {
      for await (var entry of handle.values()) {
        if (entry.kind === 'file') {
          if (!/\.(xls|xlsx|csv)$/i.test(entry.name) || /^~\$/.test(entry.name)) continue;
          if (entry.name === BOOK_FILE) continue;   // это наша книга, а не выгрузка 1С
          var file = await entry.getFile();
          out.push({ name: prefix + entry.name, file: file, stamp: file.lastModified + ':' + file.size });
        } else if (entry.kind === 'directory' && /данные|выгруз|1с|excel/i.test(entry.name) && prefix.length < 40) {
          if (entry.name === DATA_DIR) continue;
          await scan(entry, prefix + entry.name + '/');
        }
      }
    }
    await scan(dirHandle, '');
    return out;
  }

  return {
    supported: supported, connect: connect, restore: restore, reconnect: reconnect, forget: forget,
    scheduleSave: scheduleSave, saveNow: saveNow, loadSaved: loadSaved,
    listExports: listExports, writeFile: writeFile, readFile: readFile, onChange: onChange,
    saveBook: saveBook, bookChangedOutside: bookChangedOutside, rootFile: rootFile, writeRoot: writeRoot,
    foreignChange: foreignChange, setKeepBackups: setKeepBackups, trimBackups: trimBackups,
    get bookSaved() { return bookSaved; },
    BOOK_FILE: BOOK_FILE,
    get state() { return state; },
    get lastSaved() { return lastSaved; },
    get dirName() { return dirHandle ? dirHandle.name : ''; },
    DATA_DIR: DATA_DIR, DATA_FILE: DATA_FILE
  };
});
