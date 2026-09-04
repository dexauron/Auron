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
  // unsupported — браузер не умеет | off — папка не подключена
  // needs-permission — браузер ждёт клика, чтобы снова открыть доступ
  // lost — папку помним, но её больше нет на месте (переехала, переименована, удалена)
  // ready — всё в порядке, пишем
  var state = 'unsupported';
  var lastSaved = null;
  var saveTimer = null;
  var listeners = [];

  function supported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  function notify() { listeners.forEach(function (fn) { try { fn(state, lastSaved); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  /* --- Понятные объяснения вместо английских ошибок браузера ---------------
     Браузер отвечает вроде «A requested file or directory could not be found»
     — владельцу это ничего не говорит. Переводим в человеческий язык и заодно
     переводим саму программу в честное состояние.
     ---------------------------------------------------------------------- */
  function errName(e) {
    if (!e) return '';
    if (e.name) return e.name;
    // Firefox иногда отдаёт ошибку без имени — узнаём по тексту
    var t = String(e.message || e);
    if (/not be found|no such file|NotFound/i.test(t)) return 'NotFoundError';
    if (/permission|not allowed/i.test(t)) return 'NotAllowedError';
    return '';
  }

  // Папка пропала? Тогда врать «сохраняется в папку» больше нельзя.
  function markByError(e) {
    var n = errName(e);
    if (n === 'NotFoundError') { state = 'lost'; notify(); return 'lost'; }
    if (n === 'NotAllowedError' || n === 'SecurityError') { state = 'needs-permission'; notify(); return 'needs-permission'; }
    return state;
  }

  function humanError(e) {
    var n = errName(e);
    if (n === 'AbortError') return '';                 // владелец сам закрыл окно выбора
    if (n === 'NotFoundError') {
      return 'Папка, которую программа помнит, не найдена: её переименовали, перенесли или удалили. ' +
        'Нажмите «Выбрать папку заново» и укажите папку программы — записи не потеряются, ' +
        'они лежат внутри браузера.';
    }
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      return 'Браузер закрыл доступ к папке. Нажмите «Подключить папку» и разрешите доступ ещё раз.';
    }
    if (n === 'NoModificationAllowedError') {
      return 'Файл занят другой программой. Закройте книгу «Бухгалтерия» в Excel и попробуйте снова.';
    }
    if (n === 'QuotaExceededError') return 'На диске не осталось места.';
    if (n === 'TypeMismatchError') return 'Выбран файл вместо папки. Укажите именно папку программы.';
    return (e && e.message) ? e.message : 'Неизвестная ошибка.';
  }

  // Папка ещё на месте? Дешёвая проверка: пробуем заглянуть внутрь.
  async function alive() {
    if (!dirHandle) return false;
    try {
      await dirHandle.values().next();
      return true;
    } catch (e) { markByError(e); return false; }
  }

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
    bookStamp = null; dataStamp = null; lastBackup = null;   // папка новая — отпечатки старой не годятся
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
      if (perm !== 'granted') { state = 'needs-permission'; notify(); return state; }
      // разрешение есть — но папку могли перенести или удалить, проверяем
      state = 'ready';
      if (!(await alive())) return state;   // alive() сам поставит 'lost'
    } catch (e) {
      state = 'off';
    }
    notify();
    return state;
  }

  // Повторно запросить разрешение — вызывать только из обработчика клика
  async function reconnect() {
    if (!dirHandle || state === 'lost') return connect();
    var perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Разрешение на папку не выдано.');
    state = 'ready'; notify();
    // разрешение выдано, но папки может уже не быть — тогда предлагаем выбрать заново
    if (!(await alive())) return connect();
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
  /* 127. История версий книги: рядом с базой храним датированные копии
     самой книги «Бухгалтерия.xlsx». Если владелец случайно испортил формулу
     или удалил лист — можно вернуться ко вчерашней книге, а не только к базе. */
  var BOOK_DIR = 'копии книги';
  var lastBookCopy = null;
  async function saveBook(bytes) {
    if (state !== 'ready') return false;
    try {
      bookStamp = await writeRoot(BOOK_FILE, bytes);
      bookSaved = new Date();
      // одна копия в час: чаще — бессмысленно, реже — можно потерять день работы
      var hourStamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 13);
      if (lastBookCopy !== hourStamp) {
        try {
          await writeFile('Бухгалтерия-' + hourStamp + '.xlsx', bytes, BOOK_DIR);
          lastBookCopy = hourStamp;
          await trimBookCopies();
        } catch (e) { /* копия книги не должна мешать записи самой книги */ }
      }
      notify();
      return true;
    } catch (e) { markByError(e); return false; }
  }
  async function trimBookCopies() {
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BOOK_DIR, { create: true });
      var names = [];
      for await (var entry of dir.values()) {
        if (entry.kind === 'file' && /^Бухгалтерия-.*\.xlsx$/i.test(entry.name)) names.push(entry.name);
      }
      names.sort();
      while (names.length > keepBackups) {
        var old = names.shift();
        try { await dir.removeEntry(old); } catch (e) { break; }
      }
    } catch (e) { /* чистка не критична */ }
  }
  async function listBookCopies() {
    if (state !== 'ready') return [];
    var out = [];
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BOOK_DIR, { create: true });
      for await (var entry of dir.values()) {
        if (entry.kind !== 'file') continue;
        var m = entry.name.match(/^Бухгалтерия-(\d{4})-(\d{2})-(\d{2})-(\d{2})\.xlsx$/i);
        if (!m) continue;
        var file = await entry.getFile();
        out.push({ name: entry.name, date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] + ':00',
          size: file.size, when: new Date(+m[1], +m[2] - 1, +m[3], +m[4]) });
      }
    } catch (e) { markByError(e); return []; }
    return out.sort(function (a, b) { return b.when - a.when; });
  }
  // Байты одной копии книги — чтобы открыть её или вернуть на место
  async function readBookCopy(name) {
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BOOK_DIR, { create: true });
      var f = await (await dir.getFileHandle(name)).getFile();
      return new Uint8Array(await f.arrayBuffer());
    } catch (e) { return null; }
  }
  // Книга из корня папки — для восстановления базы, если json потерялся (125)
  async function readBookBytes() {
    var f = await rootFile(BOOK_FILE);
    if (!f) return null;
    return new Uint8Array(await f.arrayBuffer());
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
      // пропала папка — это не «нет разрешения», и владельцу надо сказать правду
      if (markByError(e) === state && state === 'ready') { state = 'needs-permission'; notify(); }
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

  /* --- копии базы: список и откат на выбранную дату ------------------------
     Копии лежат в «Данные_дашборда/копии» с именем «база-2026-09-03-14-25.json».
     Отсюда владелец может вернуть базу такой, какой она была в тот момент.
     ---------------------------------------------------------------------- */
  /* --- 124. Проверка копии: программа сама пробует её прочитать ---------------
     Копия, которую нельзя открыть, — это не копия, а спокойствие на пустом
     месте. Поэтому после записи файл читается обратно и разбирается: если
     что-то не так, владелец узнаёт сразу, а не в день беды.
     ------------------------------------------------------------------------ */
  function countRecords(data) {
    var n = 0;
    Object.keys(data || {}).forEach(function (k) {
      if (Array.isArray(data[k])) n += data[k].length;
    });
    return n;
  }
  // Прочитать один файл копии и сказать, живой он или нет
  async function verifyBackup(name) {
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BACKUP_DIR, { create: true });
      var fh = await dir.getFileHandle(name);
      var f = await fh.getFile();
      if (!f.size) return { name: name, ok: false, why: 'файл пустой' };
      var text = await f.text();
      var obj = JSON.parse(text);
      var data = obj.data || obj;
      var n = countRecords(data);
      if (!n) return { name: name, ok: false, why: 'в файле нет ни одной записи' };
      return { name: name, ok: true, records: n, size: f.size,
        saved: obj.saved || '', collections: Object.keys(data).filter(function (k) {
          return Array.isArray(data[k]) && data[k].length; }).length };
    } catch (e) {
      return { name: name, ok: false,
        why: e && e.name === 'SyntaxError' ? 'файл повреждён — не читается как база' : humanError(e) };
    }
  }
  // Проверить сразу несколько последних копий
  async function verifyBackups(howMany) {
    var list = await listBackups();
    var take = list.slice(0, Math.max(1, howMany || 3));
    var out = [];
    for (var i = 0; i < take.length; i++) out.push(await verifyBackup(take[i].name));
    return out;
  }

  async function listBackups() {
    if (state !== 'ready') return [];
    var out = [];
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BACKUP_DIR, { create: true });
      for await (var entry of dir.values()) {
        if (entry.kind !== 'file') continue;
        var m = entry.name.match(/^база-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/i);
        if (!m) continue;
        var file = await entry.getFile();
        out.push({
          name: entry.name,
          date: m[1] + '-' + m[2] + '-' + m[3],
          time: m[4] + ':' + m[5],
          size: file.size,
          when: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
        });
      }
    } catch (e) { markByError(e); return []; }
    // свежие сверху
    return out.sort(function (a, b) { return b.name.localeCompare(a.name); });
  }

  // Прочитать копию: возвращает данные или null
  async function readBackup(name) {
    if (state !== 'ready') return null;
    try {
      var dir = await (await dataDir()).getDirectoryHandle(BACKUP_DIR, { create: false });
      var fh = await dir.getFileHandle(name);
      var obj = JSON.parse(await (await fh.getFile()).text());
      return obj.data || obj;
    } catch (e) { markByError(e); return null; }
  }

  // Копия «прямо сейчас», перед опасным действием: сброс, откат, замена базы
  async function backupNow(getData, tag) {
    if (state !== 'ready') return '';
    try {
      var stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      var name = 'база-' + stamp + '.json';
      await writeFile(name, JSON.stringify({
        saved: new Date().toISOString(), tag: tag || '', data: getData()
      }, null, 2), BACKUP_DIR);
      lastBackup = stamp;
      return name;
    } catch (e) { markByError(e); return ''; }
  }

  /* --- Вторая папка для копий: флешка или облачный диск ---------------------
     Папка программы может пропасть вместе с компьютером. Поэтому копию можно
     класть ещё и во вторую папку — на флешку или в папку Яндекс.Диска.
     Ссылка на неё живёт рядом с основной и переживает перезапуск.
     ---------------------------------------------------------------------- */
  var KEY2 = 'backupdir';
  var backupHandle = null;
  var backupState = 'off';     // off | needs-permission | ready | lost
  var lastCopy = null;

  async function connectBackup() {
    if (!supported()) throw new Error('Браузер не умеет сохранять в папку.');
    var handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'waymarket-backup' });
    var perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Разрешение на папку не выдано.');
    backupHandle = handle;
    await idbSet(KEY2, handle);
    backupState = 'ready'; notify();
    return handle;
  }
  async function restoreBackupDir() {
    if (!supported()) { backupState = 'off'; return backupState; }
    try {
      var handle = await idbGet(KEY2);
      if (!handle) { backupState = 'off'; return backupState; }
      backupHandle = handle;
      var perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') { backupState = 'needs-permission'; return backupState; }
      try { await handle.values().next(); backupState = 'ready'; }
      catch (e) { backupState = errName(e) === 'NotFoundError' ? 'lost' : 'needs-permission'; }
    } catch (e) { backupState = 'off'; }
    return backupState;
  }
  function forgetBackup() {
    backupHandle = null; backupState = 'off';
    idbSet(KEY2, null).catch(function () {});
    notify();
  }

  // Копия во вторую папку: имя с датой, чтобы на флешке была история
  async function copyToBackup(getData, tag) {
    if (backupState !== 'ready' || !backupHandle) return '';
    try {
      var stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      var name = 'ВайМаркет-база-' + stamp + '.json';
      var fh = await backupHandle.getFileHandle(name, { create: true });
      var w = await fh.createWritable();
      await w.write(JSON.stringify({ saved: new Date().toISOString(), tag: tag || '', data: getData() }, null, 2));
      await w.close();
      lastCopy = new Date();
      notify();
      return name;
    } catch (e) {
      if (errName(e) === 'NotFoundError') backupState = 'lost';
      notify();
      return '';
    }
  }

  // Пора ли копировать: раз в заданное число часов, но не чаще
  var LAST_COPY_KEY = 'wm_last_backup_copy';
  function backupDue(hours) {
    var h = Math.max(1, +hours || 24);
    try {
      var last = localStorage.getItem(LAST_COPY_KEY);
      if (!last) return true;
      return (Date.now() - +last) / 3600000 >= h;
    } catch (e) { return true; }
  }
  function markCopied() {
    try { localStorage.setItem(LAST_COPY_KEY, String(Date.now())); } catch (e) {}
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
    try { await scan(dirHandle, ''); }
    catch (e) { markByError(e); throw e; }
    return out;
  }

  return {
    supported: supported, connect: connect, restore: restore, reconnect: reconnect, forget: forget,
    scheduleSave: scheduleSave, saveNow: saveNow, loadSaved: loadSaved,
    listExports: listExports, writeFile: writeFile, readFile: readFile, onChange: onChange,
    saveBook: saveBook, bookChangedOutside: bookChangedOutside, rootFile: rootFile, writeRoot: writeRoot,
    foreignChange: foreignChange, setKeepBackups: setKeepBackups, trimBackups: trimBackups,
    humanError: humanError, alive: alive,
    listBackups: listBackups, readBackup: readBackup, backupNow: backupNow,
    verifyBackup: verifyBackup, verifyBackups: verifyBackups, countRecords: countRecords,
    listBookCopies: listBookCopies, readBookCopy: readBookCopy, readBookBytes: readBookBytes,
    BOOK_DIR: BOOK_DIR,
    connectBackup: connectBackup, restoreBackupDir: restoreBackupDir, forgetBackup: forgetBackup,
    copyToBackup: copyToBackup, backupDue: backupDue, markCopied: markCopied,
    get backupState() { return backupState; },
    get backupDirName() { return backupHandle ? backupHandle.name : ''; },
    get lastCopy() { return lastCopy; },
    get bookSaved() { return bookSaved; },
    BOOK_FILE: BOOK_FILE,
    get state() { return state; },
    get lastSaved() { return lastSaved; },
    get dirName() { return dirHandle ? dirHandle.name : ''; },
    DATA_DIR: DATA_DIR, DATA_FILE: DATA_FILE
  };
});
