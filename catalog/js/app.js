/* Way Market · Каталог товаров
 * Отдельное приложение с отдельной базой (Supabase). Не связано с Auron Finance.
 * Сотрудники: просмотр и поиск без входа. Владелец: вход → полное редактирование. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CFG = window.CATALOG_CONFIG || {};
  const CACHE_KEY = 'wm_catalog';       // ключ в IndexedDB
  const BUCKET = 'product-photos';
  const SEARCH_THRESHOLD = 25;

  /* ── Хранилище кэша (IndexedDB) ────────────────────
   * Каталог на 16 тыс. товаров — это ~8 МБ, больше лимита localStorage (~5 МБ),
   * поэтому localStorage тихо не сохранял его и каждый заход грузился заново.
   * IndexedDB держит сотни МБ — кэш реально сохраняется, заход мгновенный. */
  const IDB_STORE = 'kv';
  let _idb = null;
  function openIdb() {
    if (_idb) return _idb;
    _idb = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no indexeddb')); return; }
      const req = indexedDB.open('wm_catalog_db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _idb;
  }
  async function idbGet(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, value) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const PAGE_SIZE = 80; // карточек на экране до кнопки «Показать ещё»

  const state = {
    groups: [],
    suppliers: [],
    products: [],
    query: '',
    // Множественный выбор фильтров (объединение: показываем товары, подходящие
    // под любой отмеченный фильтр). Повторный тап снимает отметку.
    selCats: [],      // выбранные категории (разделы) по названию
    selGroups: [],    // выбранные группы: id групп + служебные 'none'/'weighted'
    selSuppliers: [], // выбранные поставщики (id); пусто = все поставщики
    session: null,
    role: null,       // 'admin' | 'manager' | 'cashier' — определяется после входа
    isAdmin: false,   // admin: загрузка и правка каталога
    canPurchase: false, // admin+manager: видят закупочные цены и контакты; кассир — нет
    contacts: {},     // supplier_id → контакты (загружаются после входа)
    competitors: [],  // магазины-конкуренты для «разведки цен» (после входа)
    lastFetch: 0,
    syncMax: '',      // самый свежий updated_at — для докачки только изменившихся товаров
    renderLimit: PAGE_SIZE,
    sort: 'relevance',   // relevance | name | cheap | expensive | new
    view: 'normal',      // normal | compact — размер плиток
    quick: [],           // быстрые фильтры: 'withprice'|'barcode'|'nophoto'|'noprice'|'nobarcode'
    priceMin: null,      // диапазон розничной цены (₽)
    priceMax: null,
    selType: '',         // '' | 'weighted' | 'piece' — весовые/штучные (сотрудникам)
    arrivalFrom: '',     // диапазон дат поступления (завоза), ISO YYYY-MM-DD; пусто = без границы
    arrivalTo: '',
    suggCount: 0,        // сколько фото от покупателей ждёт проверки
    favOnly: false,      // показывать только избранные товары (сердечко)
    popularity: {},      // id товара → сколько раз открывали (для «Популярное»)
    popularTerms: [],    // частые запросы (обезличенно) — подсказки поиска
  };

  let sb = null;
  let currentProduct = null;   // товар, открытый в карточке
  let editingProduct = null;   // товар в форме редактирования (null = новый)
  let formPhotos = [];         // [{url}] сохранённые + [{blob, preview}] новые
  let formSupplierIds = [];    // поставщики, выбранные в форме товара

  /* ── Утилиты ──────────────────────────────────── */

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();

  // «свободная» нормализация: убирает всё, кроме букв и цифр —
  // «арт. 8816» == «арт8816», «0,5» == «0.5» == «05»
  const stripPunct = (s) => norm(s).replace(/[^0-9a-zа-я]+/g, '');
  // как norm, но без trim и без изменения длины (для подсветки — позиции символов сохраняются)
  const hlNorm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

  // подсветка совпавших слов запроса в тексте (безопасно экранирует HTML)
  function highlight(text, tokens) {
    text = String(text ?? '');
    if (!tokens || !tokens.length) return esc(text);
    const low = hlNorm(text);
    const marks = new Array(text.length).fill(false);
    for (const t of tokens) {
      if (!t || t.length < 2) continue;
      let i = low.indexOf(t);
      while (i !== -1) { for (let j = i; j < i + t.length; j++) marks[j] = true; i = low.indexOf(t, i + t.length); }
    }
    let out = ''; let open = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] && !open) { out += '<mark>'; open = true; }
      else if (!marks[i] && open) { out += '</mark>'; open = false; }
      out += esc(text[i]);
    }
    if (open) out += '</mark>';
    return out;
  }

  // Транслитерация: «сникерс» найдёт Snickers, snickers найдёт «Сникерс»
  const TR = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
    т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'u', я: 'a',
  };
  const translit = (s) => s.replace(/[а-я]/g, (ch) => TR[ch] ?? ch);
  // варианты строки для сравнения: как есть + в латинице
  const variants = (s) => {
    const t = translit(s);
    return t === s ? [s] : [s, t];
  };

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2400);
  }

  // ── Окна (шторки): стек + кнопка «назад» телефона + смахивание вниз ──
  const sheetStack = [];
  let expectPop = 0; // сколько наших history.back() ещё «переварить» без действия

  // z-index задаём по порядку ОТКРЫТИЯ, а не по порядку в HTML — иначе окно,
  // открытое позже, могло оказаться ЗА уже открытым (баг «окошки сзади»)
  function restackSheets() {
    sheetStack.forEach((id, i) => {
      const el = $(id);
      if (!el) return;
      el.style.zIndex = String(40 + i * 2);
      // затемняем фон только у верхнего окна — стопка не темнеет вдвое
      el.classList.toggle('backdrop-top', i === sheetStack.length - 1);
    });
  }

  function openSheet(id) {
    const el = $(id);
    if (!el || !el.hidden) return; // нет элемента или уже открыт
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    sheetStack.push(id);
    restackSheets();
    // history-запись: кнопка «назад» на телефоне закроет это окно, а не выйдет из приложения
    try { history.pushState({ wmSheet: id }, ''); } catch (e) { /* некритично */ }
  }

  function hideSheet(id) { // фактическое скрытие, без истории
    const el = $(id);
    if (!el) return;
    el.hidden = true;
    el.style.zIndex = '';
    el.classList.remove('backdrop-top');
    const i = sheetStack.lastIndexOf(id);
    if (i >= 0) sheetStack.splice(i, 1);
    if (!sheetStack.length) document.body.style.overflow = '';
    else restackSheets();
    if (id === 'scanSheet') stopScan();
  }

  function closeSheet(id) {
    const el = $(id);
    if (!el || el.hidden) return;
    hideSheet(id);
    // «съедаем» нашу history-запись, чтобы счётчик «назад» не сбился
    if (window.history.state && window.history.state.wmSheet) { expectPop++; try { history.back(); } catch (e) { expectPop--; } }
  }

  window.addEventListener('popstate', () => {
    if (expectPop > 0) { expectPop--; return; } // это наш собственный закрывающий back — окно уже скрыто
    const lb = $('lightbox');
    if (lb && !lb.hidden) { lb.hidden = true; lb.querySelector('img') && (lb.querySelector('img').src = ''); return; } // «назад» закрывает фото на весь экран
    if (sheetStack.length) hideSheet(sheetStack[sheetStack.length - 1]); // «назад» на телефоне → закрыть верхнее окно
  });

  // Стрелка «назад» в левом верхнем углу каждого окна
  function addBackButtons() {
    document.querySelectorAll('.sheet').forEach((sheet) => {
      const bd = sheet.closest('.sheet-backdrop');
      if (!bd || sheet.hasAttribute('data-no-back') || sheet.querySelector('.sheet-back')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheet-back';
      b.setAttribute('aria-label', 'Назад');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
      b.addEventListener('click', () => closeSheet(bd.id));
      sheet.insertBefore(b, sheet.firstChild);
    });
  }

  // Смахивание шторки вниз, чтобы закрыть — в стиле iPhone: окно тянется за
  // пальцем, фон плавно светлеет, при отпускании — мягкая «пружина» назад,
  // а быстрый флик закрывает даже с небольшого расстояния.
  function enableSwipeToClose() {
    const NO_DRAG = 'button,a,input,textarea,select,label,.photo-strip,.price-history,.scan-box';
    const SPRING = 'transform .38s cubic-bezier(.32,.72,0,1)';
    document.querySelectorAll('.sheet').forEach((sheet) => {
      const bd = sheet.closest('.sheet-backdrop');
      let startY = 0; let cur = 0; let drag = false; let lastY = 0; let lastT = 0; let vel = 0;
      sheet.addEventListener('touchstart', (e) => {
        if (sheet.scrollTop > 3) return;            // контент прокручен — не мешаем скроллу
        if (e.target.closest(NO_DRAG)) return;      // не перехватываем кнопки/поля/листание фото
        startY = e.touches[0].clientY; cur = 0; drag = true;
        lastY = startY; lastT = e.timeStamp || Date.now(); vel = 0;
        sheet.style.transition = 'none';
      }, { passive: true });
      sheet.addEventListener('touchmove', (e) => {
        if (!drag) return;
        const y = e.touches[0].clientY;
        let d = y - startY;
        // тянешь вверх — сопротивление «резинки», как в iOS
        cur = d >= 0 ? d : -Math.pow(-d, 0.75);
        const now = e.timeStamp || Date.now();
        if (now > lastT) { vel = (y - lastY) / (now - lastT); lastY = y; lastT = now; }
        sheet.style.transform = `translateY(${cur}px)`;
        if (bd) bd.style.opacity = String(Math.max(0.25, 1 - Math.max(0, cur) / (sheet.offsetHeight || 600)));
      }, { passive: true });
      const finish = () => {
        if (!drag) return;
        drag = false;
        sheet.style.transition = SPRING;
        sheet.style.transform = '';
        if (bd) { bd.style.transition = 'opacity .3s ease'; bd.style.opacity = ''; }
        // закрыть, если утянул далеко ИЛИ быстро фликнул вниз
        if ((cur > 110 || (vel > 0.6 && cur > 40)) && bd) closeSheet(bd.id);
        setTimeout(() => { sheet.style.transition = ''; if (bd) bd.style.transition = ''; }, 400);
      };
      sheet.addEventListener('touchend', finish);
      sheet.addEventListener('touchcancel', finish);
    });
  }

  function groupById(id) { return state.groups.find((g) => g.id === id) || null; }
  function supplierById(id) { return state.suppliers.find((s) => s.id === id) || null; }

  /* ── Категории: 200+ групп 1С → ~12 понятных разделов ──
   * Раскладываем автоматически по названию группы. Первое совпадение выигрывает.
   * Порядок правил важен: сначала точные (детское, гигиена), потом общие. */
  const CATEGORIES = [
    { name: 'Детское',           icon: '👶', re: /детск|подгуз|пластилин|игрушечные яйц/ },
    { name: 'Красота и гигиена', icon: '🧴', re: /шампун|бальзам|кондиционер для волос|краск[аи] для волос|мыл|зубн|дезодор|женская гигиен|влажные салфет|ватные|крем|космет|станки|для обуви|прокладк/ },
    { name: 'Дом и химия',       icon: '🧽', re: /стир|порошок|ополаск|мытья посуд|чистящ|для стекол|освежит|ароматизат|мешки|пакет|полотенц|салфет|туалетная бумага|мочалк|губк|тряпк|швабр|ведр|щетк|уборк|перчатк|насиком|для кошек|для собак|бель|батарейк|лампочк|удлинител|свеч|зажигалк|спичк|скотч|изолент|клей|канц|тетрад|ручк|карандаш|маркер|фломастер|ластик|точилк|линейк|ножниц|кист|краск|альбом|блокнот|фольг|пленк|запекан|пластиков|деревянн|стакан|тарелк|товары для дома|товары для|подарочн|подставк|аксесуар|носки|колготк|инструмент|хими/ },
    { name: 'Напитки',           icon: '🥤', re: /вода|сок|лимонад|напит|энергет|кофе|чай|какао|коктел|квас|сироп/ },
    { name: 'Молочное',          icon: '🥛', re: /молок|молоч|кефир|йогурт|творог|сметан|сливк|сыр|масло сливоч|сгущ|яйц/ },
    { name: 'Мясо и рыба',       icon: '🥩', re: /колбас|мясн|курин|фарш|полуфабрикат|рыба|морепродукт|икра|сосиск|паштет|суш[её]ное мясо|сущ[её]ное мясо/ },
    { name: 'Заморозка',         icon: '❄️', re: /заморож|мороженн/ },
    { name: 'Хлеб и выпечка',    icon: '🍞', re: /хлеб|булоч|булк|выпечк|лаваш|кекс|рулет|пирожн|торт|фаст[\s-]?фуд|фастфуд/ },
    { name: 'Сладости',          icon: '🍬', re: /конфет|шоколад|драже|карамел|мармелад|зефир|пастил|печен|пряник|вафл|халв|козинак|леденц|чупа|рахат|батончик|жеват|мед|варень|джем|повидл|кондитер|сладост|десерт|яшкино|ulker/ },
    { name: 'Снеки',             icon: '🍟', re: /чипс|снэк|снек|попкорн|кукурузн|семечк|арахис|фисташк|сухофрукт|орех|хлопья|готовый завтрак|сухар|хлебц|мюсли/ },
    { name: 'Овощи и фрукты',    icon: '🥦', re: /овощ|фрукт|зелень|гриб/ },
    { name: 'Бакалея',           icon: '🛒', re: /бакале|греч|рис|пшено|перловк|манк|булгур|каша|овсянк|круп|мука|сахар|соль|сода|дрожж|макарон|лапша|масло|фасол|специ|приправ|соус|томат|майонез|кетчуп|уксус|консерв|маринован|кулинар|безглютен|европейские|готовый|диетическ/ },
  ];
  const OTHER_CAT = { name: 'Прочее', icon: '📦' };
  const catCache = {};
  function categoryOf(groupName) {
    const key = groupName || '';
    if (key in catCache) return catCache[key];
    const n = norm(key);
    let cat = OTHER_CAT.name;
    for (const c of CATEGORIES) if (c.re.test(n)) { cat = c.name; break; }
    catCache[key] = cat;
    return cat;
  }
  const catIcon = (name) => (CATEGORIES.find((c) => c.name === name) || OTHER_CAT).icon;
  const productCategory = (p) => { const g = groupById(p.group_id); return g ? categoryOf(g.name) : null; };

  const fmtPrice = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
  // цена с единицей: у весовых показываем «/кг», чтобы было понятно
  const fmtRetail = (p) => fmtPrice(p.retail_price) + (p.is_weighted ? '/кг' : '');
  const fmtDate = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}.${m}.${y.slice(2)}`; };
  // цена старше этого срока считается устаревшей: нового поступления давно не было,
  // цена у поставщика могла измениться — не помечаем такую как «выгодную»
  const STALE_PRICE_DAYS = 30;
  const priceAgeDays = (d) => Math.floor((Date.now() - new Date(String(d).slice(0, 10) + 'T00:00:00').getTime()) / 86400000);
  const isFreshPrice = (row) => row && priceAgeDays(row.price_date) <= STALE_PRICE_DAYS;
  const telHref = (phone) => 'tel:' + String(phone).replace(/[^+\d]/g, '');
  const waHref = (phone) => {
    let d = String(phone).replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    return 'https://wa.me/' + d;
  };

  /* ── Умный поиск ──────────────────────────────── */

  function bigrams(s) {
    const set = [];
    const str = ` ${s} `;
    for (let i = 0; i < str.length - 1; i++) set.push(str.slice(i, i + 2));
    return set;
  }

  function dice(a, b) {
    if (!a.length || !b.length) return 0;
    const bCopy = [...b];
    let hits = 0;
    for (const g of a) {
      const i = bCopy.indexOf(g);
      if (i !== -1) { hits++; bCopy.splice(i, 1); }
    }
    return (2 * hits) / (a.length + b.length);
  }

  // Поисковый индекс считается один раз при загрузке данных, а не на каждую букву —
  // иначе на 15 000+ товаров поиск будет тормозить на телефоне
  function buildIndex() {
    for (const p of state.products) {
      const name = norm(p.name);
      p._name = name;
      p._nameT = translit(name);
      p._codes = [p.code, p.article, p.department, ...(p.barcodes || [])].map(norm).filter(Boolean);
      p._codesLoose = p._codes.map(stripPunct).filter(Boolean);
      p._nameLoose = stripPunct(name);
      const sup = (p.supplier_ids || []).map((id) => supplierById(id)?.name).filter(Boolean).join(' ');
      p._sup = norm(sup);
      p._supT = translit(p._sup);
      p._grp = norm(groupById(p.group_id)?.name || '');
      p._grpT = translit(p._grp);
      p._note = norm(p.note || '');
    }
  }

  // сравнение текста с запросом с учётом транслитерации (рус ↔ англ)
  function matchPre(text, textT, qVars, w) {
    if (!text) return 0;
    let s = 0;
    const tvs = text === textT ? [text] : [text, textT];
    for (const tv of tvs) {
      for (const qv of qVars) {
        if (tv.startsWith(qv)) s = Math.max(s, w[0]);
        else if (tv.includes(' ' + qv)) s = Math.max(s, w[1]);
        else if (tv.includes(qv)) s = Math.max(s, w[2]);
      }
    }
    return s;
  }

  // нечёткое совпадение — прощает опечатки («хатдок» найдёт «хот-дог», «сникерс» — Snickers)
  function fuzzyScore(name, nameT, qVars) {
    let best = 0;
    const nvs = name === nameT ? [name] : [name, nameT];
    for (const nv of nvs) {
      const clean = nv.replace(/[^a-zа-я0-9 ]/g, '');
      const words = clean.split(/\s+/).filter(Boolean);
      for (const qv of qVars) {
        const qWords = qv.replace(/[^a-zа-я0-9 ]/g, '').split(/\s+/).filter((w) => w.length >= 3);
        if (!qWords.length) continue;
        let total = 0;
        for (const qw of qWords) {
          const qb = bigrams(qw);
          let b = dice(qb, bigrams(clean.replace(/\s+/g, '')));
          for (const w of words) b = Math.max(b, dice(qb, bigrams(w)));
          total += b;
        }
        best = Math.max(best, total / qWords.length);
      }
    }
    return best;
  }

  // счёт одного слова запроса по товару (имя, коды/штрихкоды, поставщик, группа)
  function scoreToken(p, q, qVars) {
    let s = 0;
    for (const c of p._codes) {
      if (c === q) return 120;
      if (c.startsWith(q)) s = Math.max(s, 95);
      else if (c.includes(q)) s = Math.max(s, 70);
    }
    // поиск без учёта знаков/пробелов: «арт8816» найдёт «арт. 8816», «0.5» → «0,5»
    if (s < 95) {
      const qL = stripPunct(q);
      if (qL) {
        for (const c of (p._codesLoose || [])) {
          if (c === qL) return 118;
          if (c.startsWith(qL)) s = Math.max(s, 92);
          else if (c.includes(qL)) s = Math.max(s, 68);
        }
        if (qL.length >= 3 && (p._nameLoose || '').includes(qL)) s = Math.max(s, 78);
      }
    }
    s = Math.max(s, matchPre(p._name, p._nameT, qVars, [100, 90, 80]));
    if (p._sup) s = Math.max(s, matchPre(p._sup, p._supT, qVars, [60, 57, 55]));
    if (p._grp) s = Math.max(s, matchPre(p._grp, p._grpT, qVars, [45, 42, 40]));
    if (p._note) s = Math.max(s, matchPre(p._note, p._note, qVars, [38, 36, 35]));
    if (p.is_weighted && ('весовой'.startsWith(q) || 'весовые'.startsWith(q) || q === 'вес')) {
      s = Math.max(s, 45);
    }
    // нечёткий поиск — только если точного совпадения не нашлось (прощает опечатки)
    if (s < 60 && q.length >= 3) {
      const fuzzy = fuzzyScore(p._name, p._nameT, qVars);
      if (fuzzy >= 0.4) s = Math.max(s, Math.round(65 * fuzzy));
    }
    return s;
  }

  // умный поиск: либо вся фраза подряд (как раньше), либо КАЖДОЕ слово в любом
  // порядке (напр. «печенье яшкино» найдёт «Яшкино Печенье…»). Берём лучшее —
  // ничего из прежнего поведения не теряем.
  function scoreProduct(p, q, qVars, tokens) {
    const whole = scoreToken(p, q, qVars);
    if (!tokens || tokens.length <= 1) return whole;
    let total = 0;
    for (const tok of tokens) {
      const s = scoreToken(p, tok.q, tok.qVars);
      if (s <= 0) { total = 0; break; } // слово не найдено → товар не подходит
      total += s;
    }
    const multi = total ? Math.round(total / tokens.length) : 0;
    return Math.max(whole, multi);
  }

  const hasRetail = (p) => p.retail_price != null && p.retail_price !== '';

  // дата поступления берётся СТРОГО из файла «Цены поставщиков» (колонка «Период» —
  // дата последнего обновления цены). Нет даты — товар не попадает в фильтр по
  // поступлению (не подменяем датой добавления, иначе результат врёт).
  const arrivalDate = (p) => String(p.arrival_at || '').slice(0, 10);
  // есть ли в базе колонка (по загруженным товарам). Если новой колонки ещё нет —
  // не пишем её, чтобы импорт/сохранение не падали; после SQL заполнится.
  const hasProductCol = (c) => (state.products.length ? (c in state.products[0]) : true);
  const arrivalColExists = () => hasProductCol('arrival_at');
  // местная календарная дата (не UTC) — чтобы «сегодня» совпадало с датами из файла
  const localISO = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const todayISO = () => localISO(new Date());
  const daysAgoISO = (n) => localISO(new Date(Date.now() - n * 86400000));
  // есть ли у товара хотя бы одно НЕПУСТОЕ фото (пустые строки не считаются)
  const hasPhoto = (p) => (p.photos || []).some((u) => u && String(u).trim());

  // предикаты быстрых фильтров
  const QUICK = {
    withprice: (p) => hasRetail(p),
    barcode: (p) => (p.barcodes || []).length > 0,
    nophoto: (p) => !hasPhoto(p),
    noprice: (p) => !hasRetail(p),
    nobarcode: (p) => !(p.barcodes || []).length,
  };

  // сортировка готового списка по выбранному порядку
  function sortList(list, scored) {
    const price = (p) => (hasRetail(p) ? Number(p.retail_price) : null);
    const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
    // «новые» = позже поступившие (дата из файла цен; если её нет — дата добавления)
    const when = (p) => p.arrival_at || p.created_at || '';
    switch (state.sort) {
      case 'name': return list.slice().sort(byName);
      case 'cheap': return list.slice().sort((a, b) => {
        const x = price(a); const y = price(b);
        if (x == null && y == null) return byName(a, b);
        if (x == null) return 1; if (y == null) return -1;
        return x - y || byName(a, b);
      });
      case 'expensive': return list.slice().sort((a, b) => {
        const x = price(a); const y = price(b);
        if (x == null && y == null) return byName(a, b);
        if (x == null) return 1; if (y == null) return -1;
        return y - x || byName(a, b);
      });
      case 'new': return list.slice().sort((a, b) => String(when(b)).localeCompare(String(when(a))) || byName(a, b));
      case 'popular': return list.slice().sort((a, b) => (popViews(b.id) - popViews(a.id)) || byName(a, b));
      default: // relevance: при поиске порядок уже по совпадению; без поиска — по названию
        return scored ? list : list.slice().sort(byName);
    }
  }

  // Предикат «товар подходит под выбранные категории/подгруппы».
  // Ключевая логика: если внутри выбранной категории отмечены КОНКРЕТНЫЕ подгруппы —
  // показываем только их (сужение), а не всю категорию. Так подкатегории реально
  // работают вместе с категорией, а не «тонут» в объединении.
  function catGroupPredicate() {
    const { selCats, selGroups } = state;
    const active = selCats.length > 0 || selGroups.length > 0;
    const realGroups = new Set(selGroups.filter((g) => g !== 'none' && g !== 'weighted'));
    const noneSel = selGroups.includes('none');
    const weightedSel = selGroups.includes('weighted');
    const catSet = new Set(selCats);
    // категории, у которых выбрана хотя бы одна своя подгруппа → показываем только подгруппы
    const catsWithSub = new Set();
    realGroups.forEach((gid) => { const g = groupById(gid); if (g) { const c = categoryOf(g.name); if (c) catsWithSub.add(c); } });
    return (p) => {
      if (!active) return true;
      if (noneSel && !p.group_id) return true;
      if (weightedSel && p.is_weighted) return true;
      if (p.group_id && realGroups.has(p.group_id)) return true; // прямое совпадение по подгруппе
      const pc = productCategory(p);
      // вся категория — только если у неё НЕ выбраны отдельные подгруппы
      if (pc && catSet.has(pc) && !catsWithSub.has(pc)) return true;
      return false;
    };
  }

  function visibleProducts() {
    let list = state.products;
    const { selCats, selGroups, selSuppliers, quick } = state;
    // фильтр по группам/категориям (с сужением до подгрупп — см. catGroupPredicate)
    if (selCats.length || selGroups.length) {
      list = list.filter(catGroupPredicate());
    }
    // фильтр по поставщикам — объединение (товар от любого отмеченного)
    if (selSuppliers.length) {
      list = list.filter((p) => (p.supplier_ids || []).some((id) => selSuppliers.includes(id)));
    }
    // только избранное (сердечко) — по локальному списку устройства
    if (state.favOnly) { const f = new Set(favorites()); list = list.filter((p) => f.has(p.id)); }
    // быстрые фильтры — каждый отмеченный обязателен (И)
    if (quick.length) {
      list = list.filter((p) => quick.every((k) => (QUICK[k] ? QUICK[k](p) : true)));
    }
    // тип товара: весовой / штучный (сотрудникам)
    if (state.selType === 'weighted') list = list.filter((p) => p.is_weighted);
    else if (state.selType === 'piece') list = list.filter((p) => !p.is_weighted);
    // поступление: произвольный диапазон дат «с … по …» (по дате завоза)
    if (state.arrivalFrom) list = list.filter((p) => { const d = arrivalDate(p); return d && d >= state.arrivalFrom; });
    if (state.arrivalTo) list = list.filter((p) => { const d = arrivalDate(p); return d && d <= state.arrivalTo; });
    // диапазон цены
    if (state.priceMin != null) list = list.filter((p) => hasRetail(p) && Number(p.retail_price) >= state.priceMin);
    if (state.priceMax != null) list = list.filter((p) => hasRetail(p) && Number(p.retail_price) <= state.priceMax);

    const q = norm(state.query);
    if (!q) return sortList(list, false);
    const qT = translit(q);
    const qVars = q === qT ? [q] : [q, qT];
    // слова запроса — каждое ищется отдельно (в любом порядке)
    const tokens = q.split(/\s+/).filter(Boolean).map((w) => {
      const wt = translit(w);
      return { q: w, qVars: w === wt ? [w] : [w, wt] };
    });
    const scored = list
      .map((p) => ({ p, s: scoreProduct(p, q, qVars, tokens) }))
      .filter((x) => x.s >= SEARCH_THRESHOLD)
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name, 'ru'))
      .map((x) => x.p);
    return sortList(scored, true);
  }

  // слова запроса для подсветки (только буквенно-цифровые, длиннее 1 символа)
  function queryHlTokens() {
    return norm(state.query).split(/\s+/).map((w) => w.replace(/[^0-9a-zа-я]/g, '')).filter((w) => w.length >= 2);
  }

  /* ── Отрисовка ────────────────────────────────── */

  function renderChips() {
    const groupCounts = {};   // товаров в каждой группе
    const catCounts = {};     // товаров в каждой категории
    let noGroup = 0;
    let weighted = 0;
    for (const p of state.products) {
      if (p.group_id) {
        groupCounts[p.group_id] = (groupCounts[p.group_id] || 0) + 1;
        const cat = productCategory(p);
        if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
      } else noGroup++;
      if (p.is_weighted) weighted++;
    }

    // ── Верхний ряд: Все · Сбросить · Поставщики · Ходовые · Весовые · категории ──
    const { selCats, selGroups, selSuppliers } = state;
    const allActive = !selCats.length && !selGroups.length;
    // «Сбросить всё» теперь живёт в строке активных фильтров (renderActiveFilters),
    // поэтому здесь дублирующую кнопку не показываем — чище
    let html = `<button class="chip${allActive && !state.favOnly ? ' active' : ''}" data-all>Все<span class="chip-count">${state.products.length}</span></button>`;
    // «Избранное» — показываем, если что-то добавлено в избранное или режим включён
    const favs = favorites();
    if (favs.length || state.favOnly) {
      html += `<button class="chip chip-fav${state.favOnly ? ' active' : ''}" data-fav-chip>♥ Избранное<span class="chip-count">${favs.length}</span></button>`;
    }
    // Поставщики — внутренние данные магазина: показываем только тем, кто видит
    // закупки (админ/аналитик). Покупателям без входа и кассиру их не показываем.
    if (state.canPurchase && state.suppliers.length) {
      const label = !selSuppliers.length ? '🚚 Поставщики'
        : selSuppliers.length === 1 ? `🚚 ${supplierById(selSuppliers[0])?.name || 'Поставщик'}`
          : `🚚 Поставщиков: ${selSuppliers.length}`;
      const cnt = selSuppliers.length
        ? state.products.filter((p) => (p.supplier_ids || []).some((id) => selSuppliers.includes(id))).length
        : state.suppliers.length;
      html += `<button class="chip${selSuppliers.length ? ' active' : ''}" data-supplier-chip>${esc(label)}<span class="chip-count">${cnt}</span></button>`;
    }
    if (state.canPurchase) html += '<button class="chip" data-top-chip>🔥 Ходовые</button>';
    if (weighted > 0) html += `<button class="chip${selGroups.includes('weighted') ? ' active' : ''}" data-group="weighted">⚖ Весовые<span class="chip-count">${weighted}</span></button>`;
    // сотруднику — быстрый «пришло сегодня» одним тапом (по дате из файла «Цены
    // поставщиков», столбец «Период»). Совмещается с «Весовые»/категорией.
    if (state.session) {
      const todayOn = state.arrivalFrom === daysAgoISO(0) && state.arrivalTo === todayISO();
      html += `<button class="chip${todayOn ? ' active' : ''}" data-arrival-today>🆕 Пришло сегодня</button>`;
    }

    // категории — по убыванию числа товаров; порядок стабильный
    const cats = [...CATEGORIES.map((c) => c.name), OTHER_CAT.name]
      .filter((c) => catCounts[c])
      .sort((a, b) => catCounts[b] - catCounts[a]);
    for (const c of cats) {
      const active = selCats.includes(c) ? ' active' : '';
      html += `<button class="chip${active}" data-category="${esc(c)}">${catIcon(c)} ${esc(c)}<span class="chip-count">${catCounts[c]}</span></button>`;
    }
    if (noGroup > 0) html += `<button class="chip${selGroups.includes('none') ? ' active' : ''}" data-group="none">Без группы<span class="chip-count">${noGroup}</span></button>`;
    $('groupChips').innerHTML = html;

    // ── Нижний ряд: подгруппы выбранных категорий (можно отметить несколько) ──
    const sub = $('subChips');
    if (!selCats.length) { sub.hidden = true; sub.innerHTML = ''; return; }
    const subGroups = state.groups
      .filter((g) => selCats.includes(categoryOf(g.name)) && groupCounts[g.id])
      .sort((a, b) => (groupCounts[b.id] || 0) - (groupCounts[a.id] || 0));
    let subHtml = '';
    for (const g of subGroups) subHtml += chipHtml(g.id, g.name, groupCounts[g.id] || 0);
    sub.innerHTML = subHtml;
    sub.hidden = !subHtml;
  }

  function chipHtml(id, name, count) {
    const active = state.selGroups.includes(id) ? ' active' : '';
    return `<button class="chip${active}" data-group="${esc(id)}">${esc(name)}<span class="chip-count">${count}</span></button>`;
  }

  function renderGrid() {
    const list = visibleProducts();
    const grid = $('productGrid');
    $('loader').hidden = true;
    grid.classList.toggle('compact', state.view === 'compact');
    grid.classList.remove('skeleton');
    updateResultsCount(list.length);

    if (!list.length) {
      grid.innerHTML = '';
      const empty = $('emptyState');
      empty.hidden = false;
      const filtered = anyFilterActive() || state.favOnly;
      if (state.favOnly && !favorites().length) {
        empty.querySelector('.empty-icon').textContent = '♡';
        empty.querySelector('.empty-title').textContent = 'В избранном пусто';
        empty.querySelector('.empty-text').textContent = 'Открой товар и нажми ♥ — он появится здесь';
      } else if (!state.products.length) {
        empty.querySelector('.empty-icon').textContent = '📦';
        empty.querySelector('.empty-title').textContent = 'Каталог пока пустой';
        empty.querySelector('.empty-text').textContent = state.session
          ? 'Нажми ＋ внизу, чтобы добавить первый товар'
          : 'Администратор скоро его заполнит';
      } else {
        empty.querySelector('.empty-icon').textContent = '🔍';
        empty.querySelector('.empty-title').textContent = 'Ничего не нашлось';
        empty.querySelector('.empty-text').textContent = filtered
          ? 'Под выбранные фильтры товаров нет. Снимите часть фильтров.'
          : 'Попробуй написать по-другому или выбери группу';
      }
      // когда пусто из-за фильтров — предлагаем сбросить одним касанием
      $('emptyReset').hidden = !(filtered && state.products.length);
      return;
    }

    $('emptyState').hidden = true;
    // на больших каталогах рисуем страницами — телефон не потянет 15 000 карточек разом
    const shown = list.slice(0, state.renderLimit);
    const hlTokens = queryHlTokens();
    let html = shown.map((p) => {
      const photo = (p.photos || []).find((u) => u && String(u).trim());
      const img = photo
        ? `<img src="${esc(photo)}" alt="" loading="lazy">`
        : '📦';
      const photoCls = photo ? 'card-photo' : 'card-photo no-photo';
      // минимализм: на плитке только код и, если весовой, значок ⚖ — остальное в карточке
      const tags = [];
      if (p.code) tags.push(`<span class="tag tag-code">${esc(p.code)}</span>`);
      if (p.is_weighted) tags.push('<span class="tag">⚖</span>');
      const price = (p.retail_price != null && p.retail_price !== '')
        ? `<div class="card-price">${esc(fmtRetail(p))}</div>` : '';
      return `<article class="card" data-id="${esc(p.id)}">
        <div class="${photoCls}">${img}</div>
        <div class="card-body">
          <div class="card-name">${highlight(p.name, hlTokens)}</div>
          ${price}
          <div class="card-tags">${tags.join('')}</div>
        </div>
      </article>`;
    }).join('');
    grid.innerHTML = html;
    document.querySelectorAll('.load-more').forEach((b) => b.remove());
    if (list.length > shown.length) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary load-more';
      btn.textContent = `Показать ещё (осталось ${list.length - shown.length})`;
      btn.addEventListener('click', () => {
        state.renderLimit += 200;
        renderGrid();
      });
      grid.after(btn);
    }
  }

  // мерцающие плитки-заглушки, пока каталог грузится (вместо пустого экрана)
  function showSkeleton() {
    const grid = $('productGrid');
    if (grid.children.length) return; // уже что-то показано (кэш)
    $('loader').hidden = true;
    grid.classList.remove('compact');
    grid.classList.add('skeleton');
    grid.innerHTML = Array.from({ length: 12 }, () =>
      '<div class="card"><div class="sk-photo"></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('');
  }

  // товары после фильтров по категориям/группам/поставщикам (без быстрых фильтров,
  // цены и поиска) — основа для подсчёта в быстрых фильтрах
  function baseFiltered() {
    const { selCats, selGroups, selSuppliers } = state;
    let list = state.products;
    if (selCats.length || selGroups.length) {
      list = list.filter(catGroupPredicate());
    }
    if (selSuppliers.length) list = list.filter((p) => (p.supplier_ids || []).some((id) => selSuppliers.includes(id)));
    return list;
  }

  const QUICK_CHIPS = [
    { k: 'withprice', label: '✅ С ценой' },
    { k: 'barcode', label: '🏷 Штрихкод' },
    { k: 'nophoto', label: '📷 Без фото', warn: true },
    { k: 'noprice', label: '💰 Без цены', warn: true },
    { k: 'nobarcode', label: '⬜ Без ШК', warn: true },
  ];

  // Категории списком-чекбоксами в окне фильтра (как в референсе)
  function renderFilterCats() {
    const box = $('filterCats');
    if (!box) return;
    const counts = {};
    for (const p of state.products) { const c = productCategory(p); if (c) counts[c] = (counts[c] || 0) + 1; }
    const cats = [...CATEGORIES.map((c) => c.name), OTHER_CAT.name]
      .filter((c) => counts[c]).sort((a, b) => counts[b] - counts[a]);
    if (!cats.length) { box.innerHTML = '<p class="muted" style="margin:0">Категорий пока нет</p>'; return; }
    box.innerHTML = cats.map((c) => {
      const on = state.selCats.includes(c);
      return `<label class="check-row"><input type="checkbox" class="check-cb" data-fcat="${esc(c)}"${on ? ' checked' : ''}>`
        + `<span class="check-text">${catIcon(c)} ${esc(c)}</span><span class="check-count">${counts[c]}</span></label>`;
    }).join('');
  }

  function renderQuick() {
    const base = baseFiltered();
    let html = '';
    for (const c of QUICK_CHIPS) {
      const cnt = base.reduce((n, p) => n + (QUICK[c.k](p) ? 1 : 0), 0);
      if (!cnt && !state.quick.includes(c.k)) continue; // нечего показывать
      const active = state.quick.includes(c.k) ? ' active' : '';
      const warn = c.warn ? ' warn' : '';
      html += `<button class="chip chip-quick${warn}${active}" data-quick="${c.k}">${c.label}<span class="chip-count">${cnt}</span></button>`;
    }
    $('quickChips').innerHTML = html;
  }

  // сколько «фильтров» активно (для значка на кнопке «Фильтры»)
  function countActiveFilters() {
    return state.quick.length + state.selCats.length + state.selGroups.length
      + state.selSuppliers.length + ((state.priceMin != null || state.priceMax != null) ? 1 : 0)
      + (state.selType ? 1 : 0) + ((state.arrivalFrom || state.arrivalTo) ? 1 : 0);
  }

  function updateResultsCount(n) {
    const ap = $('filterApply');
    if (ap) ap.textContent = `Показать ${n}`;
  }

  // синхронизирует окно фильтров и значок с состоянием
  function syncControls() {
    renderFilterCats();
    document.querySelectorAll('#sortSeg button').forEach((b) => b.classList.toggle('active', b.dataset.sort === state.sort));
    document.querySelectorAll('#typeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.selType));
    // даты поступления в поля + подсветка активного пресета
    const af = $('arrivalFrom'); const at = $('arrivalTo');
    if (af && document.activeElement !== af) af.value = state.arrivalFrom || '';
    if (at && document.activeElement !== at) at.value = state.arrivalTo || '';
    document.querySelectorAll('#arrivalPresets [data-days]').forEach((b) => {
      const from = daysAgoISO(Number(b.dataset.days));
      b.classList.toggle('active', state.arrivalTo === todayISO() && state.arrivalFrom === from);
    });
    const pmin = $('priceMin'); const pmax = $('priceMax');
    if (pmin && document.activeElement !== pmin) pmin.value = state.priceMin != null ? state.priceMin : '';
    if (pmax && document.activeElement !== pmax) pmax.value = state.priceMax != null ? state.priceMax : '';
    document.querySelectorAll('#pricePresets [data-pmin]').forEach((b) => {
      const mn = b.dataset.pmin === '' ? null : Number(b.dataset.pmin);
      const mx = b.dataset.pmax === '' ? null : Number(b.dataset.pmax);
      b.classList.toggle('active', state.priceMin === mn && state.priceMax === mx);
    });
    // разделы для сотрудников/закупок показываем по роли
    document.querySelectorAll('.emp-only').forEach((el) => { el.hidden = !state.session; });
    document.querySelectorAll('.purchase-only').forEach((el) => { el.hidden = !state.canPurchase; });
    // подписи кнопок «Группы» и «Поставщики» — со счётчиком выбранного
    const gBtn = $('filterGroupsBtn');
    if (gBtn) {
      const gn = state.selGroups.filter((x) => x !== 'none' && x !== 'weighted').length + state.selCats.length;
      gBtn.textContent = gn ? `📁 Группы: выбрано ${gn}` : '📁 Выбрать группы…';
      gBtn.classList.toggle('picked', gn > 0);
    }
    const sBtn = $('filterSuppliersBtn');
    if (sBtn) {
      sBtn.textContent = state.selSuppliers.length ? `🚚 Поставщики: ${state.selSuppliers.length}` : '🚚 Выбрать поставщиков…';
      sBtn.classList.toggle('picked', state.selSuppliers.length > 0);
    }
    const n = countActiveFilters();
    const badge = $('filterBadge');
    if (badge) { badge.hidden = !n; badge.textContent = n || ''; }
    const fb = $('filterBtn'); if (fb) fb.classList.toggle('active', n > 0);
  }

  const QUICK_LABEL = { withprice: 'С ценой', barcode: 'Штрихкод', nophoto: 'Без фото', noprice: 'Без цены', nobarcode: 'Без ШК' };

  // Плашки активных фильтров на главном экране: видно, что включено, и каждый
  // можно снять по ✕ — не открывая окно фильтров. Универсально и удобно.
  function renderActiveFilters() {
    const box = $('activeFilters');
    if (!box) return;
    const items = [];
    if (state.query) items.push(['q', '', `«${state.query}»`]);
    for (const c of state.selCats) items.push(['cat', c, c]);
    for (const gid of state.selGroups) {
      const label = gid === 'none' ? 'Без группы' : gid === 'weighted' ? 'Весовые' : (groupById(gid)?.name || 'Группа');
      items.push(['group', gid, label]);
    }
    for (const sid of state.selSuppliers) items.push(['sup', sid, '🚚 ' + (supplierById(sid)?.name || 'Поставщик')]);
    if (state.selType) items.push(['type', '', state.selType === 'weighted' ? '⚖ Весовые' : 'Штучные']);
    if (state.arrivalFrom || state.arrivalTo) {
      const f = state.arrivalFrom ? fmtDate(state.arrivalFrom) : '…';
      const t = state.arrivalTo ? fmtDate(state.arrivalTo) : '…';
      items.push(['arrival', '', `📦 ${f}–${t}`]);
    }
    if (state.priceMin != null || state.priceMax != null) {
      const lbl = state.priceMin != null && state.priceMax != null ? `${state.priceMin}–${state.priceMax} ₽`
        : state.priceMin != null ? `от ${state.priceMin} ₽` : `до ${state.priceMax} ₽`;
      items.push(['price', '', lbl]);
    }
    for (const k of state.quick) items.push(['quick', k, QUICK_LABEL[k] || k]);

    if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    let html = items.map(([t, v, label]) =>
      `<button class="chip chip-active-filter" data-rm="${esc(t)}" data-val="${esc(v)}">${esc(label)}<span class="rm-x">✕</span></button>`).join('');
    html += '<button class="chip chip-reset" data-rm="all" data-val="">Сбросить всё</button>';
    box.innerHTML = html;
  }

  // снять один активный фильтр
  function removeFilter(type, val) {
    switch (type) {
      case 'q': state.query = ''; { const i = $('searchInput'); if (i) i.value = ''; } $('searchClear').hidden = true; break;
      case 'cat':
        state.selCats = state.selCats.filter((x) => x !== val);
        { const ids = new Set(state.groups.filter((g) => categoryOf(g.name) === val).map((g) => g.id)); state.selGroups = state.selGroups.filter((x) => !ids.has(x)); }
        break;
      case 'group': state.selGroups = state.selGroups.filter((x) => x !== val); break;
      case 'sup': state.selSuppliers = state.selSuppliers.filter((x) => x !== val); break;
      case 'type': state.selType = ''; break;
      case 'arrival': state.arrivalFrom = ''; state.arrivalTo = ''; { const af = $('arrivalFrom'); const at = $('arrivalTo'); if (af) af.value = ''; if (at) at.value = ''; } break;
      case 'price': state.priceMin = null; state.priceMax = null; { const a = $('priceMin'); const b = $('priceMax'); if (a) a.value = ''; if (b) b.value = ''; } break;
      case 'quick': state.quick = state.quick.filter((x) => x !== val); break;
      case 'all': clearAllFilters(); return;
    }
    state.renderLimit = PAGE_SIZE;
    renderAll();
  }

  function renderAll() {
    renderChips(); renderQuick(); renderActiveFilters(); syncControls(); saveFilters();
    renderPopularProducts(); renderRecentProducts();
    renderGrid();
  }

  // есть ли хоть один активный фильтр/поиск
  function anyFilterActive() {
    return !!(state.query || state.quick.length || state.selCats.length
      || state.selGroups.length || state.selSuppliers.length
      || state.priceMin != null || state.priceMax != null
      || state.selType || state.arrivalFrom || state.arrivalTo);
  }

  // полный сброс всех фильтров и поиска (сортировку и вид не трогаем — это привычка)
  function clearAllFilters() {
    state.selCats = []; state.selGroups = []; state.selSuppliers = [];
    state.quick = []; state.priceMin = null; state.priceMax = null;
    state.selType = ''; state.arrivalFrom = ''; state.arrivalTo = ''; state.favOnly = false;
    const af = $('arrivalFrom'); const at = $('arrivalTo'); if (af) af.value = ''; if (at) at.value = '';
    state.query = '';
    state.renderLimit = PAGE_SIZE;
    const inp = $('searchInput'); if (inp) inp.value = '';
    const sc = $('searchClear'); if (sc) sc.hidden = true;
    const pmin = $('priceMin'); if (pmin) pmin.value = '';
    const pmax = $('priceMax'); if (pmax) pmax.value = '';
    renderAll();
  }

  /* ── Память фильтров, недавних запросов и темы ──── */
  const FILTERS_KEY = 'wm_filters_v1';
  const RECENT_KEY = 'wm_recent_q_v1';
  const THEME_KEY = 'wm_theme';

  function saveFilters() {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        selCats: state.selCats, selGroups: state.selGroups, selSuppliers: state.selSuppliers,
        quick: state.quick, sort: state.sort, view: state.view,
        priceMin: state.priceMin, priceMax: state.priceMax,
        selType: state.selType, arrivalFrom: state.arrivalFrom, arrivalTo: state.arrivalTo,
      }));
    } catch (e) { /* нет места — не критично */ }
  }
  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem(FILTERS_KEY));
      if (!f) return;
      state.selCats = Array.isArray(f.selCats) ? f.selCats : [];
      state.selGroups = Array.isArray(f.selGroups) ? f.selGroups : [];
      state.selSuppliers = Array.isArray(f.selSuppliers) ? f.selSuppliers : [];
      state.quick = Array.isArray(f.quick) ? f.quick : [];
      if (['relevance', 'name', 'cheap', 'expensive', 'new', 'popular'].includes(f.sort)) state.sort = f.sort;
      if (f.view === 'compact' || f.view === 'normal') state.view = f.view;
      state.priceMin = (typeof f.priceMin === 'number') ? f.priceMin : null;
      state.priceMax = (typeof f.priceMax === 'number') ? f.priceMax : null;
      if (f.selType === 'weighted' || f.selType === 'piece') state.selType = f.selType;
      const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (isDate(f.arrivalFrom)) state.arrivalFrom = f.arrivalFrom;
      if (isDate(f.arrivalTo)) state.arrivalTo = f.arrivalTo;
    } catch (e) { /* игнорируем битые данные */ }
  }

  function recentQueries() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } }
  function addRecentQuery(q) {
    q = q.trim();
    if (q.length < 2) return;
    let list = recentQueries().filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    list = list.slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* нет места */ }
    trackSearch(q); // анонимный учёт запроса — для подсказок частых запросов
    renderRecent();
  }
  function renderRecent() {
    const dl = $('recentQ');
    if (!dl) return;
    // сначала личные недавние запросы, затем частые запросы других (без повторов)
    const personal = recentQueries();
    const seen = new Set(personal.map((x) => x.toLowerCase()));
    const popular = (state.popularTerms || []).filter((t) => !seen.has(String(t).toLowerCase()));
    dl.innerHTML = [...personal, ...popular].slice(0, 14)
      .map((q) => `<option value="${esc(q)}"></option>`).join('');
  }

  /* ── Избранное (♥) и «Недавно смотрели» — у покупателя на телефоне ──
   * Хранятся только на устройстве (localStorage), в базу не уходят. */
  const FAV_KEY = 'wm_favorites_v1';
  const RECENT_PROD_KEY = 'wm_recent_products_v1';

  function favorites() { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; } }
  const isFav = (id) => favorites().includes(id);
  function toggleFav(id) {
    const list = favorites();
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.unshift(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 500))); } catch (e) { /* нет места */ }
    return i < 0; // true = товар стал избранным
  }

  function recentProducts() { try { return JSON.parse(localStorage.getItem(RECENT_PROD_KEY)) || []; } catch (e) { return []; } }
  function pushRecentProduct(id) {
    const list = recentProducts().filter((x) => x !== id);
    list.unshift(id);
    try { localStorage.setItem(RECENT_PROD_KEY, JSON.stringify(list.slice(0, 24))); } catch (e) { /* нет места */ }
  }

  /* ── Популярность: анонимный учёт (без личности) ──
   * Считаем на сервере, сколько раз открывали товар и что искали. Из этого —
   * раздел «Популярное» и подсказки частых запросов. Личность не сохраняется. */

  // стабильный анонимный номер устройства — «якорь» памяти (избранное/просмотры
  // и так живут в localStorage; номер даёт единый идентификатор на будущее)
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem('wm_device_id'); } catch (e) { /* */ }
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2);
      try { localStorage.setItem('wm_device_id', id); } catch (e) { /* */ }
    }
    return id;
  }

  const popViews = (id) => state.popularity[id] || 0;

  // защита от накрутки: один просмотр/запрос за товар (запрос) в день с устройства
  const TRACK_KEY = 'wm_tracked_v1';
  function trackedToday() {
    try {
      const o = JSON.parse(localStorage.getItem(TRACK_KEY));
      if (o && o.d === todayISO()) return o;
    } catch (e) { /* */ }
    return { d: todayISO(), v: {}, s: {} };
  }
  function saveTracked(o) { try { localStorage.setItem(TRACK_KEY, JSON.stringify(o)); } catch (e) { /* */ } }

  function trackView(p) {
    if (!sb || !p) return;
    const o = trackedToday();
    if (o.v[p.id]) return;      // сегодня уже считали — не накручиваем
    o.v[p.id] = 1; saveTracked(o);
    state.popularity[p.id] = popViews(p.id) + 1; // оптимистично — «Популярное» живое сразу
    sb.rpc('catalog_track_view', { p_product_id: p.id }).then(() => {}, () => {});
  }
  function trackSearch(q) {
    if (!sb) return;
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return;
    const o = trackedToday();
    if (o.s[q]) return;
    o.s[q] = 1; saveTracked(o);
    sb.rpc('catalog_track_search', { p_term: q }).then(() => {}, () => {});
  }

  // загрузка счётчиков популярности (не критично: если ОБНОВЛЕНИЕ-16 не выполнено —
  // просто нет «Популярного», приложение работает как обычно)
  async function loadPopularity() {
    if (!sb) return;
    try {
      const [pop, terms] = await Promise.all([
        sb.from('catalog_popularity').select('product_id,views').order('views', { ascending: false }).range(0, 199),
        sb.from('catalog_search_terms').select('term,hits').order('hits', { ascending: false }).range(0, 19),
      ]);
      if (!pop.error && Array.isArray(pop.data)) {
        const m = {};
        for (const r of pop.data) m[r.product_id] = Number(r.views) || 0;
        // не затираем оптимистично начисленные локально просмотры за эту сессию
        state.popularity = Object.assign(m, state.popularity);
      }
      if (!terms.error && Array.isArray(terms.data)) state.popularTerms = terms.data.map((r) => r.term);
      renderRecent();
    } catch (e) { /* база старой версии — «Популярное» просто не показываем */ }
  }

  // «Популярное» — горизонтальная лента самых просматриваемых товаров (главная)
  function renderPopularProducts() {
    const box = $('popularStrip');
    if (!box) return;
    const show = !state.query && !state.favOnly && !anyFilterActive();
    const top = state.products.filter((p) => popViews(p.id) > 0)
      .sort((a, b) => popViews(b.id) - popViews(a.id)).slice(0, 12);
    if (!show || top.length < 3) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="similar-title">🔥 Популярное</div><div class="similar-row">'
      + top.map((x) => {
        const ph = (x.photos || []).find((u) => u && String(u).trim());
        const price = (x.retail_price != null && x.retail_price !== '') ? `<span class="similar-price">${esc(fmtRetail(x))}</span>` : '';
        return `<button class="similar-card" data-similar="${esc(x.id)}">
          <span class="similar-photo${ph ? '' : ' no-photo'}">${ph ? `<img src="${esc(ph)}" loading="lazy" alt="">` : '📦'}</span>
          <span class="similar-name">${esc(x.name)}</span>${price}</button>`;
      }).join('') + '</div>';
  }

  // «Недавно смотрели» — горизонтальная лента на главной, когда нет поиска и фильтров
  function renderRecentProducts() {
    const box = $('recentStrip');
    if (!box) return;
    const show = !state.query && !state.favOnly && !anyFilterActive();
    if (!show) { box.hidden = true; box.innerHTML = ''; return; }
    const byId = new Map(state.products.map((p) => [p.id, p]));
    const list = recentProducts().map((id) => byId.get(id)).filter(Boolean).slice(0, 12);
    if (list.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="similar-title">Недавно смотрели</div><div class="similar-row">'
      + list.map((x) => {
        const ph = (x.photos || []).find((u) => u && String(u).trim());
        const price = (x.retail_price != null && x.retail_price !== '') ? `<span class="similar-price">${esc(fmtRetail(x))}</span>` : '';
        return `<button class="similar-card" data-similar="${esc(x.id)}">
          <span class="similar-photo${ph ? '' : ' no-photo'}">${ph ? `<img src="${esc(ph)}" loading="lazy" alt="">` : '📦'}</span>
          <span class="similar-name">${esc(x.name)}</span>${price}</button>`;
      }).join('') + '</div>';
  }

  function applyTheme(t) {
    // t: 'dark' | 'light' | null (авто — по системе)
    const root = document.documentElement;
    if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    const icon = $('themeIcon');
    if (icon) icon.textContent = t === 'dark' ? '☀️' : t === 'light' ? '🌙' : '🌗';
  }
  function initTheme() { try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) { /* */ } }
  function toggleTheme() {
    let cur; try { cur = localStorage.getItem(THEME_KEY); } catch (e) { cur = null; }
    // цикл: авто → тёмная → светлая → авто
    const next = cur == null ? 'dark' : cur === 'dark' ? 'light' : null;
    try { next ? localStorage.setItem(THEME_KEY, next) : localStorage.removeItem(THEME_KEY); } catch (e) { /* */ }
    applyTheme(next);
  }

  // Фото на весь экран (зум по тапу). Кнопка «назад» телефона его закрывает.
  function openLightbox(url) {
    if (!url) return;
    $('lightboxImg').src = url;
    $('lightbox').hidden = false;
    try { history.pushState({ wmLightbox: true }, ''); } catch (e) { /* некритично */ }
  }
  function closeLightbox() {
    const lb = $('lightbox');
    if (!lb || lb.hidden) return;
    lb.hidden = true; $('lightboxImg').src = '';
    // «съедаем» нашу history-запись, чтобы счётчик «назад» не сбился
    if (window.history.state && window.history.state.wmLightbox) { expectPop++; try { history.back(); } catch (e) { expectPop--; } }
  }

  /* ── Карточка товара ──────────────────────────── */

  function updateFavButton(p) {
    const b = $('btnFav');
    if (!b) return;
    const on = isFav(p.id);
    b.classList.toggle('is-fav', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Убрать из избранного' : 'В избранное';
  }

  function openProduct(p) {
    currentProduct = p;
    pushRecentProduct(p.id);
    trackView(p); // анонимный учёт: товар открыли (для «Популярного»)
    renderPopularProducts(); renderRecentProducts(); // обновляем ленты под шторкой
    updateFavButton(p);
    $('sheetName').textContent = p.name;

    const photos = (p.photos || []).filter((u) => u && String(u).trim());
    $('sheetPhotos').innerHTML = photos.length
      ? photos.map((u) => `<img src="${esc(u)}" alt="">`).join('')
      : '<div class="photo-placeholder">📦</div>';
    $('sheetDots').innerHTML = photos.length > 1
      ? photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')
      : '';
    $('sheetPhotos').scrollLeft = 0;

    // без входа (обычный покупатель) — показываем только «магазинные» метки:
    // категорию и «весовой/продаётся». Внутренние (штрихкода нет и т.п.) — сотрудникам.
    const badges = [];
    const g = groupById(p.group_id);
    if (g) badges.push(`<span class="tag">${esc(g.name)}</span>`);
    if (p.is_weighted) badges.push('<span class="tag">⚖ Весовой товар</span>');
    if (p.unit) badges.push(`<span class="tag">📏 Продаётся: ${esc(p.unit)}</span>`);
    const barcodes = p.barcodes || [];
    if (state.session && !barcodes.length) badges.push('<span class="tag tag-nobarcode">⚠ Штрихкода нет — пробивать по коду</span>');
    $('sheetBadges').innerHTML = badges.join('');

    // описание товара (под названием, видно всем — как в витрине магазина)
    const desc = $('sheetDescription');
    if (p.description && String(p.description).trim()) { desc.textContent = p.description; desc.hidden = false; }
    else { desc.textContent = ''; desc.hidden = true; }

    // поставщики и цены — единым списком ниже (renderProductPrices); отдельный блок не нужен
    $('sheetSupplier').innerHTML = '';

    const rows = [];
    // розничная цена (цена на полке) — видна всем, крупно вверху
    if (p.retail_price != null && p.retail_price !== '') {
      rows.push(`<div class="field-row field-main"><span class="field-key">Цена</span><span class="field-val">${esc(fmtRetail(p))}</span></div>`);
    }
    // коды кассы/артикул/штрихкод/отдел/примечание — это внутренние данные магазина,
    // покупателям без входа их не показываем
    if (state.session) {
      if (p.code) rows.push(fieldRow('Код кассы', p.code, true));
      if (p.article) rows.push(fieldRow('Артикул', p.article, false, true));
      barcodes.forEach((b, i) => rows.push(fieldRow(barcodes.length > 1 ? `Штрихкод ${i + 1}` : 'Штрихкод', b, false, true)));
      if (p.department) rows.push(fieldRow('Отдел', p.department));
      if (p.arrival_at) rows.push(fieldRow('Поступление', fmtDate(p.arrival_at)));
      if (p.note) rows.push(`<div class="field-row"><span class="field-key">Примечание</span><span class="field-val" style="font-weight:400;font-size:14px">${esc(p.note)}</span></div>`);
    }
    if (!rows.length && state.session) rows.push('<div class="field-row"><span class="field-key">Коды не указаны</span></div>');
    $('sheetFields').innerHTML = rows.join('');

    $('sheetAdminActions').hidden = !state.isAdmin;
    $('btnFindPhoto').hidden = !(state.isAdmin && !hasPhoto(p)); // ищем по штрихкоду ИЛИ названию
    $('btnAddPhotoLabel').hidden = !state.session; // сотрудник добавляет фото сразу
    $('btnSuggestPhotoLabel').hidden = !!state.session; // покупатель может предложить фото (на проверку)
    $('sheetMarkup').innerHTML = '';
    $('sheetRetailHist').innerHTML = '';
    renderProductSales(p);
    renderProductPrices(p);
    renderRetailHistory(p);
    renderCompetitors(p);
    renderSimilar(p);
    openSheet('productSheet');
  }

  /* ── Поделиться товаром + похожие + ссылка на товар ── */
  const productLink = (p) => `${location.origin}${location.pathname}#p=${encodeURIComponent(p.id)}`;

  async function shareProduct(p) {
    const url = productLink(p);
    const priceTxt = (p.retail_price != null && p.retail_price !== '') ? `\n${fmtRetail(p)}` : '';
    try {
      if (navigator.share) { await navigator.share({ title: p.name, text: `${p.name}${priceTxt}`, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; /* пользователь закрыл — не ошибка */ }
    try { await navigator.clipboard.writeText(url); toast('Ссылка на товар скопирована'); }
    catch (e) { toast('Ссылка: ' + url); }
  }

  // Похожие товары — из того же раздела (для покупателя: листать дольше)
  function renderSimilar(p) {
    const box = $('sheetSimilar');
    if (!box) return;
    const cat = productCategory(p);
    let list = state.products.filter((x) => x.id !== p.id && (
      (p.group_id && x.group_id === p.group_id) || (cat && productCategory(x) === cat)));
    // сначала с фото, максимум 12
    list.sort((a, b) => (hasPhoto(b) ? 1 : 0) - (hasPhoto(a) ? 1 : 0));
    list = list.slice(0, 12);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="similar-title">Похожие товары</div><div class="similar-row">'
      + list.map((x) => {
        const ph = (x.photos || []).find((u) => u && String(u).trim());
        const price = (x.retail_price != null && x.retail_price !== '') ? `<span class="similar-price">${esc(fmtRetail(x))}</span>` : '';
        return `<button class="similar-card" data-similar="${esc(x.id)}">
          <span class="similar-photo${ph ? '' : ' no-photo'}">${ph ? `<img src="${esc(ph)}" loading="lazy" alt="">` : '📦'}</span>
          <span class="similar-name">${esc(x.name)}</span>${price}</button>`;
      }).join('') + '</div>';
  }

  // открыть товар по ссылке вида …/#p=<id> (после загрузки каталога)
  function openFromHash() {
    const m = String(location.hash || '').match(/[#&]p=([^&]+)/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    // уже открыт нужный товар — ничего не делаем (защита от повторов)
    if (currentProduct && currentProduct.id === id && !$('productSheet').hidden) return;
    const p = state.products.find((x) => x.id === id);
    if (p) openProduct(p);
  }
  // если ссылку открыли, уже находясь в каталоге (меняется только #hash, без
  // перезагрузки страницы) — тоже показываем товар
  window.addEventListener('hashchange', openFromHash);

  /* ── Продажи товара в карточке (для заказа) ────────
   * После входа: сколько штук продано за 7 и 30 дней и в среднем в день —
   * помогает решить, сколько заказывать. Деньги не показываем — только штуки. */

  const SALES_CACHE_KEY = 'wm_sales_cache_v1';

  function renderSalesBox(p, s, stale) {
    const u = p.unit || 'шт';
    const round = (n) => (n % 1 ? Math.round(n * 10) / 10 : n);
    const days = daysBetween(s.period_from, s.period_to);
    const perDay = round(Number(s.qty) / days);
    $('sheetSales').innerHTML = `<div class="sales-box">
      <div class="sales-title">Продажи${stale ? ' <span class="sales-stale">· без связи</span>' : ''}</div>
      <div class="sales-nums">
        <div class="sales-cell"><span class="sales-n">${round(Number(s.qty))}</span><span class="sales-l">${esc(u)} за период</span></div>
        <div class="sales-cell"><span class="sales-n">${perDay}</span><span class="sales-l">${esc(u)}/день</span></div>
        <div class="sales-cell"><span class="sales-n" style="font-size:15px">${fmtDate(s.period_from)}<br>${fmtDate(s.period_to)}</span><span class="sales-l">период</span></div>
      </div>
    </div>`;
  }

  async function renderProductSales(p) {
    const box = $('sheetSales');
    box.innerHTML = '';
    if (!sb || !state.session) return; // продажи — только после входа
    let s;
    try {
      const { data, error } = await sb.from('catalog_sales')
        .select('period_from,period_to,qty').eq('product_id', p.id)
        .order('period_to', { ascending: false }).limit(1);
      if (error) throw error;
      s = data[0];
    } catch (e) {
      const cached = readCache(SALES_CACHE_KEY)[p.id];
      if (cached && currentProduct === p) renderSalesBox(p, cached, true);
      return;
    }
    if (currentProduct !== p) return;
    if (!s) { box.innerHTML = ''; return; } // продаж нет — не показываем
    writeCache(SALES_CACHE_KEY, p.id, s, 400);
    renderSalesBox(p, s, false);
  }

  // общий кэш карточек (цены/продажи) на телефоне
  function readCache(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function writeCache(key, id, val, max) {
    try {
      const all = readCache(key);
      all[id] = { ...val, ts: Date.now() };
      const keys = Object.keys(all);
      if (keys.length > max) keys.sort((a, b) => all[a].ts - all[b].ts).slice(0, keys.length - max).forEach((k) => delete all[k]);
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) { /* нет места */ }
  }

  /* ── Поставщики и цены в карточке ──────────────────
   * Единый список: все поставщики товара, у каждого — цена и дата последнего
   * поступления по этой цене. Строка кликабельна → открывается карточка
   * поставщика с контактами и кнопками «Позвонить» / «WhatsApp». Цены и
   * контакты — только после входа (доступ закрыт правами базы). */

  let cardSuppliers = {}; // supplier_id → {sup, last, hist, prev} для открытия карточки поставщика

  async function renderProductPrices(p) {
    const box = $('sheetPrices');
    if (!sb) { box.innerHTML = ''; return; }
    const baseSupIds = [...new Set(p.supplier_ids || [])];
    // покупатель без входа не видит поставщиков вовсе (никаких намёков на «вход
    // для сотрудников»); кассир видит только розничную цену
    if (!state.session || !state.canPurchase) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="muted">Загружаем цены…</p>';
    let rows;
    try {
      const { data, error } = await sb.from('catalog_prices').select('*')
        .eq('product_id', p.id).order('price_date', { ascending: false });
      if (error) throw error;
      rows = data;
    } catch (e) {
      if (currentProduct !== p) return;
      const cached = readPriceCache()[p.id];
      renderCardSuppliers(p, (cached && cached.rows) || [], baseSupIds,
        { stale: cached ? `⚠ Нет связи — данные от ${fmtDate(new Date(cached.ts).toISOString())}` : '⚠ Нет связи с базой' });
      return;
    }
    if (currentProduct !== p) return; // пока грузили, открыли другой товар
    cachePrices(p.id, rows);
    renderCardSuppliers(p, rows, baseSupIds, {});
  }

  // строит единый список поставщиков товара (с ценами, если есть) и запоминает
  // данные для карточки поставщика
  function renderCardSuppliers(p, priceRows, baseSupIds, opt) {
    const box = $('sheetPrices');
    // группируем историю цен по поставщику (строки уже от новых к старым)
    const bySup = new Map();
    for (const r of priceRows) {
      if (!bySup.has(r.supplier_id)) bySup.set(r.supplier_id, []);
      bySup.get(r.supplier_id).push(r);
    }
    // объединяем поставщиков товара и тех, у кого есть цена
    const ids = [...new Set([...baseSupIds, ...bySup.keys()])];
    cardSuppliers = {};
    const entries = ids.map((id) => {
      const sup = supplierById(id);
      if (!sup) return null;
      const hist = bySup.get(id) || [];
      const e = { sup, hist, last: hist[0] || null, prev: hist.find((h) => hist[0] && Number(h.price) !== Number(hist[0].price)) || null };
      cardSuppliers[id] = e;
      return e;
    }).filter(Boolean);

    if (!entries.length) {
      // ничего не показать молча — плохо: пользователь думает, что «сломалось».
      // Объясняем словами, что делать.
      if (opt.locked) {
        box.innerHTML = '<div class="price-block"><button class="btn btn-secondary btn-block" id="pricesLoginBtn">🔒 Цены и контакты — вход для сотрудников</button></div>';
      } else if (opt.stale) {
        box.innerHTML = `<div class="price-block"><p class="muted price-hint">${esc(opt.stale)}</p></div>`;
      } else {
        box.innerHTML = '<div class="price-block"><div class="price-title">Поставщики и цены</div>'
          + '<p class="muted price-hint">У этого товара пока нет цен. Загрузи прайс поставщиков через «Импорт из 1С» — цены появятся здесь.</p></div>';
      }
      return;
    }

    // свежесть цены: старше STALE_PRICE_DAYS — поступления давно не было
    for (const e of entries) e.fresh = isFreshPrice(e.last);
    // сортировка: свежие с ценой (дешёвые выше), потом устаревшие с ценой, потом без цены
    entries.sort((a, b) => {
      const rank = (e) => (e.last ? (e.fresh ? 0 : 1) : 2);
      const ra = rank(a); const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a.last && b.last) return Number(a.last.price) - Number(b.last.price);
      return a.sup.name.localeCompare(b.sup.name, 'ru');
    });
    // «выгоднее» считаем ТОЛЬКО среди свежих цен — старую цену без нового
    // поступления нельзя считать актуальной
    const freshPriced = entries.filter((e) => e.fresh);
    const best = freshPriced.length ? Math.min(...freshPriced.map((e) => Number(e.last.price))) : null;

    // Наценка (только админ/аналитик): розничная − лучшая свежая закупочная и %
    renderMarkup(p, best);

    const chevron = '<span class="sup-chevron">›</span>';
    const rowsHtml = entries.map((e) => {
      const c = state.contacts[e.sup.id];
      const hasContact = state.session && c && c.phone;
      const isBest = e.fresh && freshPriced.length > 1 && Number(e.last.price) === best;
      let right = '';
      if (e.last) {
        let trend = '';
        if (e.prev) {
          const diff = ((Number(e.last.price) - Number(e.prev.price)) / Number(e.prev.price)) * 100;
          const pct = Math.abs(diff) >= 10 ? Math.round(Math.abs(diff)) : Math.round(Math.abs(diff) * 10) / 10;
          trend = diff > 0 ? `<span class="price-up">↑ ${pct}%</span>` : `<span class="price-down">↓ ${pct}%</span>`;
        }
        // устаревшая цена: помечаем и НЕ даём как выгодную
        const dateLabel = e.fresh
          ? `<span class="price-date">поступление ${fmtDate(e.last.price_date)}</span>`
          : `<span class="price-date price-old">⚠ цена от ${fmtDate(e.last.price_date)} · поступления не было</span>`;
        right = `<span class="price-val${e.fresh ? '' : ' price-val-old'}">${fmtPrice(e.last.price)}</span>
          <span class="price-meta">${isBest ? '<span class="price-badge">✓ выгоднее</span>' : ''}${trend}${dateLabel}</span>`;
      } else {
        right = `<span class="price-noprice">${state.session ? 'цена не указана' : ''}</span>`;
      }
      return `<button class="price-row${isBest ? ' price-best' : ''}${e.last && !e.fresh ? ' price-row-old' : ''}" data-supplier-view="${esc(e.sup.id)}">
        <span class="price-sup">🚚 ${esc(e.sup.name)}${hasContact ? ' <span class="sup-hasphone">📞</span>' : ''}</span>
        ${right}
        ${chevron}
      </button>`;
    }).join('');

    let footer = '';
    if (opt.locked) footer = '<button class="btn btn-secondary btn-block" id="pricesLoginBtn">🔒 Цены и контакты — вход для сотрудников</button>';
    else if (opt.stale) footer = `<p class="muted price-hint">${esc(opt.stale)}</p>`;
    else if (!freshPriced.length && entries.some((e) => e.last)) footer = `<p class="muted price-hint">⚠ Все цены старше ${STALE_PRICE_DAYS} дней — поступлений давно не было, цены могли измениться. «Выгоднее» не показываем.</p>`;
    else footer = '<p class="muted price-hint">Нажми на поставщика — контакты, звонок и WhatsApp</p>';

    box.innerHTML = `<div class="price-block"><div class="price-title">Поставщики и цены</div>${rowsHtml}${footer}</div>`;
  }

  // Наценка в карточке: розничная цена − лучшая свежая закупочная, в ₽ и %
  function renderMarkup(p, bestCost) {
    const box = $('sheetMarkup');
    if (!box) return;
    if (!state.canPurchase || bestCost == null || !(p.retail_price != null && p.retail_price !== '')) { box.innerHTML = ''; return; }
    const retail = Number(p.retail_price);
    const cost = Number(bestCost);
    if (!Number.isFinite(retail) || !Number.isFinite(cost) || cost <= 0) { box.innerHTML = ''; return; }
    const abs = retail - cost;
    const pct = Math.round((abs / cost) * 100);
    const loss = abs < 0;
    const cls = loss ? 'markup-loss' : 'markup-ok';
    const sign = abs > 0 ? '+' : '';
    box.innerHTML = `<div class="markup-box ${cls}">
      <span class="markup-label">${loss ? '⚠ Наценка' : 'Наценка'}</span>
      <span class="markup-val">${sign}${esc(fmtPrice(abs))} <span class="markup-pct">(${sign}${pct}%)</span></span>
      <span class="markup-sub">розница ${esc(fmtPrice(retail))} − закупка ${esc(fmtPrice(cost))}</span>
    </div>`;
  }

  /* ── История розничной цены в карточке (item 16) ──── */
  async function renderRetailHistory(p) {
    const box = $('sheetRetailHist');
    if (!box) return;
    box.innerHTML = '';
    if (!sb || !state.session) return; // история — после входа
    let rows;
    try {
      const { data, error } = await sb.from('catalog_retail_history')
        .select('retail_price,changed_at').eq('product_id', p.id)
        .order('changed_at', { ascending: false }).limit(12);
      if (error) throw error;
      rows = data;
    } catch (e) { return; } // таблицы может не быть на старой базе — просто не показываем
    if (currentProduct !== p || !rows || rows.length < 2) return; // одна запись — не история
    const items = rows.map((r) =>
      `<div class="price-hist-row"><span>${fmtDate(r.changed_at)}</span><span>${fmtPrice(r.retail_price)}</span></div>`).join('');
    box.innerHTML = `<details class="retail-hist"><summary>История розничной цены (${rows.length})</summary>${items}</details>`;
  }

  /* ── Карточка поставщика (контакты, звонок, WhatsApp) ── */

  function openSupplierView(id) {
    const sup = supplierById(id);
    if (!sup) return;
    const e = cardSuppliers[id];
    const c = state.contacts[id];
    $('supViewName').textContent = '🚚 ' + sup.name;

    const parts = [];
    if (!state.session) {
      parts.push('<button class="btn btn-secondary btn-block" id="supViewLogin">🔒 Цены и контакты — вход для сотрудников</button>');
    } else if (c && c.phone) {
      if (c.contact_name) parts.push(`<div class="supview-person">${esc(c.contact_name)}</div>`);
      parts.push(`<div class="supview-actions">
        <a class="btn btn-primary supview-call" href="${esc(telHref(c.phone))}">📞 Позвонить</a>
        <a class="btn supview-wa" href="${esc(waHref(c.phone))}" target="_blank" rel="noopener">💬 WhatsApp</a></div>`);
      parts.push(`<div class="supview-phone">${esc(c.phone)}</div>`);
      if (c.note) parts.push(`<div class="supview-note">${esc(c.note)}</div>`);
    } else if (state.session) {
      parts.push('<div class="muted">Контакты поставщика ещё не заполнены.</div>');
    }

    // цена этого товара у поставщика + история
    if (state.session && e && e.last) {
      parts.push(isFreshPrice(e.last)
        ? `<div class="supview-price">Цена: <b>${fmtPrice(e.last.price)}</b> · поступление ${fmtDate(e.last.price_date)}</div>`
        : `<div class="supview-price supview-price-old">Цена: <b>${fmtPrice(e.last.price)}</b><br><span class="price-old">⚠ от ${fmtDate(e.last.price_date)} · нового поступления не было, цена могла измениться</span></div>`);
      if (e.hist.length > 1) {
        parts.push('<div class="supview-hist-title">История цены</div><div class="price-history">'
          + e.hist.slice(0, 12).map((h) => `<div class="price-hist-row"><span>${fmtDate(h.price_date)}</span><span>${fmtPrice(h.price)}</span></div>`).join('')
          + '</div>');
      }
    }

    parts.push(`<button class="btn btn-secondary btn-block" data-supplier-all="${esc(id)}">Показать все товары поставщика →</button>`);
    if (state.isAdmin) parts.push(`<button class="btn btn-ghost btn-block" id="supViewEdit" data-edit="${esc(id)}">✏️ Изменить контакты</button>`);

    $('supViewBody').innerHTML = parts.join('');
    openSheet('supplierViewSheet');
  }

  function fieldRow(key, val, main = false, copy = false) {
    const cls = main ? ' field-main' : '';
    const copyBtn = (copy || main)
      ? `<button class="copy-btn" data-copy="${esc(val)}">⧉</button>`
      : '';
    return `<div class="field-row${cls}"><span class="field-key">${esc(key)}</span><span class="field-val">${esc(val)}</span>${copyBtn}</div>`;
  }

  /* ── Данные ───────────────────────────────────── */

  async function loadCache() {
    try {
      const c = await idbGet(CACHE_KEY);
      if (c && Array.isArray(c.products)) {
        state.groups = c.groups || [];
        state.suppliers = c.suppliers || [];
        state.products = c.products;
        state.syncMax = c.syncMax || '';
        buildIndex();
        state.lastFetch = c.ts || 0;
        return true;
      }
    } catch (e) { /* нет кэша или IndexedDB недоступен — работаем от сети */ }
    return false;
  }

  function saveCache() {
    // служебные поля индекса (начинаются с "_") в кэш не пишем — экономим место
    const clean = state.products.map((p) => {
      const o = {};
      for (const k in p) if (k[0] !== '_') o[k] = p[k];
      return o;
    });
    idbSet(CACHE_KEY, {
      groups: state.groups, suppliers: state.suppliers,
      products: clean, ts: Date.now(), syncMax: state.syncMax,
    }).catch(() => { /* не сохранилось — не страшно, кэш вспомогательный */ });
  }

  const PAGE = 1000; // база отдаёт максимум 1000 строк за раз
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  const trackMax = (rows) => { for (const r of rows) if (r.updated_at && r.updated_at > state.syncMax) state.syncMax = r.updated_at; };

  // маленькие таблицы (группы, поставщики) — всегда целиком, это быстро
  async function fetchSmall() {
    const [g, sup] = await Promise.all([
      sb.from('catalog_groups').select('*').order('sort_order').order('name'),
      sb.from('catalog_suppliers').select('*').order('name').order('id').range(0, 4999),
    ]);
    if (g.error) throw g.error;
    if (sup.error) throw sup.error;
    state.groups = g.data;
    state.suppliers = sup.data;
    loadPopularity(); // счётчики популярности — в фоне, загрузку каталога не задерживают
  }

  // Полная загрузка товаров страницами по id (быстро — id проиндексирован).
  // Первую страницу показываем сразу, остальное дозагружаем в фоне — экран не пустует.
  async function fullLoadProducts() {
    const all = [];
    state.syncMax = '';
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('catalog_products').select('*')
        .order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...data);
      trackMax(data);
      if (from === 0 && data.length) {
        // мгновенно показываем первую тысячу, пока грузится остальное
        state.products = all.slice().sort(byName);
        buildIndex();
        $('loader').hidden = true;
        renderAll();
      }
      if (data.length < PAGE) break;
    }
    state.products = all.sort(byName);
    buildIndex();
  }

  // Докачка: берём только товары, изменившиеся с прошлого раза, и вливаем в кэш.
  // Обычно это 0–несколько строк → мгновенно. Удаления ловим сверкой количества.
  async function deltaSyncProducts() {
    const { data, error } = await sb.from('catalog_products').select('*')
      .gt('updated_at', state.syncMax).order('updated_at').range(0, 4999);
    if (error) throw error;
    if (data.length >= 5000) { await fullLoadProducts(); return; } // много изменений (импорт) → проще перезабрать
    if (data.length) {
      const map = new Map(state.products.map((p) => [p.id, p]));
      for (const r of data) map.set(r.id, r);
      trackMax(data);
      state.products = [...map.values()].sort(byName);
      buildIndex();
    }
    // сверка количества — поймать удалённые товары
    const { count, error: cErr } = await sb.from('catalog_products')
      .select('id', { count: 'exact', head: true });
    if (!cErr && count != null && count !== state.products.length) {
      await fullLoadProducts();
    }
  }

  /* ── Публикация каталога на GitHub (бесплатно, без сервера) ──────────────
     Владелец один раз вставляет «ключ» (GitHub token) — он хранится ТОЛЬКО на
     устройстве (localStorage), в репозиторий/код не попадает. Через него
     приложение сохраняет файлы каталога прямо на GitHub одним коммитом (атомарно,
     чтобы деплой срабатывал один раз). Витрина — публично; секретное (закупка,
     «Ходовые») позже уедет в зашифрованный файл. */
  const GH_TOKEN_KEY = 'wm_gh_token';
  function ghToken() { try { return localStorage.getItem(GH_TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function ghSetToken(t) { try { if (t) localStorage.setItem(GH_TOKEN_KEY, t); else localStorage.removeItem(GH_TOKEN_KEY); } catch (e) { /* приватный режим */ } }
  function ghConfigured() { return !!(ghToken() && CFG.GITHUB_OWNER && CFG.GITHUB_REPO); }
  const ghRepo = () => `/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}`;
  const ghBranch = () => CFG.GITHUB_BRANCH || 'main';

  async function ghApi(path, opts = {}) {
    return fetch('https://api.github.com' + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + ghToken(),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
  }
  async function ghJson(path, opts) {
    const r = await ghApi(path, opts);
    if (!r.ok) throw new Error('GitHub ' + ((opts && opts.method) || 'GET') + ' ' + path + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  }

  // Один коммит с несколькими файлами (текстовыми). files: [{path, content}],
  // path — от корня репозитория. При параллельной правке (ветка ушла вперёд)
  // один раз перечитываем вершину ветки и повторяем.
  async function ghCommit(files, message, _retry = true) {
    const b = ghBranch();
    const ref = await ghJson(`${ghRepo()}/git/ref/heads/${b}`);
    const baseCommit = ref.object.sha;
    const baseInfo = await ghJson(`${ghRepo()}/git/commits/${baseCommit}`);
    const tree = await ghJson(`${ghRepo()}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseInfo.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }),
    });
    const commit = await ghJson(`${ghRepo()}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: message || 'обновление каталога', tree: tree.sha, parents: [baseCommit] }),
    });
    const upd = await ghApi(`${ghRepo()}/git/refs/heads/${b}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    if (!upd.ok) {
      if ((upd.status === 409 || upd.status === 422) && _retry) return ghCommit(files, message, false);
      throw new Error('GitHub PATCH ref → ' + upd.status + ' ' + (await upd.text()).slice(0, 200));
    }
    return commit.sha;
  }

  // Витринные поля — что можно показывать покупателю (тот же белый список, что и
  // в скрипте выгрузки). Секретное сюда не попадает.
  const PUBLIC_FIELDS = ['id', 'name', 'group_id', 'retail_price', 'is_weighted', 'unit', 'description', 'photos'];
  function buildPublicProducts() {
    return state.products
      .map((p) => { const o = {}; for (const k of PUBLIC_FIELDS) if (p[k] != null) o[k] = p[k]; return o; })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  }
  function buildPublicGroups() {
    return state.groups.map((g) => ({ id: g.id, name: g.name, sort_order: g.sort_order }));
  }

  // Опубликовать витрину (товары + категории) одним коммитом на GitHub.
  // По умолчанию публикуем ТОЛЬКО если витрина изменилась (сравниваем подпись
  // содержимого), чтобы не плодить пустые коммиты и лишние деплои. force=true —
  // опубликовать в любом случае (кнопка «Опубликовать сейчас», первый перенос).
  const GH_SIG_KEY = 'wm_gh_lastsig';
  function strHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  async function publishShowcase({ force = false } = {}) {
    const pJson = JSON.stringify(buildPublicProducts());
    const gJson = JSON.stringify(buildPublicGroups());
    const sig = strHash(pJson) + '.' + strHash(gJson);
    if (!force) { try { if (localStorage.getItem(GH_SIG_KEY) === sig) return null; } catch (e) { /* приватный режим */ } }
    const files = [
      { path: `${CFG.DATA_PATH}/products.json`, content: pJson },
      { path: `${CFG.DATA_PATH}/groups.json`, content: gJson },
    ];
    const sha = await ghCommit(files, 'Каталог: обновлена витрина');
    try { localStorage.setItem(GH_SIG_KEY, sig); } catch (e) { /* приватный режим */ }
    return sha;
  }

  // Авто-публикация после правок каталога. Гейт: только вошедший админ с ключом.
  // «Схлопывание»: частые правки (импорт) дают один коммит, а не десятки.
  let _pubBusy = false, _pubAgain = false, _pubTimer = null;
  function autoPublish() {
    if (!state.isAdmin || !ghConfigured()) return;
    clearTimeout(_pubTimer);
    _pubTimer = setTimeout(doAutoPublish, 1200);
  }
  async function doAutoPublish() {
    if (_pubBusy) { _pubAgain = true; return; }
    _pubBusy = true;
    try {
      const sha = await publishShowcase();
      if (sha) toast('☁️ Витрина обновлена на GitHub');
    } catch (e) {
      toast('⚠ Витрину не удалось опубликовать — проверь ключ в «Публикация на GitHub»');
    } finally {
      _pubBusy = false;
      if (_pubAgain) { _pubAgain = false; autoPublish(); }
    }
  }

  // Тестовый доступ к публикации — только на localhost (в проде не открываем).
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.WM_PUBLISH = { publishShowcase, ghCommit, buildPublicProducts, buildPublicGroups, ghConfigured, ghSetToken, autoPublish };
  }

  // Витрина из статического файла (data/products.json на GitHub Pages) — для
  // покупателя БЕЗ входа. Бесплатно, без сервера, работает офлайн. В файл попадает
  // только витрина (товары, розничная цена, фото, описание, категория); секретное
  // (закупка, поставщики, поступления, штрихкоды) — нет. Если файла нет или он не
  // читается, тихо возвращаем false — приложение грузится с сервера, как раньше.
  async function refreshStatic() {
    try {
      const base = CFG.STATIC_URL.endsWith('/') ? CFG.STATIC_URL : CFG.STATIC_URL + '/';
      const [pr, gr] = await Promise.all([
        fetch(base + 'products.json', { cache: 'no-cache' }),
        fetch(base + 'groups.json', { cache: 'no-cache' }).catch(() => null),
      ]);
      if (!pr || !pr.ok) return false;
      const products = await pr.json();
      if (!Array.isArray(products)) return false;
      state.groups = (gr && gr.ok) ? await gr.json() : [];
      state.suppliers = []; // покупателю поставщики не нужны (и в файле их нет)
      state.products = products.sort(byName);
      buildIndex();
      state.syncMax = '';
      state.lastFetch = Date.now();
      saveCache();
      $('offlineBanner').hidden = true;
      $('loader').hidden = true;
      renderAll();
      return true;
    } catch (e) {
      return false; // любой сбой — откат на загрузку с сервера
    }
  }

  async function refresh({ silent = false } = {}) {
    // Покупатель без входа и включённый STATIC_URL → читаем витрину из файла.
    // Не удалось (файла ещё нет / ошибка) — падаем на обычную загрузку с сервера.
    // Сотрудник после входа всегда грузится с сервера (полные данные).
    if (CFG.STATIC_URL && !state.session) {
      if (await refreshStatic()) return;
    }
    try {
      await fetchSmall();
      if (!state.products.length || !state.syncMax) await fullLoadProducts();
      else await deltaSyncProducts();
      state.lastFetch = Date.now();
      saveCache();
      $('offlineBanner').hidden = true;
      renderAll();
      autoPublish(); // админ поправил каталог → тихо обновим витрину на GitHub
    } catch (e) {
      if (!silent) {
        const banner = $('offlineBanner');
        if (state.products.length) {
          const mins = Math.max(1, Math.round((Date.now() - state.lastFetch) / 60000));
          banner.textContent = `📶 Нет связи с базой. Показан каталог, сохранённый ${mins < 60 ? mins + ' мин' : Math.round(mins / 60) + ' ч'} назад`;
        } else {
          banner.textContent = '📶 Нет связи с базой данных. Проверь интернет и обнови страницу';
        }
        banner.hidden = false;
        $('loader').hidden = true;
        renderAll();
      }
    }
  }

  /* ── Вход/выход: админ или сотрудник ──────────── */

  async function applySession(session) {
    state.session = session;
    state.isAdmin = false;
    state.role = null;
    state.canPurchase = false;
    if (session) {
      try {
        // роль аккаунта: admin / manager / cashier
        const { data, error } = await sb.rpc('catalog_my_role');
        if (error) throw error;
        state.role = data || 'cashier';
        state.isAdmin = state.role === 'admin';
        state.canPurchase = state.role === 'admin' || state.role === 'manager';
      } catch (e) {
        // база без ролей (ОБНОВЛЕНИЕ-7 ещё не выполнено) — прежнее поведение:
        // вошедший видит цены; админ определяется по старому списку catalog_admins
        try {
          const { data } = await sb.from('catalog_admins').select('email');
          state.isAdmin = (data || []).some((a) => a.email === session.user?.email);
        } catch (e2) { state.isAdmin = true; }
        state.role = state.isAdmin ? 'admin' : 'manager';
        state.canPurchase = true;
      }
      if (state.canPurchase) loadContacts(); else state.contacts = {};
      loadCompetitors(); // разведку цен ведёт любой вошедший сотрудник
    } else {
      state.competitors = [];
      state.contacts = {};
      // при выходе стираем сохранённые цены и контакты — они только для вошедших
      try {
        localStorage.removeItem(PRICE_CACHE_KEY);
        localStorage.removeItem(CONTACTS_CACHE_KEY);
        localStorage.removeItem(SALES_CACHE_KEY);
      } catch (e) { /* некритично */ }
    }
    $('fabAdd').hidden = !state.isAdmin;
    $('adminBtn').classList.toggle('is-admin', !!session);
    $('adminBtnLabel').hidden = !!session; // после входа — только значок, без «Войти»
    if (!$('productSheet').hidden) {
      $('sheetAdminActions').hidden = !state.isAdmin;
      if (currentProduct) { renderProductPrices(currentProduct); renderCompetitors(currentProduct); }
    }
    renderAll(); // и сетка, и чипы — после входа появляется «🔥 Ходовые»
    // владелец вошёл → тихо убираем дубли (если есть) и запускаем автопоиск фото
    if (isOwner()) { setTimeout(autoDedup, 2000); setTimeout(autoPhotoSearch, 4000); }
  }

  async function loadContacts() {
    try {
      const { data, error } = await sb.from('catalog_supplier_contacts').select('*');
      if (error) throw error;
      state.contacts = Object.fromEntries(data.map((c) => [c.supplier_id, c]));
      try { localStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(state.contacts)); } catch (e) { /* нет места */ }
    } catch (e) {
      // нет связи — берём сохранённые контакты; база старой версии — работаем без них
      try { state.contacts = JSON.parse(localStorage.getItem(CONTACTS_CACHE_KEY)) || {}; }
      catch (e2) { state.contacts = {}; }
    }
    if (!$('productSheet').hidden && currentProduct) renderProductPrices(currentProduct);
  }

  /* ── Разведка цен: сравнение с другими магазинами ──────
   * Любой вошедший сотрудник может внести розничную цену товара в чужом
   * магазине. В карточке видно нашу цену и цены конкурентов с датой. */

  function loadCompetitors() {
    return sb.from('catalog_competitors').select('*').order('name')
      .then(({ data, error }) => {
        if (!error) state.competitors = data || [];
        if (!$('productSheet').hidden && currentProduct) renderCompetitors(currentProduct);
      })
      .catch(() => { /* нет связи — работаем без списка магазинов */ });
  }

  function competitorById(id) { return state.competitors.find((c) => c.id === id) || null; }

  async function renderCompetitors(p) {
    const box = $('sheetCompetitors');
    if (!box) return;
    if (!state.session) { box.innerHTML = ''; return; } // разведка — только после входа
    const our = (p.retail_price != null && p.retail_price !== '') ? Number(p.retail_price) : null;
    let rows = [];
    try {
      const { data, error } = await sb.from('catalog_competitor_prices')
        .select('*, catalog_competitors(name)').eq('product_id', p.id);
      if (error) throw error;
      rows = data || [];
    } catch (e) { rows = []; }
    if (currentProduct !== p) return;

    rows.sort((a, b) => Number(a.price) - Number(b.price));
    const ourRow = `<div class="comp-row comp-ours">
      <span class="comp-store">🏪 Наш магазин</span>
      <span class="comp-price">${our != null ? esc(fmtPrice(our)) : '<span class="muted" style="margin:0">цена не указана</span>'}</span>
    </div>`;
    const list = rows.map((r) => {
      const price = Number(r.price);
      let diff = '';
      if (our != null) {
        if (price < our) diff = `<span class="comp-diff comp-cheaper">у них дешевле на ${esc(fmtPrice(our - price))}</span>`;
        else if (price > our) diff = `<span class="comp-diff comp-dearer">у них дороже на ${esc(fmtPrice(price - our))}</span>`;
        else diff = '<span class="comp-diff">такая же цена</span>';
      }
      const name = (r.catalog_competitors && r.catalog_competitors.name) || competitorById(r.competitor_id)?.name || 'Магазин';
      return `<div class="comp-row">
        <span class="comp-store">🏬 ${esc(name)}<span class="comp-date">внесено ${esc(fmtDate(r.observed_at))}</span></span>
        <span class="comp-price">${esc(fmtPrice(price))}${diff}</span>
      </div>`;
    }).join('');

    box.innerHTML = `<div class="comp-block">
      <div class="comp-title">Цены в других магазинах</div>
      ${ourRow}${list}
      <button class="btn btn-secondary btn-block" id="compAddBtn">＋ Добавить цену магазина</button>
    </div>`;
  }

  let compChosenId = null;   // выбранный существующий магазин
  let compProduct = null;    // товар, для которого вносим цену

  function openCompetitorAdd(p) {
    compProduct = p;
    compChosenId = null;
    $('compProductName').textContent = p.name;
    $('compStoreSearch').value = '';
    $('compPrice').value = '';
    $('compError').hidden = true;
    $('compChosen').hidden = true;
    renderCompStoreList();
    openSheet('competitorAddSheet');
  }

  function showCompChosen() {
    const c = competitorById(compChosenId);
    const box = $('compChosen');
    if (c) { box.textContent = 'Магазин: ' + c.name; box.hidden = false; }
    else box.hidden = true;
    renderCompStoreList();
    $('compPrice').focus();
  }

  function renderCompStoreList() {
    const q = norm($('compStoreSearch').value);
    const typed = $('compStoreSearch').value.trim();
    const filtered = q ? state.competitors.filter((c) => norm(c.name).includes(q)) : state.competitors;
    let html = filtered.slice(0, 30).map((c) => {
      const on = compChosenId === c.id;
      return `<button type="button" class="btn btn-secondary btn-block${on ? ' picked' : ''}" data-comp-store="${esc(c.id)}">
        ${on ? '✓ ' : ''}🏬 ${esc(c.name)}</button>`;
    }).join('');
    // предложить создать новый магазин из введённого текста
    const exists = filtered.some((c) => norm(c.name) === q);
    if (typed && !exists) {
      html += `<button type="button" class="btn btn-secondary btn-block comp-new" data-comp-new="${esc(typed)}">＋ Создать магазин «${esc(typed)}»</button>`;
    }
    if (!html) html = '<p class="muted">Начни вводить название магазина</p>';
    $('compStoreList').innerHTML = html;
  }

  async function submitCompetitorPrice(e) {
    e.preventDefault();
    const btn = $('compSubmit');
    const price = parsePriceNum($('compPrice').value);
    if (price == null) { $('compError').textContent = 'Впиши цену числом'; $('compError').hidden = false; return; }
    if (!compChosenId) { $('compError').textContent = 'Выбери или создай магазин'; $('compError').hidden = false; return; }
    btn.disabled = true;
    try {
      const record = {
        product_id: compProduct.id,
        competitor_id: compChosenId,
        price,
        observed_at: new Date().toISOString().slice(0, 10),
      };
      const { error } = await sb.from('catalog_competitor_prices')
        .upsert(record, { onConflict: 'product_id,competitor_id' });
      if (error) throw error;
      closeSheet('competitorAddSheet');
      toast('Цена магазина сохранена ✓');
      if (currentProduct === compProduct) renderCompetitors(compProduct);
    } catch (err) {
      $('compError').textContent = 'Не удалось сохранить: ' + (err.message || err)
        + '. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-8.sql в SQL Editor.';
      $('compError').hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // добавить фото товара — доступно любому вошедшему сотруднику
  async function addPhotoToProduct(file, p) {
    if (!file || !p || !sb) return;
    const label = $('btnAddPhotoLabel');
    try {
      label.style.pointerEvents = 'none';
      toast('Загружаем фото…');
      let blob = await compressImage(file);
      if (cleanPhotosOn()) blob = await whitenBackground(blob, toast);
      const url = await uploadPhoto(blob);
      const { error } = await sb.rpc('catalog_add_photo', { p_product_id: p.id, p_url: url });
      if (error) throw error;
      p.photos = [...(p.photos || []), url]; // сразу показываем
      if (currentProduct === p) openProduct(p);
      renderGrid();
      toast('Фото добавлено ✓');
    } catch (err) {
      toast('Не удалось добавить фото: ' + (err.message || err));
    } finally {
      label.style.pointerEvents = '';
      $('addPhotoInput').value = '';
    }
  }

  // Покупатель без аккаунта предлагает фото — попадает в очередь на проверку,
  // видно всем станет после одобрения сотрудником (защита витрины от плохих фото)
  async function suggestPhotoToProduct(file, p) {
    if (!file || !p || !sb) return;
    const label = $('btnSuggestPhotoLabel');
    try {
      label.style.pointerEvents = 'none';
      toast('Отправляем фото…');
      let blob = await compressImage(file);
      if (cleanPhotosOn()) blob = await whitenBackground(blob, toast);
      const url = await uploadPhoto(blob, 'suggestions');
      const { error } = await sb.rpc('catalog_suggest_photo', { p_product_id: p.id, p_url: url });
      if (error) throw error;
      toast('Спасибо! Фото отправлено на проверку ✓');
    } catch (err) {
      toast('Не удалось отправить фото: ' + (err.message || err));
    } finally {
      label.style.pointerEvents = '';
      $('suggestPhotoInput').value = '';
    }
  }

  /* ── Предложенные фото: сотрудник одобряет/отклоняет ── */
  let suggestions = [];

  async function loadSuggestionsCount() {
    if (!sb || !state.session) { state.suggCount = 0; return; }
    try {
      const { count } = await sb.from('catalog_photo_suggestions').select('id', { count: 'exact', head: true });
      state.suggCount = count || 0;
    } catch (e) { state.suggCount = 0; }
  }

  async function openSuggestions() {
    openSheet('suggestionsSheet');
    $('suggestionsList').innerHTML = '<p class="muted">Загружаем…</p>';
    try {
      const { data, error } = await sb.from('catalog_photo_suggestions')
        .select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      suggestions = data || [];
    } catch (e) {
      $('suggestionsList').innerHTML = '<p class="muted">Не удалось загрузить. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-13.sql</p>';
      return;
    }
    renderSuggestions();
  }

  function renderSuggestions() {
    const box = $('suggestionsList');
    if (!suggestions.length) { box.innerHTML = '<p class="muted">🎉 Очередь пуста — новых предложений нет.</p>'; return; }
    const byId = new Map(state.products.map((p) => [p.id, p]));
    box.innerHTML = suggestions.map((s) => {
      const p = byId.get(s.product_id);
      return `<div class="sugg-row" data-sugg="${esc(s.id)}">
        <img class="sugg-img" src="${esc(s.url)}" alt="" loading="lazy">
        <div class="sugg-info">
          <div class="sugg-name">${esc(p ? p.name : 'Товар удалён')}</div>
          <div class="sugg-actions">
            <button class="btn btn-primary sugg-ok" data-approve="${esc(s.id)}">✓ Одобрить</button>
            <button class="btn btn-danger sugg-no" data-reject="${esc(s.id)}">✕ Отклонить</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  async function approveSuggestion(id) {
    const s = suggestions.find((x) => x.id === id);
    try {
      const { error } = await sb.rpc('catalog_approve_suggestion', { p_id: id });
      if (error) throw error;
      // сразу показываем фото у товара локально
      const p = state.products.find((x) => x.id === s.product_id);
      if (p) { p.photos = [...(p.photos || []), s.url]; }
      suggestions = suggestions.filter((x) => x.id !== id);
      renderSuggestions();
      saveCache(); renderGrid();
      state.suggCount = Math.max(0, (state.suggCount || 1) - 1);
      toast('Фото одобрено ✓');
    } catch (e) { toast('Не получилось: ' + (e.message || e)); }
  }

  async function rejectSuggestion(id) {
    const s = suggestions.find((x) => x.id === id);
    try {
      const { error } = await sb.from('catalog_photo_suggestions').delete().eq('id', id);
      if (error) throw error;
      if (s) await removePhotosFromStorage([s.url]);
      suggestions = suggestions.filter((x) => x.id !== id);
      renderSuggestions();
      state.suggCount = Math.max(0, (state.suggCount || 1) - 1);
      toast('Отклонено');
    } catch (e) { toast('Не получилось: ' + (e.message || e)); }
  }

  /* ── «Дозаполни витрину»: сотрудник быстро фотографирует товары без фото ── */
  let photoFillTarget = null;
  const PHOTO_FILL_LIMIT = 60;

  function openPhotoFill() {
    $('photoFillSearch').value = '';
    $('cleanPhotosToggle').checked = cleanPhotosOn();
    renderPhotoFillList();
    openSheet('photoFillSheet');
  }

  function renderPhotoFillList() {
    const q = norm($('photoFillSearch').value);
    const all = photoCandidates();
    const total = all.length;
    let list = all;
    if (q) list = all.filter((p) => (p._name || norm(p.name)).includes(q) || (p._codes || []).some((c) => c.includes(q)));
    $('photoFillCount').textContent = q ? `Без фото: ${total} · найдено: ${list.length}` : `Осталось без фото: ${total}`;
    const box = $('photoFillList');
    if (!list.length) {
      box.innerHTML = total
        ? '<p class="muted">Ничего не нашлось. Измени запрос.</p>'
        : '<p class="muted">🎉 У всех товаров есть фото — витрина заполнена!</p>';
      return;
    }
    const shown = list.slice(0, PHOTO_FILL_LIMIT);
    box.innerHTML = shown.map((p) => {
      const sub = [p.code ? 'Код ' + esc(p.code) : '', (p.barcodes || [])[0] ? 'ШК ' + esc(p.barcodes[0]) : ''].filter(Boolean).join(' · ');
      return `<div class="fill-row">
        <div class="fill-info"><div class="fill-name">${esc(p.name)}</div>${sub ? `<div class="fill-sub">${sub}</div>` : ''}</div>
        <button class="btn btn-primary fill-cam" data-fill-cam="${esc(p.id)}">📷</button>
      </div>`;
    }).join('') + (list.length > shown.length
      ? `<p class="muted" style="text-align:center;margin-top:10px">…и ещё ${list.length - shown.length}. Уточни поиском.</p>` : '');
  }

  async function photoFillPick(file) {
    const p = photoFillTarget;
    photoFillTarget = null;
    $('photoFillInput').value = '';
    if (!file || !p) return;
    await addPhotoToProduct(file, p);
    renderPhotoFillList(); // товар с фото уходит из списка
  }

  async function createCompetitor(name) {
    const { data, error } = await sb.from('catalog_competitors').insert({ name }).select().single();
    if (error) { toast('Ошибка: ' + error.message); return null; }
    state.competitors.push(data);
    state.competitors.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return data.id;
  }

  /* ── Кэш цен на телефоне: карточки открываются и без связи ── */

  const PRICE_CACHE_KEY = 'wm_price_cache_v1';
  const CONTACTS_CACHE_KEY = 'wm_contacts_cache_v1';
  const PRICE_CACHE_MAX = 400; // товаров в кэше; старые вытесняются

  function readPriceCache() {
    try { return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function cachePrices(productId, rows) {
    try {
      const all = readPriceCache();
      all[productId] = {
        rows: rows.map(({ supplier_id, price, price_date }) => ({ supplier_id, price, price_date })),
        ts: Date.now(),
      };
      const keys = Object.keys(all);
      if (keys.length > PRICE_CACHE_MAX) {
        keys.sort((a, b) => all[a].ts - all[b].ts)
          .slice(0, keys.length - PRICE_CACHE_MAX)
          .forEach((k) => delete all[k]);
      }
      localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* нет места — кэш вспомогательный */ }
  }

  /* ── Админ: фото в форме ──────────────────────── */

  function renderPhotoManager() {
    const html = formPhotos.map((ph, i) => `
      <div class="photo-thumb">
        <img src="${esc(ph.url || ph.preview)}" alt="">
        <button type="button" class="thumb-x" data-idx="${i}">✕</button>
      </div>`).join('');
    $('photoManager').innerHTML = html + '<button type="button" class="photo-add" id="photoAddBtn">📷</button>';
  }

  async function compressImage(file, maxSide = 1280, quality = 0.82) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      return blob || file;
    } catch (e) {
      return file; // формат не поддержан — грузим как есть
    }
  }

  // «Чистый белый фон»: вырезаем товар из фона и ставим на белый — фото
  // становятся ровными, как в витрине. Работает на телефоне, «мозг» для обрезки
  // подгружается один раз. Если не вышло (нет сети/не потянул) — берём обычное фото.
  let _bgr = null;
  async function loadBgRemoval() {
    if (_bgr) return _bgr;
    _bgr = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
    return _bgr;
  }
  const cleanPhotosOn = () => { try { return localStorage.getItem('wm_clean_photos') === '1'; } catch (e) { return false; } };
  async function whitenBackground(blob, onStep) {
    try {
      if (onStep) onStep('Делаю чистый белый фон…');
      const mod = await loadBgRemoval();
      const cut = await mod.removeBackground(blob, { publicPath: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/dist/' });
      const img = await createImageBitmap(cut);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d');
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(img, 0, 0);
      const out = await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.9));
      return out || blob;
    } catch (e) { return blob; }
  }

  async function uploadPhoto(blob, folder = 'products') {
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg', cacheControl: '31536000',
    });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function removePhotosFromStorage(urls) {
    const paths = urls
      .map((u) => { const m = u.split(`/${BUCKET}/`)[1]; return m ? decodeURIComponent(m) : null; })
      .filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
  }

  /* ── Админ: форма товара ──────────────────────── */

  function openForm(product) {
    editingProduct = product;
    $('formTitle').textContent = product ? 'Изменить товар' : 'Новый товар';
    $('fName').value = product?.name || '';
    $('fCode').value = product?.code || '';
    $('fArticle').value = product?.article || '';
    $('fBarcodes').value = (product?.barcodes || []).join('\n');
    $('fWeighted').checked = !!product?.is_weighted;
    $('fUnit').value = product?.unit || '';
    $('fDepartment').value = product?.department || '';
    $('fNote').value = product?.note || '';
    $('fDescription').value = product?.description || '';
    $('fGroup').innerHTML = '<option value="">Без группы</option>' +
      state.groups.map((g) => `<option value="${esc(g.id)}"${g.id === product?.group_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    $('fSupplier').innerHTML = '<option value="">Выбрать поставщика…</option>' +
      state.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    formSupplierIds = [...(product?.supplier_ids || [])];
    renderFormSupplierTags();
    formPhotos = (product?.photos || []).map((url) => ({ url }));
    renderPhotoManager();
    $('formError').hidden = true;
    openSheet('formSheet');
  }

  async function submitForm(e) {
    e.preventDefault();
    const btn = $('formSubmit');
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    $('formError').hidden = true;
    try {
      // загружаем новые фото
      const photoUrls = [];
      for (const ph of formPhotos) {
        if (ph.url) photoUrls.push(ph.url);
        else photoUrls.push(await uploadPhoto(ph.blob));
      }
      const record = {
        name: $('fName').value.trim(),
        group_id: $('fGroup').value || null,
        supplier_ids: formSupplierIds,
        code: $('fCode').value.trim() || null,
        article: $('fArticle').value.trim() || null,
        barcodes: $('fBarcodes').value.split('\n').map((s) => s.trim()).filter(Boolean),
        is_weighted: $('fWeighted').checked,
        unit: $('fUnit').value.trim() || null,
        department: $('fDepartment').value.trim() || null,
        note: $('fNote').value.trim() || null,
        photos: photoUrls,
        updated_at: new Date().toISOString(),
        // описание пишем, только если колонка добавлена (ОБНОВЛЕНИЕ-15)
        ...(hasProductCol('description') ? { description: $('fDescription').value.trim() || null } : {}),
      };
      if (editingProduct) {
        const removed = (editingProduct.photos || []).filter((u) => !photoUrls.includes(u));
        const { error } = await sb.from('catalog_products').update(record).eq('id', editingProduct.id);
        if (error) throw error;
        await removePhotosFromStorage(removed);
        toast('Товар обновлён ✓');
      } else {
        const { error } = await sb.from('catalog_products').insert(record);
        if (error) throw error;
        toast('Товар добавлен ✓');
      }
      closeSheet('formSheet');
      closeSheet('productSheet');
      await refresh({ silent: true });
      renderAll();
    } catch (err) {
      $('formError').textContent = 'Не удалось сохранить: ' + (err.message || err);
      $('formError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  }

  async function deleteProduct() {
    if (!currentProduct) return;
    if (!confirm(`Удалить «${currentProduct.name}» из каталога?`)) return;
    try {
      const { error } = await sb.from('catalog_products').delete().eq('id', currentProduct.id);
      if (error) throw error;
      await removePhotosFromStorage(currentProduct.photos || []);
      toast('Товар удалён');
      closeSheet('productSheet');
      await refresh({ silent: true });
      renderAll();
    } catch (err) {
      toast('Ошибка удаления: ' + (err.message || err));
    }
  }

  /* ── Админ: группы ────────────────────────────── */

  function renderGroupsManager() {
    $('groupsList').innerHTML = state.groups.map((g) => `
      <div class="group-row" data-id="${esc(g.id)}">
        <input class="input group-name" value="${esc(g.name)}">
        <button class="group-del" title="Удалить группу">🗑</button>
      </div>`).join('') || '<p class="muted">Групп пока нет — добавь первую ниже</p>';
  }

  async function addGroup() {
    const name = $('newGroupName').value.trim();
    if (!name) return;
    const maxSort = Math.max(0, ...state.groups.map((g) => g.sort_order || 0));
    const { error } = await sb.from('catalog_groups').insert({ name, sort_order: maxSort + 1 });
    if (error) { toast('Ошибка: ' + error.message); return; }
    $('newGroupName').value = '';
    await refresh({ silent: true });
    renderAll();
    renderGroupsManager();
    toast('Группа добавлена ✓');
  }

  async function renameGroup(id, name) {
    if (!name.trim()) return;
    const { error } = await sb.from('catalog_groups').update({ name: name.trim() }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    await refresh({ silent: true });
    renderAll();
  }

  async function deleteGroup(id) {
    const g = groupById(id);
    if (!confirm(`Удалить группу «${g?.name}»? Товары останутся — без группы.`)) return;
    const { error } = await sb.from('catalog_groups').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    state.selGroups = state.selGroups.filter((x) => x !== id);
    await refresh({ silent: true });
    renderAll();
    renderGroupsManager();
    toast('Группа удалена');
  }

  /* ── Поставщики ───────────────────────────────── */

  // выбранные поставщики в форме товара
  function renderFormSupplierTags() {
    $('fSupplierTags').innerHTML = formSupplierIds.map((id) => {
      const s = supplierById(id);
      if (!s) return '';
      return `<span class="tag">🚚 ${esc(s.name)} <button type="button" data-untag="${esc(id)}">✕</button></span>`;
    }).join('') || '<span class="muted" style="margin:0">Не указаны</span>';
  }

  // список для фильтра (доступен всем; с поиском — поставщиков может быть много)
  function renderSupplierList() {
    const counts = {};
    for (const p of state.products) {
      for (const id of (p.supplier_ids || [])) counts[id] = (counts[id] || 0) + 1;
    }
    const q = norm($('supplierSearch').value);
    const filtered = q
      ? state.suppliers.filter((s) => norm(s.name).includes(q) || translit(norm(s.name)).includes(translit(q)))
      : state.suppliers;
    let html = '';
    if (state.selSuppliers.length) {
      html += `<button class="btn btn-ghost btn-block" data-pick-supplier="" style="margin-bottom:6px">✕ Снять выбор (${state.selSuppliers.length})</button>`;
    }
    html += filtered.slice(0, 100).map((s) => {
      const on = state.selSuppliers.includes(s.id);
      // после входа под поставщиком видны контакты: позвонить или написать в WhatsApp
      const c = state.contacts[s.id];
      const contact = c && (c.phone || c.contact_name || c.note)
        ? `<div class="sup-contact">${c.contact_name ? `<span>${esc(c.contact_name)}</span>` : ''}${
          c.phone ? `<a href="${esc(telHref(c.phone))}">📞 ${esc(c.phone)}</a><a href="${esc(waHref(c.phone))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}${
          c.note ? `<div class="sup-note">${esc(c.note)}</div>` : ''}</div>`
        : '';
      return `<div class="sup-row">
        <button class="btn btn-secondary btn-block${on ? ' picked' : ''}" data-pick-supplier="${esc(s.id)}">
          <span>${on ? '✓ ' : ''}🚚 ${esc(s.name)}</span> <span class="chip-count">${counts[s.id] || 0}</span>
        </button>${contact}</div>`;
    }).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
    if (filtered.length > 100) html += `<p class="muted">Показаны первые 100 из ${filtered.length} — уточни поиск</p>`;
    $('supplierList').innerHTML = html;
  }

  /* ── Все группы (список с поиском) ────────────── */

  function renderGroupsPick() {
    const counts = {};
    for (const p of state.products) {
      if (p.group_id) counts[p.group_id] = (counts[p.group_id] || 0) + 1;
    }
    const q = norm($('groupsPickSearch').value);
    const filtered = q ? state.groups.filter((g) => norm(g.name).includes(q)) : state.groups;
    const picked = state.selGroups.filter((x) => x !== 'none' && x !== 'weighted');
    let html = '';
    if (picked.length) {
      html += `<button class="btn btn-ghost btn-block" data-pick-group="" style="margin-bottom:6px">✕ Снять выбор (${picked.length})</button>`;
    }
    html += filtered.map((g) => {
      const on = state.selGroups.includes(g.id);
      return `
      <button class="btn btn-secondary btn-block${on ? ' picked' : ''}" data-pick-group="${esc(g.id)}">
        <span>${on ? '✓ ' : ''}📁 ${esc(g.name)}</span> <span class="chip-count">${counts[g.id] || 0}</span>
      </button>`;
    }).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
    $('groupsPickList').innerHTML = html;
  }

  // управление (только админ)
  function renderSuppliersManager() {
    $('suppliersManageList').innerHTML = state.suppliers.map((s) => `
      <div class="group-row" data-id="${esc(s.id)}">
        <input class="input supplier-name" value="${esc(s.name)}">
        <button class="group-del sup-contact-btn" title="Контакты поставщика">${state.contacts[s.id]?.phone ? '📞' : '📇'}</button>
        <button class="group-del" title="Удалить поставщика">🗑</button>
      </div>`).join('') || '<p class="muted">Поставщиков пока нет — добавь первого ниже</p>';
  }

  /* ── Контакты поставщика (редактирует админ) ──── */

  let editingContactSupplier = null;

  function openContactForm(supplierId) {
    editingContactSupplier = supplierId;
    const s = supplierById(supplierId);
    const c = state.contacts[supplierId] || {};
    $('contactTitle').textContent = s ? `Контакты: ${s.name}` : 'Контакты поставщика';
    $('cPhone').value = c.phone || '';
    $('cName').value = c.contact_name || '';
    $('cNote').value = c.note || '';
    $('contactError').hidden = true;
    openSheet('supplierContactSheet');
  }

  async function submitContactForm(e) {
    e.preventDefault();
    const btn = $('contactSubmit');
    btn.disabled = true;
    try {
      const record = {
        supplier_id: editingContactSupplier,
        phone: $('cPhone').value.trim() || null,
        contact_name: $('cName').value.trim() || null,
        note: $('cNote').value.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from('catalog_supplier_contacts')
        .upsert(record, { onConflict: 'supplier_id' });
      if (error) throw error;
      state.contacts[editingContactSupplier] = record;
      closeSheet('supplierContactSheet');
      renderSuppliersManager();
      toast('Контакты сохранены ✓');
    } catch (err) {
      $('contactError').textContent = 'Не удалось сохранить: ' + (err.message || err)
        + '. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-2.sql в SQL Editor.';
      $('contactError').hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function addSupplier() {
    const name = $('newSupplierName').value.trim();
    if (!name) return;
    const { error } = await sb.from('catalog_suppliers').insert({ name });
    if (error) { toast('Ошибка: ' + error.message); return; }
    $('newSupplierName').value = '';
    await refresh({ silent: true });
    renderAll();
    renderSuppliersManager();
    toast('Поставщик добавлен ✓');
  }

  async function renameSupplier(id, name) {
    if (!name.trim()) return;
    const { error } = await sb.from('catalog_suppliers').update({ name: name.trim() }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    await refresh({ silent: true });
    renderAll();
  }

  async function deleteSupplier(id) {
    const s = supplierById(id);
    if (!confirm(`Удалить поставщика «${s?.name}»? Товары останутся — без поставщика.`)) return;
    const { error } = await sb.from('catalog_suppliers').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    state.selSuppliers = state.selSuppliers.filter((x) => x !== id);
    await refresh({ silent: true });
    renderAll();
    renderSuppliersManager();
    toast('Поставщик удалён');
  }

  /* ── Импорт из 1С (Excel) ─────────────────────────
   * Файл 1 — отчёт «Цены поставщиков»: товары, коды, группы, поставщики, ед.изм.
   * Файл 2 (не обязателен) — отчёт «Штрихкоды номенклатуры»: все штрихкоды.
   * Товары объединяются по «Код товара»; существующие обновляются, фото сохраняются. */

  let impParsed = null; // результат разбора файлов, ждёт подтверждения

  function loadXlsxLib() {
    if (window.XLSX) return Promise.resolve();
    return loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  }

  function cellStr(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v));
    return String(v).trim();
  }

  async function readSheet(file) {
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  }

  // ищем строку заголовков и определяем, в какой колонке что лежит
  function detectColumns(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const labels = rows[r].map((v) => cellStr(v).toLowerCase());
      const next = (rows[r + 1] || []).map((v) => cellStr(v).toLowerCase());
      if (!labels.some((l) => l.includes('номенклатура') || l.includes('наименование'))) continue;

      const cols = {};
      const width = Math.max(labels.length, next.length);
      for (let c = 0; c < width; c++) {
        const l = (labels[c] || '') + ' ' + (next[c] || '');
        if (!l.trim()) continue;
        if (l.includes('артикул')) cols.article ??= c;
        else if (l.includes('штрих')) cols.barcode ??= c;
        else if (l.includes('код товара') || l.includes('номенклатура.код')) cols.code = c;
        else if (l.includes('код') && cols.code === undefined) cols.code = c;
        else if (l.includes('контрагент') || l.includes('поставщик')) cols.supplier ??= c;
        else if (l.includes('единиц') || /(^|\s)ед\.?(\s|$)/.test(l)) cols.unit ??= c; // «Единица измерения» или «Ед.»
        // розничная цена (цена продажи в магазине) — отдельно от закупочной
        else if (l.includes('розничн') || l.includes('продажн') || l.includes('цена продаж')) cols.retail ??= c;
        else if (l.includes('цена')) cols.price ??= c;
        else if (l.includes('количество') || /(^|\s)кол-?во(\s|$)/.test(l)) cols.qty ??= c;
        // выручка: «Сумма продажи»/«Выручка» — приоритетнее «приходной суммы»/себестоимости/НДС
        else if ((l.includes('сумма продаж') || l.includes('выручка')) && !/приход|ндс|скидк|закуп|себестоим/.test(l)) cols.amount = c;
        else if (l.includes('сумма') && cols.amount === undefined && !/приход|ндс|скидк|закуп|себестоим|дополнит/.test(l)) cols.amount = c;
        else if (l.includes('дата') || l.includes('период')) cols.date ??= c;
        else if (l.includes('групп')) cols.group ??= c;
        else if ((l.includes('номенклатура') || l.includes('наименование')) && cols.name === undefined) cols.name = c;
      }
      if (cols.name === undefined) continue;
      // если следующая строка — подзаголовки («Номенклатура.Код»), данные начинаются через одну
      const hasSubheader = next.some((l) => l.includes('номенклатура.'));
      return { cols, dataStart: r + (hasSubheader ? 2 : 1) };
    }
    return null;
  }

  // цена из ячейки: число или строка вида «1 234,50»
  // Число из ячейки 1С. Универсально понимает разделители:
  //   «1 234,56» и «1,234.56» и «1 234.56» -> 1234.56; «96,76» -> 96.76; «45.00» -> 45.
  // Запятая = тысячи, если и точка есть, или если после неё ровно 3 цифры.
  function parsePriceNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v > 0 ? v : null;
    let s = String(v).replace(/\s/g, '');
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const p = s.split(',');
      s = (p.length === 2 && p[1].length === 3 && /^\d+$/.test(p[0]) && Number(p[0]) !== 0)
        ? s.replace(',', '')
        : s.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function parsePriceReport(rows) {
    const det = detectColumns(rows);
    if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура, Код товара…) в файле 1');
    const { cols, dataStart } = det;
    const byKey = new Map();
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const name = cellStr(row[cols.name]);
      if (!name) continue;
      const code = cols.code !== undefined ? cellStr(row[cols.code]) : '';
      const key = code || norm(name);
      let item = byKey.get(key);
      if (!item) {
        item = { name, code: code || null, article: null, group: null, suppliers: new Set(), barcodes: new Set(), weighted: false, unit: null, retail: null, prices: new Map() };
        byKey.set(key, item);
      }
      const art = cols.article !== undefined ? cellStr(row[cols.article]) : '';
      const grp = cols.group !== undefined ? cellStr(row[cols.group]) : '';
      const sup = cols.supplier !== undefined ? cellStr(row[cols.supplier]) : '';
      const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
      const unit = cols.unit !== undefined ? cellStr(row[cols.unit]).toLowerCase() : '';
      const price = cols.price !== undefined ? parsePriceNum(row[cols.price]) : null;
      const retail = cols.retail !== undefined ? parsePriceNum(row[cols.retail]) : null;
      const rowDate = cols.date !== undefined ? parseDateCell(row[cols.date]) : null; // дата последнего поступления
      if (art && !item.article) item.article = art;
      if (grp && !item.group) item.group = grp;
      if (retail != null && item.retail == null) item.retail = retail; // розничная цена товара
      if (sup) item.suppliers.add(sup);
      if (bc) item.barcodes.add(bc);
      if (unit && !item.unit) item.unit = unit;
      if (unit === 'кг') item.weighted = true;
      if (sup && price != null) {
        // несколько строк по поставщику — оставляем самое свежее поступление
        const prev = item.prices.get(sup);
        if (!prev || (rowDate || '') >= (prev.date || '')) item.prices.set(sup, { price, date: rowDate });
      }
    }
    return byKey;
  }

  // второй файл: пары «товар — штрихкод», добавляем штрихкоды к товарам из первого
  function mergeBarcodesReport(rows, byKey) {
    const det = detectColumns(rows);
    if (!det) throw new Error('Не нашёл строку заголовков в файле 2');
    const { cols, dataStart } = det;
    const byName = new Map();
    for (const item of byKey.values()) byName.set(norm(item.name), item);
    let added = 0;
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
      if (!bc) continue;
      const code = cols.code !== undefined ? cellStr(row[cols.code]) : '';
      const name = cellStr(row[cols.name]);
      const item = (code && byKey.get(code)) || byName.get(norm(name));
      if (item && !item.barcodes.has(bc)) { item.barcodes.add(bc); added++; }
    }
    return added;
  }

  // Прайс-лист розничных цен из 1С: колонка «Номенклатура» + «Розничный тип
  // цен» (розничная цена). Товары сгруппированы строками-заголовками (у них нет
  // цены). Артикул часто внутри названия («Арт.st-917»). Кода нет — товар ищем
  // по артикулу и названию.
  // дата из шапки прайс-листа: «17.07.2026» или «17 июля 2026 г.»
  function parseHeaderDate(rows) {
    const RU_MON = ['январ', 'феврал', 'март', 'апрел', 'мая', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      const line = (rows[r] || []).map((v) => cellStr(v)).join(' ');
      const iso = parseDateCell(line);
      if (iso) return iso;
      const m = line.toLowerCase().match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/);
      if (m) {
        const mi = RU_MON.findIndex((w) => m[2].startsWith(w));
        if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
    }
    return null;
  }

  function parseRetailList(rows) {
    const det = detectColumns(rows);
    if (!det || det.cols.name === undefined || det.cols.retail === undefined) {
      throw new Error('Не нашёл колонки «Номенклатура» и «Розничный тип цен» в прайс-листе');
    }
    const { cols, dataStart } = det;
    const fileDate = parseHeaderDate(rows);
    const recs = []; let group = null;
    for (let r = dataStart; r < rows.length; r++) {
      const name = cellStr(rows[r][cols.name]);
      if (!name) continue;
      if (/^\s*(итого|всего|номенклатура|наименование)\b/i.test(name)) continue;
      const retail = parsePriceNum(rows[r][cols.retail]);
      if (retail == null) { group = name; continue; } // строка без цены — заголовок группы
      const art = (name.match(/арт[\.\s№:]*([0-9a-zа-яё][0-9a-zа-яё\-\/.]*)/i) || [])[1] || null;
      recs.push({ name, article: art, group, retail });
    }
    return { recs, fileDate };
  }

  // Каталог сам определяет, что за файл 1С загрузили, по его шапке.
  // Возвращает: 'prices'|'stock'|'sales'|'contacts'|'retail'|'photo'|'barcodes'|null
  function detectReportType(rows) {
    const scan = rows.slice(0, 32);
    const head = scan.map((r) => (r || []).map((c) => cellStr(c)).join('\t')).join('\n').toLowerCase();
    const has = (s) => head.includes(s);
    const cellExact = (val) => scan.some((r) => (r || []).some((c) => cellStr(c).toLowerCase() === val));
    const hasPrice = /цена/.test(head);
    const hasQty = has('количество') || /кол-?во/.test(head);
    const hasStock = has('остаток') || has('остатк') || has('на конец дня');
    const hasContragent = cellExact('контрагент');
    const hasPhone = has('телефон');
    const hasSupplier = has('поставщик') || hasContragent;

    if (/https?:\/\//.test(head)) return 'photo';
    // «Контрагент» + «телефон» — однозначно справочник контактов (в отчётах цен
    // телефона нет). Слово «количество» в служебной шапке не должно мешать.
    if (hasContragent && hasPhone) return 'contacts';
    if (has('период') && hasQty && !hasStock) return 'sales';
    if (hasStock || (has('розничная цена') && hasQty)) return 'stock';
    if (has('прайс-лист') || has('прайслист') || has('тип цен')) return 'retail';
    if (hasSupplier && hasPrice) return 'prices';
    if (has('штрих') && !hasPrice && !hasQty) return 'barcodes';
    if ((has('номенклатура') || has('наименование')) && hasPrice) return 'retail';
    return null;
  }

  const REPORT_LABEL = {
    prices: 'Цены поставщиков и товары',
    stock: 'Остатки и розничные цены',
    sales: 'Продажи за период',
    contacts: 'Контакты поставщиков',
    retail: 'Прайс-лист (розничные цены)',
    photo: 'Фото по ссылкам',
    barcodes: 'Штрихкоды',
  };

  // Загрузка прайс-листа розничных цен: находит товар по артикулу/названию,
  // обновляет розничную цену (+ история), новый — создаёт с группой.
  async function coreUploadRetail(parsed, status) {
    const { recs, fileDate } = parsed;
    status('Создаём группы…');
    const groupMap = await getOrCreateByName('catalog_groups', recs.map((r) => r.group).filter(Boolean), state.groups);
    const byName = new Map(); const byArticle = new Map(); const byId = new Map();
    for (const p of state.products) {
      if (p.name) byName.set(norm(p.name), p.id);
      if (p.article) byArticle.set(norm(p.article), p.id);
      byId.set(p.id, p);
    }
    const at = new Date().toISOString().slice(0, 10);
    // прайс-лист НЕ трогает дату поступления: она только из файла «Цены поставщиков»
    const updates = []; const inserts = []; const hist = []; const seen = new Set();
    for (const r of recs) {
      const pid = (r.article && byArticle.get(norm(r.article))) || byName.get(norm(r.name));
      if (pid) {
        if (seen.has(pid)) continue; // один товар — одна цена за загрузку
        seen.add(pid);
        updates.push({ id: pid, name: r.name, retail_price: r.retail, updated_at: new Date().toISOString() });
        const cur = byId.get(pid);
        const old = cur && cur.retail_price != null && cur.retail_price !== '' ? Number(cur.retail_price) : null;
        if (old == null || old !== Number(r.retail)) hist.push({ product_id: pid, retail_price: r.retail, changed_at: at });
      } else {
        inserts.push({ name: r.name, article: r.article || null, group_id: r.group ? groupMap.get(norm(r.group)) : null, retail_price: r.retail });
      }
    }
    let done = 0; const total = updates.length + inserts.length;
    for (let i = 0; i < updates.length; i += 500) {
      const { error } = await sb.from('catalog_products').upsert(updates.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw error;
      done += Math.min(500, updates.length - i); status(`Обновляем цены… ${done} из ${total}`);
    }
    for (let i = 0; i < inserts.length; i += 400) {
      const { error } = await sb.from('catalog_products').insert(inserts.slice(i, i + 400));
      if (error) throw error;
      done += Math.min(400, inserts.length - i); status(`Добавляем новые товары… ${done} из ${total}`);
    }
    if (hist.length) {
      for (let i = 0; i < hist.length; i += 500) {
        try { await sb.from('catalog_retail_history').upsert(hist.slice(i, i + 500), { onConflict: 'product_id,changed_at' }); }
        catch (e) { break; }
      }
    }
    await refresh({ silent: true });
    renderAll();
    status(`Готово! Розничных цен обновлено: ${updates.length}, новых товаров: ${inserts.length} ✓`);
  }

  /* ── Умный импорт: одна вкладка, каталог сам распознаёт файлы ──
   * Пользователь выбирает любые файлы 1С — программа определяет тип каждого и
   * загружает по очереди (сначала товары/цены, потом продажи/контакты). */
  let smartEntries = [];
  let smartSink = null; // куда перенаправляются сообщения о ходе загрузки

  function smartLog(msg) { const el = $('smartStatus'); if (el) { el.hidden = false; el.textContent = msg; } }

  async function smartPick(files) {
    smartEntries = [];
    $('smartRun').hidden = true;
    if (!files || !files.length) { $('smartList').innerHTML = ''; return; }
    smartLog('Читаем файлы…');
    await loadXlsxLib();
    for (const f of files) {
      const entry = { file: f, name: f.name, type: null, count: 0, error: null, parsed: null, rows: null };
      try {
        const rows = await readSheet(f);
        entry.rows = rows;
        entry.type = detectReportType(rows);
        if (!entry.type) throw new Error('не понял, что это за файл');
        // разбираем сразу — чтобы показать, сколько строк распознано
        if (entry.type === 'prices') { entry.byKey = parsePriceReport(rows); entry.count = entry.byKey.size; }
        else if (entry.type === 'retail') { entry.parsed = parseRetailList(rows); entry.count = entry.parsed.recs.length; }
        else if (entry.type === 'stock') { entry.parsed = parseStockReport(rows); entry.count = entry.parsed.recs.length; }
        else if (entry.type === 'sales') { entry.parsed = parseSalesReport(rows); entry.count = entry.parsed.recs.length; }
        else if (entry.type === 'contacts') { entry.parsed = parseContactsReport(rows); entry.count = entry.parsed.length; }
        else if (entry.type === 'photo') { entry.parsed = parsePhotoSheet(rows); entry.count = entry.parsed.length; }
        else if (entry.type === 'barcodes') { entry.count = 0; }
      } catch (e) { entry.error = e.message || String(e); }
      smartEntries.push(entry);
    }
    // штрихкоды приклеиваем к файлу цен, если он есть
    const priceEntry = smartEntries.find((e) => e.type === 'prices' && e.byKey);
    for (const e of smartEntries) {
      if (e.type === 'barcodes' && priceEntry && e.rows) {
        try { e.count = mergeBarcodesReport(e.rows, priceEntry.byKey); e.mergedInto = priceEntry.name; } catch (er) { e.error = er.message; }
      }
    }
    renderSmartList();
    smartLog('');
    $('smartStatus').hidden = true;
    if (smartEntries.some((e) => e.type && !e.error && !(e.type === 'barcodes' && !e.mergedInto))) $('smartRun').hidden = false;
  }

  function renderSmartList() {
    $('smartList').innerHTML = smartEntries.map((e) => {
      if (e.error) return `<div class="smart-row smart-bad"><b>${esc(e.name)}</b><span>⚠ ${esc(e.error)}</span></div>`;
      const label = REPORT_LABEL[e.type] || e.type;
      const extra = e.mergedInto ? ` → добавятся к «${esc(e.mergedInto)}»` : '';
      return `<div class="smart-row"><b>${esc(e.name)}</b><span>✓ ${esc(label)}: ${e.count} ${extra}<span class="smart-st" data-st="${esc(e.name)}"></span></span></div>`;
    }).join('');
  }

  function setSmartRowStatus(entry, msg) {
    const el = $('smartList').querySelector(`[data-st="${(window.CSS && CSS.escape) ? CSS.escape(entry.name) : entry.name}"]`);
    if (el) el.textContent = ' · ' + msg;
    smartLog(`${entry.name}: ${msg}`);
  }

  async function smartRun() {
    const btn = $('smartRun');
    btn.disabled = true;
    // порядок: сначала товары/цены/остатки/прайс, потом продажи/контакты/фото
    const order = { prices: 1, retail: 2, stock: 3, barcodes: 4, photo: 5, sales: 6, contacts: 7 };
    const todo = smartEntries.filter((e) => e.type && !e.error && !(e.type === 'barcodes'))
      .sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));
    let okCount = 0;
    for (const e of todo) {
      smartSink = (msg) => setSmartRowStatus(e, msg);
      try {
        if (e.type === 'prices') { impParsed = [...e.byKey.values()]; await impUpload(); }
        else if (e.type === 'retail') { await coreUploadRetail(e.parsed, smartSink); }
        else if (e.type === 'stock') { stockParsed = e.parsed; await stockUpload(); }
        else if (e.type === 'sales') { salesParsed = e.parsed; await salesUpload(); }
        else if (e.type === 'contacts') { contactsParsed = e.parsed; await contactsUpload(); }
        else if (e.type === 'photo') { photoExcelParsed = e.parsed; await photoExcelApply(); }
        okCount++;
      } catch (err) { setSmartRowStatus(e, 'ошибка: ' + (err.message || err)); }
      smartSink = null;
    }
    btn.disabled = false;
    btn.hidden = true;
    smartLog(`Готово! Загружено файлов: ${okCount} из ${todo.length}. Каталог обновлён ✓`);
    toast('Импорт завершён ✓');
  }

  function impStatus(msg) {
    if (smartSink) { smartSink(msg); return; }
    const el = $('impStatus');
    el.hidden = false;
    el.textContent = msg;
  }

  async function impParse() {
    const f1 = $('impFile1').files[0];
    if (!f1) { impStatus('Сначала выбери файл 1 — отчёт «Цены поставщиков»'); return; }
    impStatus('Читаем файлы…');
    await loadXlsxLib();
    const byKey = parsePriceReport(await readSheet(f1));
    let extra = 0;
    const f2 = $('impFile2').files[0];
    if (f2) extra = mergeBarcodesReport(await readSheet(f2), byKey);
    const items = [...byKey.values()];
    const groups = new Set(items.map((i) => i.group).filter(Boolean));
    const sups = new Set();
    items.forEach((i) => i.suppliers.forEach((s) => sups.add(s)));
    const withBc = items.filter((i) => i.barcodes.size).length;
    const priceCnt = items.reduce((n, i) => n + i.prices.size, 0);
    const retailCnt = items.filter((i) => i.retail != null).length;
    impParsed = items;
    // предупреждаем, если в файле не нашлось ни одной цены — иначе в карточках
    // товара не будет цен, и это выглядит как «поломка»
    const priceWarn = priceCnt === 0
      ? '⚠ ЦЕНЫ НЕ НАЙДЕНЫ. В карточках товара цены не появятся. Проверь, что в файле есть колонки «Поставщик/Контрагент» и «Цена» в одной строке с товаром. '
      : '';
    impStatus(`${priceWarn}Найдено: ${items.length} товаров, ${groups.size} групп, ${sups.size} поставщиков, ${priceCnt} закупочных цен, ${retailCnt} розничных цен. `
      + `Со штрихкодами: ${withBc}${extra ? ` (+${extra} штрихкодов из файла 2)` : ''}. `
      + 'Проверь цифры и нажми кнопку ещё раз — начнётся загрузка.');
    $('impRun').textContent = `⬆ Загрузить ${items.length} товаров в каталог`;
  }

  async function getOrCreateByName(table, names, existing) {
    const map = new Map(existing.map((x) => [norm(x.name), x.id]));
    const missing = [...new Set(names.filter((n) => !map.has(norm(n))))];
    for (let i = 0; i < missing.length; i += 500) {
      const chunk = missing.slice(i, i + 500).map((name) => ({ name }));
      const { data, error } = await sb.from(table).insert(chunk).select();
      if (error) throw error;
      data.forEach((x) => map.set(norm(x.name), x.id));
    }
    return map;
  }

  async function impUpload() {
    const items = impParsed;
    const btn = $('impRun');
    btn.disabled = true;
    try {
      impStatus('Создаём группы и поставщиков…');
      const groupMap = await getOrCreateByName('catalog_groups',
        items.map((i) => i.group).filter(Boolean), state.groups);
      const supMap = await getOrCreateByName('catalog_suppliers',
        items.flatMap((i) => [...i.suppliers]), state.suppliers);

      // существующие товары — чтобы товары БЕЗ кода находить по штрихкоду/названию
      // и ОБНОВЛЯТЬ, а не вставлять заново (иначе повторный импорт двоит каталог)
      const exByBarcode = new Map();
      const exByName = new Map();
      for (const p of state.products) {
        for (const b of (p.barcodes || [])) if (b) exByBarcode.set(String(b).trim(), p.id);
        if (p.name) exByName.set(norm(p.name), p.id);
      }
      const findExisting = (i) => {
        for (const b of i.barcodes) { const id = exByBarcode.get(String(b).trim()); if (id) return id; }
        return exByName.get(norm(i.name)) || null;
      };

      const today = new Date().toISOString().slice(0, 10);
      const AC = arrivalColExists();
      const withCode = [];
      const noCodeUpdate = []; // товары без кода, найденные в базе → обновляем по id
      const noCodeInsert = [];
      const noCodeInsertItems = [];
      for (const i of items) {
        // дата поступления = самая свежая дата из колонки «Период» файла цен (иначе — день импорта)
        let arrival = null;
        for (const [, pr] of i.prices) if (pr.date && (!arrival || pr.date > arrival)) arrival = pr.date;
        const base = {
          name: i.name,
          article: i.article,
          group_id: i.group ? groupMap.get(norm(i.group)) : null,
          supplier_ids: [...i.suppliers].map((s) => supMap.get(norm(s))).filter(Boolean),
          barcodes: [...i.barcodes],
          is_weighted: i.weighted,
          unit: i.unit,
          updated_at: new Date().toISOString(),
          ...(AC ? { arrival_at: arrival || today } : {}),
          // розничную цену пишем только если она есть в файле — иначе не затираем прежнюю
          ...(i.retail != null ? { retail_price: i.retail } : {}),
        };
        if (i.code) { withCode.push({ ...base, code: i.code }); continue; }
        const exId = findExisting(i);
        if (exId) { noCodeUpdate.push({ ...base, id: exId }); i._id = exId; } // код НЕ трогаем — вдруг товар уже с кодом
        else { noCodeInsert.push(base); noCodeInsertItems.push(i); }
      }

      const idByCode = new Map(); // код товара → id в базе (для загрузки цен)
      let done = 0;
      const total = withCode.length + noCodeUpdate.length + noCodeInsert.length;
      for (let i = 0; i < withCode.length; i += 400) {
        const { data, error } = await sb.from('catalog_products')
          .upsert(withCode.slice(i, i + 400), { onConflict: 'code' })
          .select('id,code');
        if (error) throw error;
        for (const row of data) idByCode.set(row.code, row.id);
        done += Math.min(400, withCode.length - i);
        impStatus(`Загружаем товары… ${done} из ${total}`);
      }
      // найденные без кода — обновляем по id (не плодим дубли)
      for (let i = 0; i < noCodeUpdate.length; i += 400) {
        const { error } = await sb.from('catalog_products')
          .upsert(noCodeUpdate.slice(i, i + 400), { onConflict: 'id' });
        if (error) throw error;
        done += Math.min(400, noCodeUpdate.length - i);
        impStatus(`Загружаем товары… ${done} из ${total}`);
      }
      // действительно новые без кода — вставляем
      for (let i = 0; i < noCodeInsert.length; i += 400) {
        const chunk = noCodeInsert.slice(i, i + 400);
        const { data, error } = await sb.from('catalog_products').insert(chunk).select('id');
        if (error) throw error;
        data.forEach((row, j) => { noCodeInsertItems[i + j]._id = row.id; });
        done += Math.min(400, noCodeInsert.length - i);
        impStatus(`Загружаем товары… ${done} из ${total}`);
      }

      // цены поставщиков: дата = последнее поступление из файла (нет колонки даты — день импорта)
      const priceRows = [];
      for (const i of items) {
        const pid = i.code ? idByCode.get(i.code) : i._id;
        if (!pid) continue;
        for (const [supName, pr] of i.prices) {
          const sid = supMap.get(norm(supName));
          if (sid) priceRows.push({ product_id: pid, supplier_id: sid, price: pr.price, price_date: pr.date || today });
        }
      }
      // база пишет только новые и изменившиеся цены — одинаковые не плодят строк
      let pricesSaved = 0;
      let pricesChanged = 0;
      let pricesError = null;
      let smartSave = true;
      for (let i = 0; i < priceRows.length; i += 500) {
        const chunk = priceRows.slice(i, i + 500);
        if (smartSave) {
          const { data, error } = await sb.rpc('catalog_save_prices', { p_rows: chunk });
          if (error && /catalog_save_prices/.test(error.message || '')) {
            smartSave = false; // база без ОБНОВЛЕНИЯ-4 — пишем по-старому
            i -= 500;
            continue;
          }
          if (error) { pricesError = error; break; }
          pricesChanged += data || 0;
        } else {
          const { error } = await sb.from('catalog_prices')
            .upsert(chunk, { onConflict: 'product_id,supplier_id,price_date' });
          if (error) { pricesError = error; break; }
          pricesChanged += chunk.length;
        }
        pricesSaved += chunk.length;
        impStatus(`Сохраняем цены… ${pricesSaved} из ${priceRows.length}`);
      }

      impStatus('Обновляем каталог…');
      await refresh({ silent: true });
      renderAll();
      if (pricesError) {
        impStatus(`Товары загружены (${total} ✓), но цены сохранить не удалось: ${pricesError.message}. `
          + 'Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-2.sql в SQL Editor и повтори импорт.');
      } else {
        const priceNote = priceRows.length
          ? ` Цены: изменилось ${pricesChanged} из ${priceRows.length} (одинаковые не записываются — база не растёт зря).`
          : '';
        impStatus(`Готово! Загружено ${total} товаров ✓${priceNote} Можно закрыть окно.`);
      }
      toast('Импорт завершён ✓');
      await autoDedup(); // тихо убрать дубли, если вдруг появились
      setTimeout(autoPhotoSearch, 1500); // сразу дотянуть фото для новых товаров
      impParsed = null;
      btn.textContent = 'Проверить файлы';
    } catch (err) {
      impStatus('Ошибка: ' + (err.message || err) + '. Если база ещё старой версии — выполни setup/ОБНОВЛЕНИЕ-1.sql в SQL Editor и повтори.');
      impParsed = null;
      btn.textContent = 'Проверить файлы';
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Поиск фото по штрихкодам ─────────────────────
   * Открытая всемирная база Open Food Facts (+ Open Beauty Facts для химии
   * и косметики): по штрихкоду отдаёт фото товара. Находятся в основном
   * известные бренды. Найденное фото сжимается и сохраняется в НАШЕ
   * хранилище — дальше работает как обычное фото товара, в т.ч. офлайн. */

  const PHOTO_CHECKED_KEY = 'wm_photo_checked_v2'; // товары (id), по которым фото уже искали и не нашли
  let photoSearchRunning = false;

  // товары без фото: ищем и тем, у кого есть штрихкод, и тем, у кого только название
  const photoCandidates = () =>
    state.products.filter((p) => !hasPhoto(p) && (p.name || (p.barcodes || []).length));

  // Открытые бесплатные базы с фото товаров (еда, косметика/бытовая химия,
  // корма, прочие товары). Легально, фото под открытой лицензией.
  const PHOTO_HOSTS = [
    'world.openfoodfacts.org',
    'world.openbeautyfacts.org',
    'world.openproductsfacts.org',
    'world.openpetfoodfacts.org',
  ];
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // поиск фото по штрихкоду
  async function offByBarcode(bc) {
    for (const host of PHOTO_HOSTS) {
      try {
        const r = await fetch(`https://${host}/api/v2/product/${encodeURIComponent(bc)}.json?fields=image_front_url`);
        if (r.ok) {
          const d = await r.json();
          const url = d.product && d.product.image_front_url;
          if (url) return url;
        }
      } catch (e) { /* сеть моргнула — товар проверим в следующий раз */ }
      await sleep(350); // вежливый темп к бесплатной базе
    }
    return null;
  }

  // фото похоже на наш товар? (защита от чужой картинки — лучше без фото, чем не то)
  function photoNameMatches(ours, theirs) {
    if (!theirs) return false;
    const a = norm(ours).replace(/[^0-9a-zа-я ]/g, ' ').replace(/\s+/g, ' ').trim();
    const b = norm(theirs).replace(/[^0-9a-zа-я ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!a || !b) return false;
    const sim = dice(bigrams(a.replace(/\s+/g, '')), bigrams(b.replace(/\s+/g, '')));
    if (sim >= 0.5) return true;
    // либо совпало значимое слово (бренд/название) длиной от 4 букв
    const bw = new Set(b.split(' ').filter((w) => w.length >= 4));
    return a.split(' ').some((w) => w.length >= 4 && bw.has(w));
  }

  // поиск фото по названию (для товаров без штрихкода или если по штрихкоду не нашли).
  // Берём фото, только если найденное название реально похоже на наше.
  async function offByName(name) {
    const q = norm(name).replace(/[^0-9a-zа-я ]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 3) return null;
    for (const host of PHOTO_HOSTS) {
      try {
        const url = `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}`
          + '&search_simple=1&action=process&json=1&page_size=5&fields=product_name,image_front_url';
        const r = await fetch(url);
        if (r.ok) {
          const d = await r.json();
          for (const prod of (d.products || [])) {
            if (prod.image_front_url && photoNameMatches(name, prod.product_name)) return prod.image_front_url;
          }
        }
      } catch (e) { /* пропускаем источник */ }
      await sleep(500);
    }
    return null;
  }

  // фото товара: сперва по штрихкодам, потом по названию
  async function findProductPhoto(p) {
    for (const bc of (p.barcodes || [])) {
      if (!bc) continue;
      const u = await offByBarcode(bc);
      if (u) return u;
    }
    if (p.name) return offByName(p.name);
    return null;
  }

  // совместимость со старым вызовом (в карточке «Найти фото»): по штрихкоду
  async function offLookup(bc) { return offByBarcode(bc); }

  async function attachFoundPhoto(p, url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('фото недоступно');
    const small = await compressImage(await resp.blob(), 800, 0.8);
    const photos = [await uploadPhoto(small)];
    const { error } = await sb.from('catalog_products')
      .update({ photos, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) throw error;
    p.photos = photos;
  }

  // владелец (личный аккаунт), а не общий аккаунт сотрудников — только он тянет фото автоматически
  // фоновые задачи (автопоиск фото, автодедуп) меняют каталог → только у админа.
  // Раньше «владелец» = любой не-staff аккаунт; с ролями это уже неверно
  // (аналитик — тоже не staff, но менять каталог не может), поэтому проверяем admin.
  const isOwner = () => !!(state.session && state.isAdmin);

  /* Автопоиск фото: приложение САМО ищет фото товаров без картинок в фоне,
   * пока владелец в приложении. Продолжается после каждого импорта и между
   * заходами (проверенные штрихкоды запоминаются). Тихо, без кнопок. */
  async function autoPhotoSearch() {
    if (!sb || !isOwner() || photoSearchRunning || document.hidden || !navigator.onLine) return;
    let checked = {};
    try { checked = JSON.parse(localStorage.getItem(PHOTO_CHECKED_KEY)) || {}; } catch (e) { /* пусто */ }
    const todo = photoCandidates().filter((p) => !checked[p.id]);
    if (!todo.length) return;
    photoSearchRunning = true;
    const save = () => { try { localStorage.setItem(PHOTO_CHECKED_KEY, JSON.stringify(checked)); } catch (e) { /* некритично */ } };
    toast(`🔎 Ищу фото товаров в фоне (${todo.length})…`);
    let done = 0;
    let found = 0;
    for (const p of todo) {
      if (!isOwner() || document.hidden || !navigator.onLine) break; // тихо приостановиться
      try {
        const url = await findProductPhoto(p);
        if (url) { await attachFoundPhoto(p, url); found++; if (found % 6 === 0) { saveCache(); renderGrid(); } }
        else checked[p.id] = 1;
      } catch (e) { /* пропускаем товар */ }
      done++;
      if (done % 15 === 0) save();
    }
    save();
    photoSearchRunning = false;
    if (found) { saveCache(); renderGrid(); toast(`Добавлено фото: ${found} ✓`); }
  }

  /* Дубли товаров: оставляем один на «имя + штрихкоды», приоритет строке с кодом
   * кассы, затем самой ранней. Работает и как ручная кнопка, и автоматически
   * (после импорта, при входе владельца) — тогда без вопросов. */
  let dedupRunning = false;

  function findDuplicateIds() {
    const groups = new Map();
    for (const p of state.products) {
      const key = norm(p.name) + '|' + JSON.stringify(p.barcodes || []);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const toDelete = [];
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => {
        if (!!a.code !== !!b.code) return a.code ? -1 : 1;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      });
      for (let i = 1; i < arr.length; i++) toDelete.push(arr[i].id);
    }
    return toDelete;
  }

  async function runDedup(toDelete, { silent } = {}) {
    if (dedupRunning || !toDelete.length || !sb || !isOwner()) return;
    dedupRunning = true;
    const btn = $('menuDedup');
    if (btn) btn.disabled = true;
    if (!silent) toast(`Убираю дубли: ${toDelete.length}…`);
    try {
      let done = 0;
      for (let i = 0; i < toDelete.length; i += 200) {
        const batch = toDelete.slice(i, i + 200);
        const { error } = await sb.from('catalog_products').delete().in('id', batch);
        if (error) throw error;
        done += batch.length;
        if (btn) btn.textContent = `Убираю дубли… ${done} из ${toDelete.length}`;
      }
      const del = new Set(toDelete);
      state.products = state.products.filter((p) => !del.has(p.id));
      buildIndex(); saveCache(); renderAll();
      toast(`Убрано дублей: ${toDelete.length} ✓`);
    } catch (e) {
      if (!silent) toast('Ошибка: ' + (e.message || e));
    } finally {
      dedupRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = '🧹 Убрать дубли товаров'; }
    }
  }

  function dedupProducts() { // ручная кнопка
    const ids = findDuplicateIds();
    if (!ids.length) { toast('Дублей не найдено ✓'); return; }
    if (confirm(`Найдено дублей: ${ids.length}. Убрать их? Останется по одному товару.`)) runDedup(ids, { silent: false });
  }

  async function autoDedup() { // тихо, само (после импорта, при входе владельца)
    if (!isOwner()) return;
    const ids = findDuplicateIds();
    if (ids.length) await runDedup(ids, { silent: true });
  }

  async function runPhotoSearch() {
    const btn = $('photoSearchRun');
    if (photoSearchRunning) { photoSearchRunning = false; return; }
    photoSearchRunning = true;
    btn.textContent = '⏸ Остановить';
    let checked = {};
    try { checked = JSON.parse(localStorage.getItem(PHOTO_CHECKED_KEY)) || {}; } catch (e) { /* пусто */ }
    const saveChecked = () => { try { localStorage.setItem(PHOTO_CHECKED_KEY, JSON.stringify(checked)); } catch (e) { /* некритично */ } };
    const todo = photoCandidates().filter((p) => !checked[p.id]);
    const status = (msg) => { const el = $('photoSearchStatus'); el.hidden = false; el.textContent = msg; };
    let done = 0;
    let found = 0;
    status(`Будем проверять: ${todo.length} товаров без фото (по штрихкоду и названию)`);
    for (const p of todo) {
      if (!photoSearchRunning || $('photoSearchSheet').hidden) break;
      try {
        const url = await findProductPhoto(p);
        if (url) { await attachFoundPhoto(p, url); found++; }
        else checked[p.id] = 1;
      } catch (e) { /* пропускаем товар, идём дальше */ }
      done++;
      if (done % 10 === 0) saveChecked();
      status(`Проверено ${done} из ${todo.length} · найдено фото: ${found}`);
    }
    saveChecked();
    photoSearchRunning = false;
    const finished = done >= todo.length;
    btn.textContent = finished ? '▶ Проверить снова' : '▶ Продолжить поиск';
    status(`${finished ? 'Готово!' : 'Пауза.'} Проверено ${done} из ${todo.length} · найдено фото: ${found}`);
    if (found) {
      saveCache();
      renderGrid();
      toast(`Фото найдены и сохранены: ${found} ✓`);
    }
  }

  /* ── Фото из Excel по ссылкам ─────────────────────
   * Excel: колонка со ссылкой на фото + колонка со штрихкодом / кодом / названием.
   * Находим товар (штрихкод → код → точное название) и ставим ему это фото по
   * ссылке (внешний адрес, ничего не перезаливаем). */

  let photoExcelParsed = null;

  // ищем колонки в любом Excel: фото/ссылка + штрихкод/код/название
  function parsePhotoSheet(rows) {
    let header = -1;
    let cols = {};
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const labels = rows[r].map((v) => cellStr(v).toLowerCase());
      const c = {};
      labels.forEach((l, i) => {
        if (!l) return;
        if (/фото|ссылк|url|изображ|картинк|photo|image|link/.test(l)) c.url ??= i;
        else if (/штрих|barcode|ean/.test(l)) c.barcode ??= i;
        else if (/код товара|код кассы|номенклатура\.код/.test(l)) c.code = i;
        else if (/^код$|\bкод\b/.test(l) && c.code === undefined) c.code = i;
        else if (/наимен|номенклатур|товар|название|name/.test(l)) c.name ??= i;
      });
      if (c.url !== undefined && (c.barcode !== undefined || c.code !== undefined || c.name !== undefined)) {
        header = r; cols = c; break;
      }
    }
    if (header < 0) throw new Error('Не нашёл в файле колонку со ссылкой на фото и колонку со штрихкодом/кодом/названием');
    const out = [];
    for (let r = header + 1; r < rows.length; r++) {
      const row = rows[r];
      const url = cols.url !== undefined ? cellStr(row[cols.url]) : '';
      if (!/^https?:\/\//i.test(url)) continue; // только настоящие ссылки
      out.push({
        url,
        barcode: cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '',
        code: cols.code !== undefined ? cellStr(row[cols.code]) : '',
        name: cols.name !== undefined ? cellStr(row[cols.name]) : '',
      });
    }
    return out;
  }

  // сопоставляем строки с товарами: штрихкод → код → точное название
  function matchPhotoRows(recs) {
    const byBarcode = new Map();
    const byCode = new Map();
    const byName = new Map();
    for (const p of state.products) {
      for (const b of (p.barcodes || [])) byBarcode.set(String(b).trim(), p);
      if (p.code) byCode.set(String(p.code).trim(), p);
      byName.set(norm(p.name), p);
    }
    const updates = new Map(); // product.id → url (последняя ссылка выигрывает)
    let unmatched = 0;
    for (const r of recs) {
      const p = (r.barcode && byBarcode.get(r.barcode.trim()))
        || (r.code && byCode.get(r.code.trim()))
        || (r.name && byName.get(norm(r.name)));
      if (p) updates.set(p.id, r.url);
      else unmatched++;
    }
    return { updates, unmatched };
  }

  function photoExcelStatus(msg) { if (smartSink) { smartSink(msg); return; } const el = $('photoExcelStatus'); el.hidden = false; el.textContent = msg; }

  async function photoExcelParse() {
    const f = $('photoExcelFile').files[0];
    if (!f) { photoExcelStatus('Сначала выбери файл Excel'); return; }
    photoExcelStatus('Читаем файл…');
    await loadXlsxLib();
    const recs = parsePhotoSheet(await readSheet(f));
    if (!recs.length) { photoExcelParsed = null; photoExcelStatus('В файле не нашлось строк со ссылками на фото (ссылка должна начинаться с http)'); return; }
    const { updates, unmatched } = matchPhotoRows(recs);
    photoExcelParsed = updates;
    photoExcelStatus(`Ссылок в файле: ${recs.length}. Совпало с товарами: ${updates.size}`
      + (unmatched ? `, не нашлось: ${unmatched}` : '')
      + '. Нажми кнопку ещё раз — покажем фото у этих товаров.');
    $('photoExcelRun').textContent = `🖼 Показать фото у ${updates.size} товаров`;
  }

  async function photoExcelApply() {
    const updates = photoExcelParsed;
    const btn = $('photoExcelRun');
    btn.disabled = true;
    try {
      const entries = [...updates.entries()];
      let done = 0;
      for (let i = 0; i < entries.length; i += 200) {
        const chunk = entries.slice(i, i + 200);
        // по одному апдейту — у каждого товара свой url; шлём параллельно пачкой
        await Promise.all(chunk.map(([id, url]) =>
          sb.from('catalog_products').update({ photos: [url], updated_at: new Date().toISOString() }).eq('id', id)
            .then(({ error }) => {
              if (error) throw error;
              const p = state.products.find((x) => x.id === id);
              if (p) p.photos = [url];
            })));
        done += chunk.length;
        photoExcelStatus(`Сохраняем… ${done} из ${entries.length}`);
      }
      saveCache();
      renderGrid();
      photoExcelStatus(`Готово! Фото показаны у ${entries.length} товаров ✓`);
      toast('Фото из Excel добавлены ✓');
      photoExcelParsed = null;
      btn.textContent = 'Проверить файл';
    } catch (err) {
      photoExcelStatus('Ошибка: ' + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Импорт продаж из 1С ──────────────────────────
   * Отчёт «Продажи»: товар + количество (+ сумма, + дата/период, если есть).
   * Есть колонка даты — продажи раскладываются по дням из файла;
   * нет — все строки записываются на дату, выбранную админом. */

  let salesParsed = null;

  // дата из ячейки Excel: число-«серийник» или строка «01.07.2026»
  function parseDateCell(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
    }
    const s = String(v);
    let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = s.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }

  // период отчёта: ищем в верхних строках текст «Период: 01.06.2026 - 12.07.2026»
  function parseReportPeriod(rows) {
    for (let r = 0; r < Math.min(rows.length, 14); r++) {
      for (const cell of (rows[r] || [])) {
        const s = String(cell ?? '');
        if (/период/i.test(s)) {
          const ds = s.match(/\d{1,2}\.\d{1,2}\.\d{2,4}/g);
          if (ds && ds.length >= 2) return [parseDateCell(ds[0]), parseDateCell(ds[1])];
          if (ds && ds.length === 1) return [parseDateCell(ds[0]), parseDateCell(ds[0])];
        }
      }
    }
    return [null, null];
  }

  // Отчёт «Продажи» из 1С обычно агрегирован ЗА ПЕРИОД (в шапке «Период: …»),
  // без разбивки по дням, и товары в нём — по названию (кода/штрихкода нет).
  function parseSalesReport(rows) {
    const det = detectColumns(rows);
    if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура…) в отчёте');
    const { cols, dataStart } = det;
    if (cols.qty === undefined) throw new Error('Не нашёл колонку «Количество» — выгрузи отчёт «Продажи» с количеством');
    const [periodFrom, periodTo] = parseReportPeriod(rows);
    const recs = new Map(); // товар (по коду или названию) → количество и сумма за период
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const name = cellStr(row[cols.name]);
      if (!name) continue;
      if (/^\s*(итого|всего|total)/i.test(name)) continue; // строки-итоги пропускаем
      const qty = parsePriceNum(row[cols.qty]);
      if (qty == null) continue; // итоговые и пустые строки
      const code = cols.code !== undefined ? cellStr(row[cols.code]) : '';
      const amount = cols.amount !== undefined ? parsePriceNum(row[cols.amount]) : null;
      const key = code || norm(name);
      let rec = recs.get(key);
      if (!rec) { rec = { code: code || null, name, qty: 0, amount: 0, hasAmount: false }; recs.set(key, rec); }
      rec.qty += qty;
      if (amount != null) { rec.amount += amount; rec.hasAmount = true; }
    }
    return { recs: [...recs.values()], periodFrom, periodTo, hasPeriod: !!(periodFrom && periodTo) };
  }

  function salesStatus(msg) {
    if (smartSink) { smartSink(msg); return; }
    const el = $('salesStatus');
    el.hidden = false;
    el.textContent = msg;
  }

  async function salesParse() {
    const f = $('salesFile').files[0];
    if (!f) { salesStatus('Сначала выбери файл — отчёт «Продажи» из 1С'); return; }
    salesStatus('Читаем файл…');
    await loadXlsxLib();
    salesParsed = parseSalesReport(await readSheet(f));
    const { recs, periodFrom, periodTo, hasPeriod } = salesParsed;
    if (!recs.length) { salesParsed = null; salesStatus('В файле не нашлось строк с продажами'); return; }
    const when = hasPeriod
      ? `Период из файла: ${fmtDate(periodFrom)} — ${fmtDate(periodTo)}.`
      : `Периода в файле не нашёл — укажи даты периода ниже (с / по).`;
    salesStatus(`Найдено товаров с продажами: ${recs.length}. ${when} `
      + 'Проверь и нажми кнопку ещё раз — начнётся загрузка.');
    $('salesRun').textContent = `⬆ Загрузить продажи (${recs.length})`;
  }

  async function salesUpload() {
    const { recs, hasPeriod } = salesParsed;
    const btn = $('salesRun');
    btn.disabled = true;
    try {
      // период: из файла, иначе из полей «с»/«по» (или сегодня)
      const today = new Date().toISOString().slice(0, 10);
      const periodFrom = hasPeriod ? salesParsed.periodFrom : ($('salesFrom').value || today);
      const periodTo = hasPeriod ? salesParsed.periodTo : ($('salesTo').value || $('salesFrom').value || today);
      const byCode = new Map();
      const byName = new Map();
      for (const p of state.products) {
        if (p.code) byCode.set(p.code, p.id);
        byName.set(norm(p.name), p.id);
      }
      const out = new Map(); // товар в базе → продажи за период
      let unmatched = 0;
      for (const r of recs) {
        const pid = (r.code && byCode.get(r.code)) || byName.get(norm(r.name));
        if (!pid) { unmatched++; continue; }
        let row = out.get(pid);
        if (!row) { row = { product_id: pid, period_from: periodFrom, period_to: periodTo, qty: 0, amount: null }; out.set(pid, row); }
        row.qty += r.qty;
        if (r.hasAmount) row.amount = (row.amount || 0) + r.amount;
      }
      const list = [...out.values()];
      if (!list.length) throw new Error('Ни один товар из отчёта не найден в каталоге по названию. Сначала сделай импорт товаров тем же файлом «Цены поставщиков».');
      let done = 0;
      for (let i = 0; i < list.length; i += 500) {
        const { error } = await sb.from('catalog_sales')
          .upsert(list.slice(i, i + 500), { onConflict: 'product_id,period_from,period_to' });
        if (error) throw error;
        done += Math.min(500, list.length - i);
        salesStatus(`Сохраняем продажи… ${done} из ${list.length}`);
      }
      salesStatus(`Готово! Продажи за ${fmtDate(periodFrom)}–${fmtDate(periodTo)} сохранены: ${list.length} товаров ✓`
        + (unmatched ? ` Не нашлось по названию: ${unmatched}.` : '')
        + ' Смотри «🔥 Ходовые товары».');
      toast('Продажи загружены ✓');
      salesParsed = null;
      btn.textContent = 'Проверить файл';
    } catch (err) {
      salesStatus('Ошибка: ' + (err.message || err)
        + '. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-3.sql в SQL Editor и повтори.');
      salesParsed = null;
      btn.textContent = 'Проверить файл';
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Импорт контактов поставщиков из 1С ───────────
   * Справочник «Контрагенты»: колонка «Контрагент» (название) + колонка с
   * телефоном. Поставщик находится по названию (нет — создаётся), телефон
   * обновляется. Так контакты накапливаются: повторная загрузка обновит. */

  let contactsParsed = null;

  function parseContactsReport(rows) {
    let nameCol = -1; let phoneCol = -1; let dataStart = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const cells = (rows[r] || []).map((v) => cellStr(v).toLowerCase());
      let nc = -1; let pc = -1;
      cells.forEach((l, c) => {
        if (nc < 0 && l === 'контрагент') nc = c;
        if (pc < 0 && l.includes('телефон')) pc = c;
      });
      if (nc >= 0 && pc >= 0) { nameCol = nc; phoneCol = pc; dataStart = r + 1; break; }
    }
    if (dataStart < 0) throw new Error('Не нашёл колонки «Контрагент» и «Номер телефона» в файле');
    const byName = new Map();
    for (let r = dataStart; r < rows.length; r++) {
      const name = cellStr(rows[r][nameCol]).trim();
      if (!name) continue;
      const phone = cellStr(rows[r][phoneCol]).replace(/[^\d+]/g, '');
      const prev = byName.get(norm(name));
      // при повторах оставляем запись с телефоном
      if (!prev || (!prev.phone && phone)) byName.set(norm(name), { name, phone });
    }
    return [...byName.values()];
  }

  async function contactsParse() {
    const f = $('contactsFile').files[0];
    if (!f) { contactsStatus('Сначала выбери файл — контакты из 1С'); return; }
    contactsStatus('Читаем файл…');
    await loadXlsxLib();
    contactsParsed = parseContactsReport(await readSheet(f));
    const withPhone = contactsParsed.filter((c) => c.phone).length;
    if (!contactsParsed.length) { contactsParsed = null; contactsStatus('В файле не нашлось контрагентов'); return; }
    contactsStatus(`Найдено контрагентов: ${contactsParsed.length}, из них с телефоном: ${withPhone}. `
      + 'Проверь и нажми кнопку ещё раз — начнётся загрузка (новые поставщики создадутся, телефоны обновятся).');
    $('contactsRun').textContent = `⬆ Загрузить контакты (${withPhone})`;
  }

  function contactsStatus(msg) { if (smartSink) { smartSink(msg); return; } const el = $('contactsStatus'); el.hidden = false; el.textContent = msg; }

  async function contactsUpload() {
    const list = contactsParsed;
    const btn = $('contactsRun');
    btn.disabled = true;
    try {
      contactsStatus('Создаём поставщиков…');
      // создаём/находим всех поставщиков из файла (новые появятся в каталоге)
      const supMap = await getOrCreateByName('catalog_suppliers', list.map((c) => c.name), state.suppliers);
      const records = [];
      for (const c of list) {
        if (!c.phone) continue;
        const sid = supMap.get(norm(c.name));
        if (sid) records.push({ supplier_id: sid, phone: c.phone, updated_at: new Date().toISOString() });
      }
      let saved = 0;
      for (let i = 0; i < records.length; i += 500) {
        const { error } = await sb.from('catalog_supplier_contacts')
          .upsert(records.slice(i, i + 500), { onConflict: 'supplier_id' });
        if (error) throw error;
        saved += Math.min(500, records.length - i);
        contactsStatus(`Сохраняем контакты… ${saved} из ${records.length}`);
      }
      await refresh({ silent: true });
      if (state.canPurchase) await loadContacts();
      renderAll();
      contactsStatus(`Готово! Поставщиков в файле: ${list.length}, телефонов сохранено: ${records.length} ✓`);
      toast('Контакты загружены ✓');
      contactsParsed = null;
      btn.textContent = 'Проверить файл';
    } catch (err) {
      contactsStatus('Ошибка: ' + (err.message || err)
        + '. Если база старой версии — выполни setup/ВСЕ-ОБНОВЛЕНИЯ.sql в SQL Editor.');
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Импорт остатков из 1С (отчёт «Остатки номенклатуры») ──
   * Многострочная шапка. Берём: название, код, штрихкод, группа, ед.,
   * количество (остаток), розничная цена. Товар находится по коду/штрихкоду/
   * названию — обновляется остаток и розничная цена; нет — создаётся. */

  let stockParsed = null;

  // число из ячейки 1С: убираем разделители тысяч (запятые) и пробелы
  // как parsePriceNum, но допускает 0 и отрицательные (остаток бывает минусовым)
  function stockNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/\s/g, '');
    const neg = s.startsWith('-');
    s = s.replace(/^-/, '');
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const p = s.split(',');
      s = (p.length === 2 && p[1].length === 3 && /^\d+$/.test(p[0]) && Number(p[0]) !== 0)
        ? s.replace(',', '') : s.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  }

  function parseStockReport(rows) {
    const cols = {};
    let stockAt = null;
    for (let r = 0; r < Math.min(rows.length, 16); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const l = cellStr(row[c]).toLowerCase();
        if (!l) continue;
        if (cols.name === undefined && (l === 'номенклатура' || l === 'наименование' || l === 'название')) cols.name = c;
        else if (cols.code === undefined && (l.includes('код товара') || l === 'номенклатура.код')) cols.code = c;
        else if (cols.barcode === undefined && (l.includes('штрихкод') || l.includes('штрих-код'))) cols.barcode = c;
        else if (cols.group === undefined && (l.includes('группа товара') || l.includes('входит в группу'))) cols.group = c;
        else if (cols.unit === undefined && l.includes('базовая единица')) cols.unit = c;
        else if (cols.stock === undefined && l === 'количество') cols.stock = c;
        else if (cols.retail === undefined && l.includes('розничная цена')) cols.retail = c;
      }
      const line = row.map((v) => cellStr(v)).join(' ');
      const m = line.match(/на конец дня:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i) || line.match(/на дату:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i);
      if (m && !stockAt) stockAt = parseDateCell(m[1]);
    }
    if (cols.name === undefined) throw new Error('Не нашёл колонку «Номенклатура» в отчёте «Остатки»');
    if (cols.stock === undefined) throw new Error('Не нашёл колонку «Количество» — нужен отчёт «Остатки номенклатуры»');
    const codeStr = (v) => cellStr(v).replace(/[\s ,]/g, ''); // код: убрать разделители тысяч
    const recs = [];
    for (let r = 0; r < rows.length; r++) {
      const name = cellStr(rows[r][cols.name]);
      if (!name) continue;
      const code = cols.code !== undefined ? codeStr(rows[r][cols.code]) : '';
      const barcode = cols.barcode !== undefined ? cellStr(rows[r][cols.barcode]).replace(/\s/g, '') : '';
      if (!code && !barcode) continue; // строки склада/итогов — пропускаем
      const retail = cols.retail !== undefined ? stockNum(rows[r][cols.retail]) : null;
      recs.push({
        name, code: code || null, barcode: barcode || null,
        group: cols.group !== undefined ? cellStr(rows[r][cols.group]) : '',
        unit: cols.unit !== undefined ? cellStr(rows[r][cols.unit]).toLowerCase() : '',
        stock: stockNum(rows[r][cols.stock]) || 0,
        retail: retail != null && retail > 0 ? retail : null,
      });
    }
    return { recs, stockAt };
  }

  function stockStatus(msg) { if (smartSink) { smartSink(msg); return; } const el = $('stockStatus'); el.hidden = false; el.textContent = msg; }

  async function stockParse() {
    const f = $('stockFile').files[0];
    if (!f) { stockStatus('Сначала выбери файл — отчёт «Остатки номенклатуры»'); return; }
    stockStatus('Читаем файл…');
    await loadXlsxLib();
    stockParsed = parseStockReport(await readSheet(f));
    const { recs, stockAt } = stockParsed;
    if (!recs.length) { stockParsed = null; stockStatus('В файле не нашлось товаров с остатками'); return; }
    const withRetail = recs.filter((r) => r.retail != null).length;
    stockStatus(`Найдено товаров: ${recs.length}${stockAt ? `, остатки на ${fmtDate(stockAt)}` : ''}, розничных цен: ${withRetail}. `
      + 'Проверь и нажми кнопку ещё раз — начнётся загрузка (остаток обновится, новые товары создадутся).');
    $('stockRun').textContent = `⬆ Загрузить остатки (${recs.length})`;
  }

  async function stockUpload() {
    const { recs, stockAt } = stockParsed;
    const btn = $('stockRun');
    btn.disabled = true;
    try {
      stockStatus('Создаём группы…');
      const groupMap = await getOrCreateByName('catalog_groups', recs.map((r) => r.group).filter(Boolean), state.groups);
      const byCode = new Map(); const byBarcode = new Map(); const byName = new Map();
      for (const p of state.products) {
        if (p.code) byCode.set(p.code, p.id);
        for (const b of (p.barcodes || [])) if (b) byBarcode.set(String(b).trim(), p.id);
        if (p.name) byName.set(norm(p.name), p.id);
      }
      const at = stockAt || new Date().toISOString().slice(0, 10);
      const byId = new Map(state.products.map((p) => [p.id, p]));
      const updates = []; const inserts = []; const histInserts = [];
      for (const r of recs) {
        const pid = (r.code && byCode.get(r.code))
          || (r.barcode && byBarcode.get(String(r.barcode).trim()))
          || byName.get(norm(r.name));
        if (pid) {
          // name обязательно (NOT NULL): если id вдруг устарел и строка вставится,
          // а не обновится — не упадём на пустом имени
          const u = { id: pid, name: r.name, stock_qty: r.stock, stock_at: at, updated_at: new Date().toISOString() };
          if (r.retail != null) {
            u.retail_price = r.retail; // не затираем, если цены нет
            // записываем в историю розничной цены, если цена изменилась
            const cur = byId.get(pid);
            const old = cur && cur.retail_price != null && cur.retail_price !== '' ? Number(cur.retail_price) : null;
            if (old == null || old !== Number(r.retail)) histInserts.push({ product_id: pid, retail_price: r.retail, changed_at: at });
          }
          updates.push(u);
        } else {
          inserts.push({
            name: r.name, code: r.code,
            group_id: r.group ? groupMap.get(norm(r.group)) : null,
            barcodes: r.barcode ? [r.barcode] : [],
            unit: r.unit || null,
            is_weighted: r.unit === 'кг',
            stock_qty: r.stock, stock_at: at,
            ...(r.retail != null ? { retail_price: r.retail } : {}),
          });
        }
      }
      let done = 0; const total = updates.length + inserts.length;
      for (let i = 0; i < updates.length; i += 500) {
        const { error } = await sb.from('catalog_products')
          .upsert(updates.slice(i, i + 500), { onConflict: 'id' });
        if (error) throw error;
        done += Math.min(500, updates.length - i);
        stockStatus(`Обновляем остатки… ${done} из ${total}`);
      }
      for (let i = 0; i < inserts.length; i += 400) {
        // upsert по коду: если товар с таким кодом уже есть (а в состоянии его не
        // было), обновим его, а не упадём на уникальном индексе кода
        const { error } = await sb.from('catalog_products')
          .upsert(inserts.slice(i, i + 400), { onConflict: 'code' });
        if (error) throw error;
        done += Math.min(400, inserts.length - i);
        stockStatus(`Добавляем новые товары… ${done} из ${total}`);
      }
      // история розничной цены (не критично — если таблицы нет, тихо пропускаем)
      if (histInserts.length) {
        for (let i = 0; i < histInserts.length; i += 500) {
          try {
            await sb.from('catalog_retail_history')
              .upsert(histInserts.slice(i, i + 500), { onConflict: 'product_id,changed_at' });
          } catch (e) { break; } // старая база без таблицы истории
        }
      }
      stockStatus('Обновляем каталог…');
      await refresh({ silent: true });
      renderAll();
      await autoDedup(); // тихо убрать дубли, если появились при сопоставлении по названию
      stockStatus(`Готово! Остатки на ${fmtDate(at)} сохранены. Обновлено: ${updates.length}, новых товаров: ${inserts.length} ✓`);
      toast('Остатки загружены ✓');
      stockParsed = null;
      btn.textContent = 'Проверить файл';
    } catch (err) {
      stockStatus('Ошибка: ' + (err.message || err)
        + '. Если база старой версии — выполни setup/ВСЕ-ОБНОВЛЕНИЯ.sql в SQL Editor.');
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Ходовые товары (после входа) ─────────────── */

  const isoDay = (d) => d.toISOString().slice(0, 10);

  const daysBetween = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  // Человеческое название периода: «Июль 2026» (полный месяц) · «17 июля 2026»
  // (один день) · «1 июля – 15 августа 2026» (произвольный диапазон).
  function periodLabel(from, to) {
    const [fy, fm, fd] = String(from).split('-').map(Number);
    const [ty, tm, td] = String(to).split('-').map(Number);
    if (!fy || !ty) return `${fmtDate(from)}–${fmtDate(to)}`;
    if (from === to) return `${fd} ${MONTHS_GEN[fm - 1]} ${fy}`;
    const lastDay = new Date(fy, fm, 0).getDate(); // последний день месяца fm
    if (fd === 1 && fy === ty && fm === tm && td === lastDay) return `${MONTHS_NOM[fm - 1]} ${fy}`;
    const yr = ty === fy ? '' : ` ${fy}`;
    return `${fd} ${MONTHS_GEN[fm - 1]}${yr} – ${td} ${MONTHS_GEN[tm - 1]} ${ty}`;
  }

  let topPeriod = null; // {from, to} — выбранный период

  // загруженные периоды продаж: один — просто подпись, несколько — простой список
  async function renderTopPeriods() {
    const box = $('topChips');
    let periods = [];
    try {
      const { data, error } = await sb.rpc('catalog_sales_periods');
      if (error) throw error;
      periods = data || [];
    } catch (e) {
      box.innerHTML = '';
      $('topDeletePeriod').hidden = true;
      $('topList').innerHTML = '<p class="muted">Не получилось прочитать продажи. Если база старой версии — выполни setup/ВСЕ-ОБНОВЛЕНИЯ.sql</p>';
      return;
    }
    if (!periods.length) {
      box.innerHTML = '';
      $('topDeletePeriod').hidden = true;
      $('topList').innerHTML = '<p class="muted">Продажи ещё не загружены. Меню админа → «📈 Импорт продаж» — загрузи отчёт «Продажи» из 1С.</p>';
      return;
    }
    // удалить отчёт может только администратор
    $('topDeletePeriod').hidden = !state.isAdmin;
    // по умолчанию — самый свежий отчёт (список приходит от новых к старым)
    topPeriod = { from: periods[0].period_from, to: periods[0].period_to };
    if (periods.length === 1) {
      box.innerHTML = `<div class="top-period-one">${esc(periodLabel(topPeriod.from, topPeriod.to))}</div>`;
    } else {
      box.innerHTML = '<label class="top-period-field"><span class="top-period-cap">Период</span>'
        + '<select id="topPeriodSel">'
        + periods.map((p) => `<option value="${esc(p.period_from)}|${esc(p.period_to)}">${esc(periodLabel(p.period_from, p.period_to))}</option>`).join('')
        + '</select></label>';
    }
    loadTopProducts();
  }

  // как считаем «ходовость»: по выручке (деньгам) — профессиональный вариант по
  // умолчанию — или по количеству. Деньги сравнимы для весовых и штучных, поэтому
  // выручка честнее: топ не путает кг и шт и не прячет дорогие позиции.
  let topMode = 'amount'; // 'amount' | 'qty'

  async function loadTopProducts() {
    if (!topPeriod) return;
    const from = topPeriod.from;
    const to = topPeriod.to;
    const days = daysBetween(from, to);
    const box = $('topList');
    box.innerHTML = '<p class="muted">Считаем…</p>';

    let data; let total = null;
    try {
      const res = await sb.rpc('catalog_top_products', { p_from: from, p_to: to, p_limit: 200, p_order: topMode });
      if (res.error) throw res.error;
      data = res.data;
      const tot = await sb.rpc('catalog_period_total', { p_from: from, p_to: to });
      if (!tot.error && tot.data && tot.data[0]) total = tot.data[0];
    } catch (e) {
      // старая база (функция без p_order / без catalog_period_total): берём как
      // раньше и сортируем на клиенте — фича продолжает работать до ОБНОВЛЕНИЯ-17
      const res = await sb.rpc('catalog_top_products', { p_from: from, p_to: to, p_limit: 300 });
      if (res.error) { box.innerHTML = '<p class="muted">Не получилось посчитать: ' + esc(res.error.message || '') + '</p>'; return; }
      data = res.data;
    }
    if (!data || !data.length) { box.innerHTML = '<p class="muted">За этот период продаж нет</p>'; return; }

    const byId = new Map(state.products.map((p) => [p.id, p]));
    const rnd = (n) => (n % 1 ? Math.round(n * 10) / 10 : n);
    const num = (v) => Number(v) || 0;
    const metric = (r) => (topMode === 'qty' ? num(r.total_qty) : num(r.total_amount));
    // на всякий случай (и для старой базы) сортируем сами по выбранной мере
    data = data.slice().sort((a, b) => metric(b) - metric(a));

    const totAmount = total ? num(total.total_amount) : data.reduce((s, r) => s + num(r.total_amount), 0);
    const maxMetric = metric(data[0]) || 1;
    const modeLabel = topMode === 'qty' ? 'по количеству' : 'по выручке';
    const head = `<div class="top-summary">${esc(periodLabel(from, to))} · ${days} дн. · ${modeLabel}`
      + (totAmount ? ` · оборот ${fmtPrice(totAmount)}` : '') + `</div>`;

    box.innerHTML = head + data.map((row, i) => {
      const p = byId.get(row.product_id);
      if (!p) return '';
      const photo = (p.photos || [])[0];
      const qty = num(row.total_qty);
      const amt = num(row.total_amount);
      const u = p.unit || (p.is_weighted ? 'кг' : 'шт');
      const perDay = rnd(qty / days);
      const primary = topMode === 'qty' ? `${rnd(qty)} ${esc(u)}` : fmtPrice(amt);
      const secondary = topMode === 'qty' ? (amt ? fmtPrice(amt) : '') : `${rnd(qty)} ${esc(u)}`;
      const share = totAmount ? (amt / totAmount) * 100 : 0;
      const shareTxt = share ? ` · ${share >= 10 ? Math.round(share) : share.toFixed(1)}% оборота` : '';
      const barW = Math.max(4, Math.round((metric(row) / maxMetric) * 100));
      return `<div class="top-row${i < 3 ? ' top-row-lead' : ''}" data-id="${esc(p.id)}">
        <span class="top-rank">${i + 1}</span>
        <span class="top-photo">${photo ? `<img src="${esc(photo)}" loading="lazy" alt="">` : '📦'}</span>
        <div class="top-main">
          <div class="top-name">${esc(p.name)}</div>
          <div class="top-bar"><span style="width:${barW}%"></span></div>
          <div class="top-sub">≈${perDay} ${esc(u)}/день${shareTxt}</div>
        </div>
        <div class="top-val">
          <span class="top-primary">${primary}</span>
          ${secondary ? `<span class="top-secondary">${secondary}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function openTopSheet() {
    openSheet('topSheet');
    $('topList').innerHTML = '<p class="muted">Загружаем…</p>';
    renderTopPeriods();
  }

  /* ── Сканер штрихкода ─────────────────────────────
   * Android/Chrome — встроенный распознаватель (BarcodeDetector).
   * iPhone/Safari и остальные — библиотека html5-qrcode (грузится один раз при
   * первом сканировании). Кнопка доступна всем: сотрудник сканирует товар на
   * полке и сразу видит его карточку с кодами. */

  let scanStopFn = null;

  function stopScan() {
    if (scanStopFn) { scanStopFn(); scanStopFn = null; }
  }

  async function startScan(onResult) {
    openSheet('scanSheet');
    let finished = false;
    const done = (text) => {
      if (finished) return;
      finished = true;
      closeSheet('scanSheet'); // closeSheet сам остановит камеру
      onResult(String(text).trim());
    };
    try {
      if ('BarcodeDetector' in window) await scanNative(done);
      else await scanWithLibrary(done);
    } catch (e) {
      toast('Камера недоступна. Разреши доступ к камере в настройках браузера');
      closeSheet('scanSheet');
    }
  }

  // штрихкоды магазина: EAN/UPC/Code128/39/ITF — сужаем список, чтобы распознавалось точнее
  const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

  async function scanNative(done) {
    const box = $('scanContainer');
    box.innerHTML = '';
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    box.appendChild(video);
    // просим камеру повыше разрешением и с постоянной фокусировкой — резче мелкие
    // и некачественные штрихкоды
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 }, height: { ideal: 1080 },
        focusMode: 'continuous', advanced: [{ focusMode: 'continuous' }],
      },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    let active = true;
    scanStopFn = () => {
      active = false;
      try { track && track.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) { /* */ }
      stream.getTracks().forEach((t) => t.stop());
      box.innerHTML = '';
      $('scanTorch').hidden = true;
    };
    video.srcObject = stream;
    await video.play();

    // кнопка «Подсветка» — если камера умеет включать вспышку (тёмное помещение)
    setupTorch(track);

    // поддерживаемые форматы (не все браузеры умеют getSupportedFormats)
    let formats = BARCODE_FORMATS;
    try {
      if (window.BarcodeDetector.getSupportedFormats) {
        const sup = await window.BarcodeDetector.getSupportedFormats();
        formats = BARCODE_FORMATS.filter((f) => sup.includes(f));
        if (!formats.length) formats = undefined;
      }
    } catch (e) { formats = undefined; }
    const detector = formats ? new window.BarcodeDetector({ formats }) : new window.BarcodeDetector();

    // распознаём и обычный кадр, и инвертированный — так читаются и светлые
    // коды на тёмном фоне, и тёмные на светлом даже при плохом свете
    const canvas = document.createElement('canvas');
    const cx = canvas.getContext('2d', { willReadFrequently: true });
    let frame = 0;
    const tick = async () => {
      if (!active) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) { done(codes[0].rawValue); return; }
        // каждый второй кадр пробуем инверсию (для тёмных/светлых штрихкодов)
        if (video.videoWidth && (frame++ % 2 === 0)) {
          const w = Math.min(960, video.videoWidth); const h = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w; canvas.height = h;
          cx.drawImage(video, 0, 0, w, h);
          const img = cx.getImageData(0, 0, w, h);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
          cx.putImageData(img, 0, 0);
          const inv = await detector.detect(canvas);
          if (inv.length && inv[0].rawValue) { done(inv[0].rawValue); return; }
        }
      } catch (e) { /* кадр не считался — пробуем дальше */ }
      setTimeout(tick, 160);
    };
    tick();
  }

  // Подсветка (вспышка) камеры — помогает в тёмном помещении
  function setupTorch(track) {
    const btn = $('scanTorch');
    btn.hidden = true;
    let on = false;
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps || !caps.torch) return; // камера не умеет — прячем кнопку
    } catch (e) { return; }
    btn.hidden = false;
    btn.textContent = '🔦 Подсветка';
    btn.onclick = async () => {
      on = !on;
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.textContent = on ? '🔦 Выключить подсветку' : '🔦 Подсветка'; }
      catch (e) { toast('Подсветка недоступна на этом телефоне'); }
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function scanWithLibrary(done) {
    if (!window.Html5Qrcode) {
      toast('Включаем сканер…');
      await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js');
    }
    $('scanContainer').innerHTML = '';
    // сузим до магазинных штрихкодов — точнее и быстрее распознаёт
    let formats;
    try {
      const F = window.Html5QrcodeSupportedFormats;
      formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.CODABAR].filter((x) => x != null);
    } catch (e) { formats = undefined; }
    const scanner = new window.Html5Qrcode('scanContainer', formats ? { formatsToSupport: formats } : undefined);
    scanStopFn = () => { scanner.stop().then(() => scanner.clear()).catch(() => {}); $('scanTorch').hidden = true; };
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 260, height: 170 }, aspectRatio: 1.4 },
      (text) => done(text),
      () => {},
    );
    // подсветка через трек камеры библиотеки, если доступна
    try {
      const track = scanner.getRunningTrackCameraCapabilities && scanner.getRunningTrackCameraCapabilities();
      const rt = (scanner._localMediaStream || (scanner.getState && document.querySelector('#scanContainer video')?.srcObject));
      const vt = rt && rt.getVideoTracks && rt.getVideoTracks()[0];
      if (vt) setupTorch(vt);
    } catch (e) { /* необязательно */ }
  }

  // сотрудник отсканировал штрихкод → ищем товар
  function scanToSearch(text) {
    const input = $('searchInput');
    input.value = text;
    state.query = text;
    $('searchClear').hidden = false;
    renderActiveFilters();
    renderGrid();
    const p = state.products.find((x) => (x.barcodes || []).some((b) => norm(b) === norm(text)));
    if (p) openProduct(p);
    else toast('Товар с таким штрихкодом в каталоге не найден');
  }

  /* ── События ──────────────────────────────────── */

  function bindEvents() {
    // Поиск
    const input = $('searchInput');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.query = input.value;
        state.renderLimit = PAGE_SIZE;
        $('searchClear').hidden = !input.value;
        renderActiveFilters();
        renderGrid();
      }, 150);
    });
    // запомнить запрос в «недавние» при подтверждении (Enter / потеря фокуса)
    input.addEventListener('change', () => { if (input.value.trim()) addRecentQuery(input.value); });
    $('searchClear').addEventListener('click', () => {
      input.value = '';
      state.query = '';
      state.renderLimit = PAGE_SIZE;
      $('searchClear').hidden = true;
      renderActiveFilters();
      renderGrid();
      input.focus();
    });

    // Окно фильтров (одна кнопка — всё внутри: категории, сортировка, цена, вид)
    $('filterBtn').addEventListener('click', () => { syncControls(); openSheet('filterSheet'); });
    $('filterApply').addEventListener('click', () => closeSheet('filterSheet'));
    $('filterReset').addEventListener('click', clearAllFilters);
    // Круглая иконка «вид» в шапке — переключает размер плиток
    $('viewToggleBtn').addEventListener('click', () => { state.view = state.view === 'compact' ? 'normal' : 'compact'; renderAll(); });

    // Категории-чекбоксы: отметка добавляет/снимает категорию (и её подгруппы)
    $('filterCats').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-fcat]');
      if (!cb) return;
      const c = cb.dataset.fcat;
      if (cb.checked) { if (!state.selCats.includes(c)) state.selCats = [...state.selCats, c]; }
      else {
        state.selCats = state.selCats.filter((x) => x !== c);
        const ids = new Set(state.groups.filter((g) => categoryOf(g.name) === c).map((g) => g.id));
        state.selGroups = state.selGroups.filter((x) => !ids.has(x));
      }
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // Сортировка (сегменты)
    $('sortSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.sort = b.dataset.sort;
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });
    // Тип товара: весовой / штучный (сотрудникам)
    $('typeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.selType = b.dataset.type;
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });
    // Поступление: пресеты (за N дней) — заполняют диапазон дат
    $('arrivalPresets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-days]'); if (!b) return;
      const from = daysAgoISO(Number(b.dataset.days));
      const to = todayISO();
      // повторный тап по активному пресету — снять
      if (state.arrivalFrom === from && state.arrivalTo === to) { state.arrivalFrom = ''; state.arrivalTo = ''; }
      else { state.arrivalFrom = from; state.arrivalTo = to; }
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });
    // Поступление: произвольные даты «с … по …»
    const onArrivalDate = () => {
      state.arrivalFrom = $('arrivalFrom').value || '';
      state.arrivalTo = $('arrivalTo').value || '';
      state.renderLimit = PAGE_SIZE;
      renderAll();
    };
    $('arrivalFrom').addEventListener('change', onArrivalDate);
    $('arrivalTo').addEventListener('change', onArrivalDate);
    // Группы — открыть полный список для выбора (можно несколько)
    $('filterGroupsBtn').addEventListener('click', () => {
      $('groupsPickSearch').value = '';
      renderGroupsPick();
      openSheet('groupsPickSheet');
    });
    // Поставщики — открыть список поставщиков (только админ/аналитик)
    $('filterSuppliersBtn').addEventListener('click', () => {
      $('supplierSearch').value = '';
      renderSupplierList();
      openSheet('supplierSheet');
    });
    // Диапазон цены — применяется на лету по мере ввода
    let priceDeb;
    const applyPrice = () => {
      const mn = parseFloat($('priceMin').value); const mx = parseFloat($('priceMax').value);
      state.priceMin = Number.isFinite(mn) ? mn : null;
      state.priceMax = Number.isFinite(mx) ? mx : null;
      state.renderLimit = PAGE_SIZE;
      renderAll();
    };
    $('priceMin').addEventListener('input', () => { clearTimeout(priceDeb); priceDeb = setTimeout(applyPrice, 300); });
    $('priceMax').addEventListener('input', () => { clearTimeout(priceDeb); priceDeb = setTimeout(applyPrice, 300); });

    // Быстрые фильтры
    $('quickChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const k = chip.dataset.quick;
      state.quick = state.quick.includes(k) ? state.quick.filter((x) => x !== k) : [...state.quick, k];
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // Плашки активных фильтров на главном — тап по ✕ снимает конкретный фильтр
    $('activeFilters').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-rm]');
      if (!chip) return;
      removeFilter(chip.dataset.rm, chip.dataset.val);
    });

    // Быстрый выбор диапазона цены (пресеты)
    $('pricePresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pmin]');
      if (!btn) return;
      const mn = btn.dataset.pmin === '' ? null : Number(btn.dataset.pmin);
      const mx = btn.dataset.pmax === '' ? null : Number(btn.dataset.pmax);
      // повторный тап по активному пресету — снять
      if (state.priceMin === mn && state.priceMax === mx) { state.priceMin = null; state.priceMax = null; }
      else { state.priceMin = mn; state.priceMax = mx; }
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // Сброс фильтров из пустого экрана
    $('emptyReset').addEventListener('click', clearAllFilters);

    // Переключение темы
    $('themeBtn').addEventListener('click', toggleTheme);

    // Фото на весь экран: тап или смахивание вниз закрывает
    $('lightbox').addEventListener('click', closeLightbox);
    $('lightboxClose').addEventListener('click', closeLightbox);
    (() => {
      const lb = $('lightbox'); const img = $('lightboxImg');
      let sy = 0; let drag = false;
      lb.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; drag = true; img.style.transition = 'none'; }, { passive: true });
      lb.addEventListener('touchmove', (e) => { if (!drag) return; const d = e.touches[0].clientY - sy; img.style.transform = `translateY(${d}px)`; lb.style.opacity = String(Math.max(0.2, 1 - Math.abs(d) / 500)); }, { passive: true });
      const end = () => { if (!drag) return; drag = false; const m = img.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/); const d = m ? Math.abs(parseFloat(m[1])) : 0; img.style.transition = 'transform .25s'; img.style.transform = ''; lb.style.opacity = ''; if (d > 90) closeLightbox(); };
      lb.addEventListener('touchend', end); lb.addEventListener('touchcancel', end);
    })();

    // Группы-фильтры + чипы поставщика и «Ещё группы»
    $('groupChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (chip.hasAttribute('data-supplier-chip')) {
        $('supplierSearch').value = '';
        renderSupplierList();
        openSheet('supplierSheet');
        return;
      }
      if (chip.hasAttribute('data-top-chip')) { openTopSheet(); return; }
      // «Избранное» — переключаем режим показа только избранных товаров
      if (chip.hasAttribute('data-fav-chip')) { state.favOnly = !state.favOnly; state.renderLimit = PAGE_SIZE; renderAll(); return; }
      // «Пришло сегодня» — быстрый фильтр поступления за сегодня (повторный тап снимает)
      if (chip.hasAttribute('data-arrival-today')) {
        const from = daysAgoISO(0); const to = todayISO();
        if (state.arrivalFrom === from && state.arrivalTo === to) { state.arrivalFrom = ''; state.arrivalTo = ''; }
        else { state.arrivalFrom = from; state.arrivalTo = to; }
        state.renderLimit = PAGE_SIZE; renderAll(); return;
      }
      // сброс — очищает всё (категории, группы, поставщиков, быстрые фильтры, цену, поиск)
      if (chip.hasAttribute('data-reset')) { clearAllFilters(); return; }
      // повторный тап снимает отметку; можно отметить несколько
      if (chip.hasAttribute('data-all')) { state.selCats = []; state.selGroups = []; state.favOnly = false; }
      else if (chip.hasAttribute('data-category')) {
        const c = chip.dataset.category;
        if (state.selCats.includes(c)) {
          // снимаем категорию — и её подгруппы из выбора тоже
          state.selCats = state.selCats.filter((x) => x !== c);
          const ids = new Set(state.groups.filter((g) => categoryOf(g.name) === c).map((g) => g.id));
          state.selGroups = state.selGroups.filter((x) => !ids.has(x));
        } else state.selCats = [...state.selCats, c];
      } else {
        const g = chip.dataset.group; // 'none' | 'weighted'
        state.selGroups = state.selGroups.includes(g)
          ? state.selGroups.filter((x) => x !== g) : [...state.selGroups, g];
      }
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // подгруппы выбранных категорий — тап отмечает/снимает
    $('subChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const g = chip.dataset.group;
      state.selGroups = state.selGroups.includes(g)
        ? state.selGroups.filter((x) => x !== g) : [...state.selGroups, g];
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // выбор поставщиков — тап отмечает/снимает, шторка остаётся открытой
    $('supplierList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-supplier]');
      if (!btn) return;
      const id = btn.dataset.pickSupplier;
      if (!id) state.selSuppliers = []; // «снять выбор»
      else {
        state.selSuppliers = state.selSuppliers.includes(id)
          ? state.selSuppliers.filter((x) => x !== id) : [...state.selSuppliers, id];
      }
      state.renderLimit = PAGE_SIZE;
      renderSupplierList();
      renderAll();
    });
    $('supplierSearch').addEventListener('input', renderSupplierList);

    // выбор групп в полном списке — тап отмечает/снимает, шторка остаётся открытой
    $('groupsPickList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-group]');
      if (!btn) return;
      const id = btn.dataset.pickGroup;
      if (!id) { // «снять выбор» — убираем только конкретные группы
        state.selGroups = state.selGroups.filter((x) => x === 'none' || x === 'weighted');
      } else {
        state.selGroups = state.selGroups.includes(id)
          ? state.selGroups.filter((x) => x !== id) : [...state.selGroups, id];
      }
      state.renderLimit = PAGE_SIZE;
      renderGroupsPick();
      renderAll();
    });
    $('groupsPickSearch').addEventListener('input', renderGroupsPick);

    // «все товары поставщика» из карточки товара
    $('sheetSupplier').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-supplier-all]');
      if (!btn) return;
      state.selSuppliers = [btn.dataset.supplierAll];
      state.selCats = [];
      state.selGroups = [];
      state.renderLimit = PAGE_SIZE;
      closeSheet('productSheet');
      renderAll();
    });

    // Открытие карточки
    $('productGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const p = state.products.find((x) => x.id === card.dataset.id);
      if (p) openProduct(p);
    });

    // Тап по фото в карточке — открыть на весь экран
    $('sheetPhotos').addEventListener('click', (e) => {
      const img = e.target.closest('img');
      if (img && img.src) openLightbox(img.src);
    });

    // Поделиться товаром
    $('btnShareProduct').addEventListener('click', () => { if (currentProduct) shareProduct(currentProduct); });
    // ♥ в карточке — добавить/убрать из избранного
    $('btnFav').addEventListener('click', () => {
      if (!currentProduct) return;
      const nowFav = toggleFav(currentProduct.id);
      updateFavButton(currentProduct);
      toast(nowFav ? 'Добавлено в избранное' : 'Убрано из избранного');
      renderAll(); // обновляем чип «Избранное» и, если он включён, — сетку
    });
    // Похожие товары и «Недавно смотрели» — тап открывает другой товар
    const openSimilar = (e) => {
      const b = e.target.closest('[data-similar]');
      if (!b) return;
      const p = state.products.find((x) => x.id === b.dataset.similar);
      if (p) openProduct(p);
    };
    $('sheetSimilar').addEventListener('click', openSimilar);
    $('recentStrip').addEventListener('click', openSimilar);
    $('popularStrip').addEventListener('click', openSimilar);

    // Точки под фото
    $('sheetPhotos').addEventListener('scroll', () => {
      const strip = $('sheetPhotos');
      const i = Math.round(strip.scrollLeft / strip.clientWidth);
      [...$('sheetDots').children].forEach((d, j) => d.classList.toggle('active', i === j));
    }, { passive: true });

    // Копирование кодов
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Скопировано: ' + btn.dataset.copy);
      } catch (err) {
        toast('Не удалось скопировать');
      }
    });

    // Закрытие шторок: крестики, кнопки, тап по фону, стрелка «назад», смахивание вниз
    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => closeSheet(b.dataset.close)));
    $('sheetClose').addEventListener('click', () => closeSheet('productSheet'));
    document.querySelectorAll('.sheet-backdrop').forEach((bd) =>
      bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(bd.id); }));
    addBackButtons();
    enableSwipeToClose();

    // Вход: одна форма для всех, права определяются по аккаунту.
    // Сотрудник вводит только пароль магазина. Админ — свой пароль: email
    // спрашивается один раз, дальше хранится на устройстве и подставляется сам.
    const ADMIN_EMAIL_KEY = 'wm_admin_email';

    function openLogin() {
      // email виден сразу, только если служебные аккаунты не настроены в config.js
      $('loginEmailWrap').hidden = !!(CFG.STAFF_EMAIL || (CFG.SERVICE_EMAILS && CFG.SERVICE_EMAILS.length));
      $('loginError').hidden = true;
      openSheet('loginSheet');
    }

    $('adminBtn').addEventListener('click', () => {
      if (state.session) {
        const roleName = { admin: 'Главный администратор', manager: 'Аналитик / зал', cashier: 'Кассир' }[state.role] || 'Сотрудник';
        const roleHint = {
          admin: state.session.user?.email || '',
          manager: 'Вход выполнен — цены, контакты и аналитика открыты',
          cashier: 'Вход выполнен — товары и розничные цены',
        }[state.role] || 'Вход выполнен';
        $('menuTitle').textContent = roleName;
        $('adminEmail').textContent = roleHint;
        $('menuAdminOnly').hidden = !state.isAdmin;
        $('menuTop').hidden = !state.canPurchase; // аналитика продаж — админ/аналитик; кассиру не показываем
        // на кнопке «Дозаполнить фото» — сколько товаров ещё без фото
        const noPhoto = photoCandidates().length;
        $('menuPhotoFill').textContent = noPhoto ? `📷 Дозаполнить фото (${noPhoto})` : '📷 Дозаполнить фото — всё есть ✓';
        // «Фото на проверке» — показываем, если в очереди что-то есть
        $('menuSuggestions').hidden = !(state.suggCount > 0);
        $('menuSuggestions').textContent = `🖼 Фото на проверке (${state.suggCount || 0})`;
        openSheet('adminMenuSheet');
        loadSuggestionsCount().then(() => {
          $('menuSuggestions').hidden = !(state.suggCount > 0);
          $('menuSuggestions').textContent = `🖼 Фото на проверке (${state.suggCount || 0})`;
        });
      } else {
        openLogin();
      }
    });

    // цены в карточке: 🔒 открывает вход, тап по строке — историю цены
    // тап по поставщику в карточке товара → его контакты и цена
    $('sheetPrices').addEventListener('click', (e) => {
      if (e.target.closest('#pricesLoginBtn')) { openLogin(); return; }
      const row = e.target.closest('[data-supplier-view]');
      if (row) openSupplierView(row.dataset.supplierView);
    });

    // разведка цен: «＋ Добавить цену магазина» в карточке товара
    $('sheetCompetitors').addEventListener('click', (e) => {
      if (e.target.closest('#compAddBtn') && currentProduct) openCompetitorAdd(currentProduct);
    });
    // выбор/создание магазина в форме разведки
    $('compStoreSearch').addEventListener('input', renderCompStoreList);
    $('compStoreList').addEventListener('click', async (e) => {
      const pick = e.target.closest('[data-comp-store]');
      if (pick) { compChosenId = pick.dataset.compStore; showCompChosen(); return; }
      const make = e.target.closest('[data-comp-new]');
      if (make) {
        make.disabled = true;
        const id = await createCompetitor(make.dataset.compNew);
        if (id) { compChosenId = id; showCompChosen(); }
      }
    });
    $('competitorForm').addEventListener('submit', submitCompetitorPrice);

    // добавить фото товара — любой вошедший сотрудник (камера на телефоне)
    $('addPhotoInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && currentProduct) addPhotoToProduct(file, currentProduct);
    });

    // Покупатель без аккаунта предлагает фото (на проверку)
    $('suggestPhotoInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && currentProduct) suggestPhotoToProduct(file, currentProduct);
    });
    // Сотрудник разбирает очередь предложенных фото
    $('menuSuggestions').addEventListener('click', () => { closeSheet('adminMenuSheet'); openSuggestions(); });
    $('suggestionsList').addEventListener('click', (e) => {
      const ok = e.target.closest('[data-approve]');
      if (ok) { ok.disabled = true; approveSuggestion(ok.dataset.approve); return; }
      const no = e.target.closest('[data-reject]');
      if (no) { no.disabled = true; rejectSuggestion(no.dataset.reject); }
    });

    // «Дозаполнить фото» — режим для сотрудника: снять камерой товары без фото
    $('menuPhotoFill').addEventListener('click', () => { closeSheet('adminMenuSheet'); openPhotoFill(); });
    $('photoFillSearch').addEventListener('input', renderPhotoFillList);
    $('cleanPhotosToggle').addEventListener('change', (e) => {
      try { localStorage.setItem('wm_clean_photos', e.target.checked ? '1' : '0'); } catch (err) { /* */ }
      if (e.target.checked) toast('Фото будут с белым фоном. Первое обработается дольше — грузится обрезка.');
    });
    $('photoFillList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fill-cam]');
      if (!btn) return;
      photoFillTarget = state.products.find((x) => x.id === btn.dataset.fillCam) || null;
      if (photoFillTarget) $('photoFillInput').click();
    });
    $('photoFillInput').addEventListener('change', (e) => { photoFillPick(e.target.files[0]); });

    // карточка поставщика: «все товары», вход, изменить контакты (звонок/WhatsApp — обычные ссылки)
    $('supViewBody').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const all = e.target.closest('[data-supplier-all]');
      if (all) {
        state.selSuppliers = [all.dataset.supplierAll];
        state.selCats = [];
        state.selGroups = [];
        state.renderLimit = PAGE_SIZE;
        closeSheet('supplierViewSheet');
        closeSheet('productSheet');
        renderAll();
        return;
      }
      if (e.target.closest('#supViewLogin')) { openLogin(); return; }
      const edit = e.target.closest('[data-edit]');
      if (edit) { closeSheet('supplierViewSheet'); openContactForm(edit.dataset.edit); }
    });

    $('supplierContactForm').addEventListener('submit', submitContactForm);

    // Умный импорт: меню админа → одна вкладка, каталог сам распознаёт файлы
    $('menuImportHub').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      smartEntries = [];
      $('smartList').innerHTML = '';
      $('smartRun').hidden = true;
      $('smartStatus').hidden = true;
      $('smartFiles').value = '';
      openSheet('importHubSheet');
    });
    $('smartFiles').addEventListener('change', () => { smartPick([...$('smartFiles').files]); });
    $('smartRun').addEventListener('click', smartRun);
    $('photoExcelFile').addEventListener('change', () => {
      $('photoExcelName').textContent = $('photoExcelFile').files[0]?.name || '';
      photoExcelParsed = null;
      $('photoExcelRun').textContent = 'Проверить файл';
    });
    $('photoExcelRun').addEventListener('click', async () => {
      const btn = $('photoExcelRun');
      if (photoExcelParsed) { photoExcelApply(); return; }
      btn.disabled = true;
      try { await photoExcelParse(); }
      catch (err) { photoExcelStatus('Ошибка чтения: ' + (err.message || err)); photoExcelParsed = null; }
      finally { btn.disabled = false; }
    });

    // Поиск фото по штрихкодам (только админ)
    $('hubPhotoSearch').addEventListener('click', () => {
      closeSheet('importHubSheet');
      $('photoSearchStatus').hidden = true;
      $('photoSearchRun').textContent = '▶ Начать поиск';
      openSheet('photoSearchSheet');
    });
    $('photoSearchRun').addEventListener('click', runPhotoSearch);

    // «Найти фото в интернете» в карточке товара (только админ)
    $('btnFindPhoto').addEventListener('click', async () => {
      const p = currentProduct;
      if (!p) return;
      const btn = $('btnFindPhoto');
      btn.disabled = true;
      btn.textContent = 'Ищем фото…';
      try {
        const url = await findProductPhoto(p);
        if (!url) {
          toast('В открытых базах фото этого товара нет — сфотографируй его через 📷 в карточке');
        } else {
          await attachFoundPhoto(p, url);
          saveCache();
          renderGrid();
          openProduct(p); // перерисуем карточку уже с фото
          toast('Фото найдено и сохранено ✓');
        }
      } catch (e) {
        toast('Не получилось: ' + (e.message || e));
      } finally {
        btn.disabled = false;
        btn.textContent = '🖼 Найти фото в интернете';
      }
    });

    // Пароль магазина (только админ): смена выкидывает все устройства сотрудников
    $('menuStaffPass').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      $('newStaffPass').value = '';
      $('staffPassError').hidden = true;
      openSheet('staffPassSheet');
    });

    $('staffPassForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('Сменить пароль магазина? Все устройства сотрудников выйдут из системы.')) return;
      const btn = $('staffPassSubmit');
      btn.disabled = true;
      $('staffPassError').hidden = true;
      const { error } = await sb.rpc('catalog_set_staff_password', {
        p_password: $('newStaffPass').value.trim(),
      });
      btn.disabled = false;
      if (error) {
        $('staffPassError').textContent = 'Не получилось: ' + (error.message || error)
          + '. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-4.sql в SQL Editor.';
        $('staffPassError').hidden = false;
        return;
      }
      closeSheet('staffPassSheet');
      toast('Пароль магазина изменён ✓ Устройства сотрудников выйдут в течение часа');
    });

    $('btnLogoutStaff').addEventListener('click', async () => {
      if (!confirm('Выгнать все устройства сотрудников? Им придётся войти заново с текущим паролем.')) return;
      const { error } = await sb.rpc('catalog_logout_staff');
      if (error) {
        $('staffPassError').textContent = 'Не получилось: ' + (error.message || error)
          + '. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-4.sql в SQL Editor.';
        $('staffPassError').hidden = false;
        return;
      }
      closeSheet('staffPassSheet');
      toast('Готово ✓ Устройства сотрудников выйдут в течение часа');
    });

    // ── Публикация на GitHub: окошко ключа ──
    function renderPublishStatus() {
      const has = ghConfigured();
      $('publishStatus').innerHTML = has
        ? '<span class="pub-ok">✓ Ключ на месте. Витрина публикуется автоматически после правок.</span>'
        : '<span class="pub-warn">Ключ ещё не вставлен — витрина на GitHub не обновляется.</span>';
      $('ghTokenClear').hidden = !ghToken();
      $('ghPublishNow').hidden = !has;
    }
    $('menuPublish').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      $('ghTokenInput').value = '';
      $('publishError').hidden = true;
      renderPublishStatus();
      openSheet('publishSheet');
    });
    $('ghTokenSave').addEventListener('click', async () => {
      const t = $('ghTokenInput').value.trim();
      $('publishError').hidden = true;
      if (!t) { $('publishError').textContent = 'Вставь ключ в поле выше.'; $('publishError').hidden = false; return; }
      const btn = $('ghTokenSave'); btn.disabled = true; btn.textContent = 'Проверяю…';
      ghSetToken(t);
      try {
        // проверяем: ключ действителен и видит нашу ветку деплоя
        const r = await ghApi(`${ghRepo()}/git/ref/heads/${ghBranch()}`);
        if (!r.ok) throw new Error(r.status === 404 ? 'нет доступа к репозиторию Auron — проверь, что выбрал его при создании ключа' : 'ключ не подошёл (' + r.status + ')');
        toast('Ключ сохранён ✓');
        $('ghTokenInput').value = '';
        renderPublishStatus();
      } catch (e) {
        ghSetToken('');
        $('publishError').textContent = 'Не получилось: ' + (e.message || e);
        $('publishError').hidden = false;
        renderPublishStatus();
      } finally { btn.disabled = false; btn.textContent = 'Сохранить и проверить'; }
    });
    $('ghPublishNow').addEventListener('click', async () => {
      const btn = $('ghPublishNow'); btn.disabled = true; btn.textContent = 'Публикую…';
      $('publishError').hidden = true;
      try {
        await publishShowcase({ force: true });
        toast('☁️ Витрина опубликована ✓');
      } catch (e) {
        $('publishError').textContent = 'Не удалось опубликовать: ' + (e.message || e);
        $('publishError').hidden = false;
      } finally { btn.disabled = false; btn.textContent = 'Опубликовать витрину сейчас'; }
    });
    $('ghTokenClear').addEventListener('click', () => {
      if (!confirm('Удалить ключ с этого устройства? Витрина перестанет обновляться автоматически, пока не вставишь ключ снова.')) return;
      ghSetToken('');
      renderPublishStatus();
      toast('Ключ удалён с устройства');
    });

    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('loginSubmit');
      const password = $('loginPassword').value;
      btn.disabled = true;
      btn.textContent = 'Входим…';

      // к каким аккаунтам подходит этот пароль: явный email из поля,
      // иначе аккаунт сотрудников + запомненный email админа
      const typed = $('loginEmail').value.trim();
      const emails = [];
      if (!$('loginEmailWrap').hidden && typed) emails.push(typed);
      else {
        // служебные аккаунты (кассир, аналитик/зал) — подбираем по паролю
        const svc = CFG.SERVICE_EMAILS && CFG.SERVICE_EMAILS.length
          ? CFG.SERVICE_EMAILS.slice() : (CFG.STAFF_EMAIL ? [CFG.STAFF_EMAIL] : []);
        for (const e of svc) if (!emails.includes(e)) emails.push(e);
        const savedAdmin = localStorage.getItem(ADMIN_EMAIL_KEY);
        if (savedAdmin && !emails.includes(savedAdmin)) emails.push(savedAdmin);
      }

      let ok = null;
      for (const email of emails) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (!error) { ok = email; break; }
      }
      btn.disabled = false;
      btn.textContent = 'Войти';

      if (!ok) {
        if ($('loginEmailWrap').hidden) {
          // пароль не подошёл сотрудникам — возможно, это админ: спросим email
          $('loginEmailWrap').hidden = false;
          $('loginError').textContent = 'Пароль не подошёл. Сотрудник — проверь пароль магазина. Администратор — укажи свой email выше';
        } else {
          $('loginError').textContent = 'Неверный email или пароль';
        }
        $('loginError').hidden = false;
        return;
      }

      if (ok !== CFG.STAFF_EMAIL) {
        try { localStorage.setItem(ADMIN_EMAIL_KEY, ok); } catch (err) { /* некритично */ }
      }
      $('loginPassword').value = '';
      $('loginEmail').value = '';
      closeSheet('loginSheet');
      toast('Вход выполнен ✓');
    });

    $('menuLogout').addEventListener('click', async () => {
      await sb.auth.signOut();
      closeSheet('adminMenuSheet');
      toast('Вы вышли из аккаунта');
    });

    $('fabAdd').addEventListener('click', () => openForm(null));
    $('menuAddProduct').addEventListener('click', () => { closeSheet('adminMenuSheet'); openForm(null); });
    $('btnEditProduct').addEventListener('click', () => { closeSheet('productSheet'); openForm(currentProduct); });
    $('btnDeleteProduct').addEventListener('click', deleteProduct);
    $('productForm').addEventListener('submit', submitForm);

    // Сканер: для всех — поиск товара; в форме админа — добавляет штрихкод в список
    $('scanSearchBtn').addEventListener('click', () => startScan(scanToSearch));
    $('btnScan').addEventListener('click', () => startScan((text) => {
      const ta = $('fBarcodes');
      const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines.includes(text)) lines.push(text);
      ta.value = lines.join('\n');
      toast('Штрихкод считан ✓');
    }));

    // Поставщики в форме товара: добавить из списка / убрать тапом по ✕
    $('btnAddSupplierToProduct').addEventListener('click', () => {
      const id = $('fSupplier').value;
      if (id && !formSupplierIds.includes(id)) {
        formSupplierIds.push(id);
        renderFormSupplierTags();
      }
      $('fSupplier').value = '';
    });
    $('fSupplierTags').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-untag]');
      if (!btn) return;
      formSupplierIds = formSupplierIds.filter((id) => id !== btn.dataset.untag);
      renderFormSupplierTags();
    });

    // Фото в форме
    $('photoManager').addEventListener('click', (e) => {
      if (e.target.closest('#photoAddBtn')) { $('photoInput').click(); return; }
      const x = e.target.closest('.thumb-x');
      if (x) {
        formPhotos.splice(Number(x.dataset.idx), 1);
        renderPhotoManager();
      }
    });
    $('photoInput').addEventListener('change', async () => {
      const files = [...$('photoInput').files];
      $('photoInput').value = '';
      for (const f of files) {
        const blob = await compressImage(f);
        formPhotos.push({ blob, preview: URL.createObjectURL(blob) });
      }
      renderPhotoManager();
    });

    // Группы (управление)
    $('menuGroups').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      renderGroupsManager();
      openSheet('groupsSheet');
    });
    $('btnAddGroup').addEventListener('click', addGroup);
    $('newGroupName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } });
    $('groupsList').addEventListener('change', (e) => {
      const row = e.target.closest('.group-row');
      if (row && e.target.classList.contains('group-name')) renameGroup(row.dataset.id, e.target.value);
    });
    $('groupsList').addEventListener('click', (e) => {
      const del = e.target.closest('.group-del');
      if (del) deleteGroup(del.closest('.group-row').dataset.id);
    });

    // Старые отдельные экраны импорта скрыты — вход теперь через «умный импорт».
    // Их обработчики файлов/загрузки оставлены (элементы существуют, вреда нет).
    $('impFile1').addEventListener('change', () => {
      $('impFile1Name').textContent = $('impFile1').files[0]?.name || '';
      impParsed = null;
      $('impRun').textContent = 'Проверить файлы';
    });
    $('impFile2').addEventListener('change', () => {
      $('impFile2Name').textContent = $('impFile2').files[0]?.name || '';
      impParsed = null;
      $('impRun').textContent = 'Проверить файлы';
    });
    $('impRun').addEventListener('click', async () => {
      const btn = $('impRun');
      if (impParsed) { impUpload(); return; }
      btn.disabled = true;
      try {
        await impParse();
      } catch (err) {
        impStatus('Ошибка чтения: ' + (err.message || err));
      } finally {
        btn.disabled = false;
      }
    });

    // Убрать дубли товаров (только админ)
    $('menuDedup').addEventListener('click', () => { closeSheet('adminMenuSheet'); dedupProducts(); });

    // Ходовые товары (после входа)
    $('menuTop').addEventListener('click', () => { closeSheet('adminMenuSheet'); openTopSheet(); });
    // выбор периода из выпадающего списка
    $('topChips').addEventListener('change', (e) => {
      const sel = e.target.closest('#topPeriodSel');
      if (!sel) return;
      const [from, to] = sel.value.split('|');
      topPeriod = { from, to };
      loadTopProducts();
    });
    // админ удаляет выбранный отчёт продаж (товары и цены не трогаются)
    $('topDeletePeriod').addEventListener('click', async () => {
      if (!state.isAdmin || !topPeriod) return;
      const label = periodLabel(topPeriod.from, topPeriod.to);
      if (!confirm(`Удалить отчёт продаж за «${label}»?\nТовары, цены и остальное не тронутся — удалится только этот загруженный отчёт продаж.`)) return;
      const btn = $('topDeletePeriod');
      btn.disabled = true;
      try {
        const { error } = await sb.rpc('catalog_delete_sales_period', { p_from: topPeriod.from, p_to: topPeriod.to });
        if (error) throw error;
        toast('Отчёт продаж удалён');
        await renderTopPeriods(); // обновляем список периодов и топ
      } catch (e) {
        toast('Не удалось удалить: ' + (e.message || ''));
      } finally {
        btn.disabled = false;
      }
    });
    // переключатель «По выручке / По количеству»
    $('topModeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.dataset.mode === topMode) return;
      topMode = btn.dataset.mode;
      document.querySelectorAll('#topModeSeg button').forEach((b) => b.classList.toggle('active', b === btn));
      loadTopProducts();
    });
    $('topList').addEventListener('click', (e) => {
      const row = e.target.closest('.top-row');
      if (!row) return;
      const p = state.products.find((x) => x.id === row.dataset.id);
      if (p) { closeSheet('topSheet'); openProduct(p); }
    });

    $('salesFile').addEventListener('change', () => {
      $('salesFileName').textContent = $('salesFile').files[0]?.name || '';
      salesParsed = null;
      $('salesRun').textContent = 'Проверить файл';
    });
    $('salesRun').addEventListener('click', async () => {
      const btn = $('salesRun');
      if (salesParsed) { salesUpload(); return; }
      btn.disabled = true;
      try {
        await salesParse();
      } catch (err) {
        salesStatus('Ошибка чтения: ' + (err.message || err));
        salesParsed = null;
      } finally {
        btn.disabled = false;
      }
    });

    $('stockFile').addEventListener('change', () => {
      $('stockFileName').textContent = $('stockFile').files[0]?.name || '';
      stockParsed = null;
      $('stockRun').textContent = 'Проверить файл';
    });
    $('stockRun').addEventListener('click', async () => {
      const btn = $('stockRun');
      if (stockParsed) { stockUpload(); return; }
      btn.disabled = true;
      try { await stockParse(); }
      catch (err) { stockStatus('Ошибка чтения: ' + (err.message || err)); stockParsed = null; }
      finally { btn.disabled = false; }
    });

    $('contactsFile').addEventListener('change', () => {
      $('contactsFileName').textContent = $('contactsFile').files[0]?.name || '';
      contactsParsed = null;
      $('contactsRun').textContent = 'Проверить файл';
    });
    $('contactsRun').addEventListener('click', async () => {
      const btn = $('contactsRun');
      if (contactsParsed) { contactsUpload(); return; }
      btn.disabled = true;
      try { await contactsParse(); }
      catch (err) { contactsStatus('Ошибка чтения: ' + (err.message || err)); contactsParsed = null; }
      finally { btn.disabled = false; }
    });

    // Поставщики (управление, только админ)
    $('menuSuppliers').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      renderSuppliersManager();
      openSheet('suppliersManageSheet');
    });
    $('btnAddSupplier').addEventListener('click', addSupplier);
    $('newSupplierName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSupplier(); } });
    $('suppliersManageList').addEventListener('change', (e) => {
      const row = e.target.closest('.group-row');
      if (row && e.target.classList.contains('supplier-name')) renameSupplier(row.dataset.id, e.target.value);
    });
    $('suppliersManageList').addEventListener('click', (e) => {
      const contact = e.target.closest('.sup-contact-btn');
      if (contact) { openContactForm(contact.closest('.group-row').dataset.id); return; }
      const del = e.target.closest('.group-del');
      if (del) deleteSupplier(del.closest('.group-row').dataset.id);
    });

    // Возврат на вкладку — обновляем каталог, если данные старше 5 минут; и продолжаем автопоиск фото
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (sb && Date.now() - state.lastFetch > 5 * 60 * 1000) refresh({ silent: true }).then(renderAll);
      if (isOwner()) setTimeout(autoPhotoSearch, 2000);
    });
    window.addEventListener('online', () => { if (isOwner()) setTimeout(autoPhotoSearch, 2000); });
  }

  /* ── Старт ────────────────────────────────────── */

  async function init() {
    deviceId(); // закрепляем анонимный номер устройства (память избранного/просмотров)
    initTheme();
    loadFilters();
    renderRecent();
    bindEvents();
    showSkeleton();

    // офлайн-копия приложения + установка на главный экран телефона
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* например, локальный запуск с file:// */ });
    }

    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      $('setupBanner').hidden = false;
      $('loader').hidden = true;
      await loadCache();
      renderAll(); // даже с пустым кэшем — покажется понятное пустое состояние
      return;
    }

    if (!window.supabase) {
      // библиотека базы не загрузилась (нет интернета) — показываем сохранённый каталог
      $('loader').hidden = true;
      const banner = $('offlineBanner');
      banner.textContent = (await loadCache())
        ? '📶 Нет связи. Показан сохранённый каталог'
        : '📶 Нет интернета. Подключись к сети и обнови страницу';
      banner.hidden = false;
      renderAll();
      return;
    }

    // вход хранится на устройстве и продлевается сам — до нажатия «Выйти из аккаунта»
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    // мгновенно показываем сохранённый каталог, затем тихо обновляем из базы
    if (await loadCache()) renderAll();

    sb.auth.getSession().then(({ data }) => applySession(data.session));
    // setTimeout — запросы к базе нельзя делать прямо внутри колбэка onAuthStateChange
    sb.auth.onAuthStateChange((_e, session) => { setTimeout(() => applySession(session), 0); });

    await refresh();
    openFromHash(); // если открыли по ссылке на товар — показываем его
  }

  init();

  // для автотестов разбора 1С-файлов (не влияет на работу приложения)
  window.__catalogTest = { detectColumns, parsePriceReport, mergeBarcodesReport, parseSalesReport, parseDateCell, parsePhotoSheet, categoryOf };
})();
