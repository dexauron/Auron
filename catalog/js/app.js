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

  function openSheet(id) {
    const el = $(id);
    if (!el || !el.hidden) return; // нет элемента или уже открыт
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    sheetStack.push(id);
    // history-запись: кнопка «назад» на телефоне закроет это окно, а не выйдет из приложения
    try { history.pushState({ wmSheet: id }, ''); } catch (e) { /* некритично */ }
  }

  function hideSheet(id) { // фактическое скрытие, без истории
    const el = $(id);
    if (!el) return;
    el.hidden = true;
    const i = sheetStack.lastIndexOf(id);
    if (i >= 0) sheetStack.splice(i, 1);
    if (!sheetStack.length) document.body.style.overflow = '';
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
    if (sheetStack.length) hideSheet(sheetStack[sheetStack.length - 1]); // «назад» на телефоне → закрыть верхнее окно
  });

  // Стрелка «назад» в левом верхнем углу каждого окна
  function addBackButtons() {
    document.querySelectorAll('.sheet').forEach((sheet) => {
      const bd = sheet.closest('.sheet-backdrop');
      if (!bd || sheet.querySelector('.sheet-back')) return;
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

  function visibleProducts() {
    let list = state.products;
    const { selCats, selGroups, selSuppliers } = state;
    // фильтр по группам/категориям — объединение всех отметок
    if (selCats.length || selGroups.length) {
      list = list.filter((p) => {
        if (selGroups.includes('none') && !p.group_id) return true;
        if (selGroups.includes('weighted') && p.is_weighted) return true;
        if (p.group_id && selGroups.includes(p.group_id)) return true;
        if (selCats.length && selCats.includes(productCategory(p))) return true;
        return false;
      });
    }
    // фильтр по поставщикам — объединение (товар от любого отмеченного)
    if (selSuppliers.length) {
      list = list.filter((p) => (p.supplier_ids || []).some((id) => selSuppliers.includes(id)));
    }

    const q = norm(state.query);
    if (!q) return list;
    const qT = translit(q);
    const qVars = q === qT ? [q] : [q, qT];
    // слова запроса — каждое ищется отдельно (в любом порядке)
    const tokens = q.split(/\s+/).filter(Boolean).map((w) => {
      const wt = translit(w);
      return { q: w, qVars: w === wt ? [w] : [w, wt] };
    });
    return list
      .map((p) => ({ p, s: scoreProduct(p, q, qVars, tokens) }))
      .filter((x) => x.s >= SEARCH_THRESHOLD)
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name, 'ru'))
      .map((x) => x.p);
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
    const anyFilter = selCats.length || selGroups.length || selSuppliers.length;
    const allActive = !selCats.length && !selGroups.length;
    let html = `<button class="chip${allActive ? ' active' : ''}" data-all>Все<span class="chip-count">${state.products.length}</span></button>`;
    if (anyFilter) html += '<button class="chip chip-reset" data-reset>✕ Сбросить</button>';
    if (state.suppliers.length) {
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

    if (!list.length) {
      grid.innerHTML = '';
      const empty = $('emptyState');
      empty.hidden = false;
      if (!state.products.length) {
        empty.querySelector('.empty-icon').textContent = '📦';
        empty.querySelector('.empty-title').textContent = 'Каталог пока пустой';
        empty.querySelector('.empty-text').textContent = state.session
          ? 'Нажми ＋ внизу, чтобы добавить первый товар'
          : 'Администратор скоро его заполнит';
      } else {
        empty.querySelector('.empty-icon').textContent = '🔍';
        empty.querySelector('.empty-title').textContent = 'Ничего не нашлось';
        empty.querySelector('.empty-text').textContent = 'Попробуй написать по-другому или выбери группу';
      }
      return;
    }

    $('emptyState').hidden = true;
    // на больших каталогах рисуем страницами — телефон не потянет 15 000 карточек разом
    const shown = list.slice(0, state.renderLimit);
    let html = shown.map((p) => {
      const photo = (p.photos || [])[0];
      const img = photo
        ? `<img src="${esc(photo)}" alt="" loading="lazy">`
        : '📦';
      const photoCls = photo ? 'card-photo' : 'card-photo no-photo';
      const tags = [];
      if (p.code) tags.push(`<span class="tag tag-code">Код ${esc(p.code)}</span>`);
      if (p.is_weighted) tags.push('<span class="tag">⚖ весовой</span>');
      else if (p.unit && norm(p.unit) !== 'шт') tags.push(`<span class="tag">📏 ${esc(p.unit)}</span>`);
      const sup = supplierById((p.supplier_ids || [])[0]);
      if (sup) tags.push(`<span class="tag">🚚 ${esc(sup.name)}</span>`);
      if (p.department) tags.push(`<span class="tag">Отдел ${esc(p.department)}</span>`);
      if (!(p.barcodes || []).length) tags.push('<span class="tag tag-nobarcode">без штрихкода</span>');
      const price = (p.retail_price != null && p.retail_price !== '')
        ? `<div class="card-price">${esc(fmtPrice(p.retail_price))}</div>` : '';
      return `<article class="card" data-id="${esc(p.id)}">
        <div class="${photoCls}">${img}</div>
        <div class="card-body">
          <div class="card-name">${esc(p.name)}</div>
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

  function renderAll() { renderChips(); renderGrid(); }

  /* ── Карточка товара ──────────────────────────── */

  function openProduct(p) {
    currentProduct = p;
    $('sheetName').textContent = p.name;

    const photos = p.photos || [];
    $('sheetPhotos').innerHTML = photos.length
      ? photos.map((u) => `<img src="${esc(u)}" alt="">`).join('')
      : '<div class="photo-placeholder">📦</div>';
    $('sheetDots').innerHTML = photos.length > 1
      ? photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')
      : '';
    $('sheetPhotos').scrollLeft = 0;

    const badges = [];
    const g = groupById(p.group_id);
    if (g) badges.push(`<span class="tag">${esc(g.name)}</span>`);
    if (p.is_weighted) badges.push('<span class="tag">⚖ Весовой товар</span>');
    if (p.unit) badges.push(`<span class="tag">📏 Продаётся: ${esc(p.unit)}</span>`);
    const barcodes = p.barcodes || [];
    if (!barcodes.length) badges.push('<span class="tag tag-nobarcode">⚠ Штрихкода нет — пробивать по коду</span>');
    $('sheetBadges').innerHTML = badges.join('');

    // поставщики и цены — единым списком ниже (renderProductPrices); отдельный блок не нужен
    $('sheetSupplier').innerHTML = '';

    const rows = [];
    // розничная цена (цена на полке) — видна всем, крупно вверху
    if (p.retail_price != null && p.retail_price !== '') {
      rows.push(`<div class="field-row field-main"><span class="field-key">Розничная цена</span><span class="field-val">${esc(fmtPrice(p.retail_price))}</span></div>`);
    }
    if (p.code) rows.push(fieldRow('Код кассы', p.code, true));
    if (p.article) rows.push(fieldRow('Артикул', p.article, false, true));
    barcodes.forEach((b, i) => rows.push(fieldRow(barcodes.length > 1 ? `Штрихкод ${i + 1}` : 'Штрихкод', b, false, true)));
    if (p.department) rows.push(fieldRow('Отдел', p.department));
    if (p.note) rows.push(`<div class="field-row"><span class="field-key">Примечание</span><span class="field-val" style="font-weight:400;font-size:14px">${esc(p.note)}</span></div>`);
    if (!rows.length) rows.push('<div class="field-row"><span class="field-key">Коды не указаны</span></div>');
    $('sheetFields').innerHTML = rows.join('');

    $('sheetAdminActions').hidden = !state.isAdmin;
    $('btnFindPhoto').hidden = !(state.isAdmin && !(p.photos || []).length && (p.barcodes || []).length);
    $('btnAddPhotoLabel').hidden = !state.session; // фото может добавить любой вошедший
    renderProductSales(p);
    renderProductPrices(p);
    renderCompetitors(p);
    openSheet('productSheet');
  }

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
    if (!state.session) { renderCardSuppliers(p, [], baseSupIds, { locked: true }); return; }
    // кассир видит только розничную цену — закупочные цены поставщиков ему не показываем
    if (!state.canPurchase) { box.innerHTML = ''; return; }
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

  async function refresh({ silent = false } = {}) {
    try {
      await fetchSmall();
      if (!state.products.length || !state.syncMax) await fullLoadProducts();
      else await deltaSyncProducts();
      state.lastFetch = Date.now();
      saveCache();
      $('offlineBanner').hidden = true;
      renderAll();
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
      const blob = await compressImage(file);
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

  async function uploadPhoto(blob) {
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
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

  function impStatus(msg) {
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

      const withCode = [];
      const noCodeUpdate = []; // товары без кода, найденные в базе → обновляем по id
      const noCodeInsert = [];
      const noCodeInsertItems = [];
      for (const i of items) {
        const base = {
          name: i.name,
          article: i.article,
          group_id: i.group ? groupMap.get(norm(i.group)) : null,
          supplier_ids: [...i.suppliers].map((s) => supMap.get(norm(s))).filter(Boolean),
          barcodes: [...i.barcodes],
          is_weighted: i.weighted,
          unit: i.unit,
          updated_at: new Date().toISOString(),
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
      const today = new Date().toISOString().slice(0, 10);
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

  const PHOTO_CHECKED_KEY = 'wm_photo_checked_v1'; // штрихкоды, по которым фото уже искали и не нашли
  let photoSearchRunning = false;

  const photoCandidates = () =>
    state.products.filter((p) => (p.barcodes || []).length && !(p.photos || []).length);

  async function offLookup(bc) {
    for (const host of ['world.openfoodfacts.org', 'world.openbeautyfacts.org']) {
      try {
        const r = await fetch(`https://${host}/api/v2/product/${encodeURIComponent(bc)}.json?fields=image_front_url`);
        if (r.ok) {
          const d = await r.json();
          const url = d.product && d.product.image_front_url;
          if (url) return url;
        }
      } catch (e) { /* сеть моргнула — товар проверим в следующий раз */ }
      await new Promise((res) => setTimeout(res, 500)); // вежливый темп к бесплатной базе
    }
    return null;
  }

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
    const todo = photoCandidates().filter((p) => !checked[(p.barcodes || [])[0]]);
    if (!todo.length) return;
    photoSearchRunning = true;
    const save = () => { try { localStorage.setItem(PHOTO_CHECKED_KEY, JSON.stringify(checked)); } catch (e) { /* некритично */ } };
    toast(`🔎 Ищу фото товаров в фоне (${todo.length})…`);
    let done = 0;
    let found = 0;
    for (const p of todo) {
      if (!isOwner() || document.hidden || !navigator.onLine) break; // тихо приостановиться
      const bc = p.barcodes[0];
      try {
        const url = await offLookup(bc);
        if (url) { await attachFoundPhoto(p, url); found++; if (found % 6 === 0) { saveCache(); renderGrid(); } }
        else checked[bc] = 1;
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
    const todo = photoCandidates().filter((p) => !checked[(p.barcodes || [])[0]]);
    const status = (msg) => { const el = $('photoSearchStatus'); el.hidden = false; el.textContent = msg; };
    let done = 0;
    let found = 0;
    status(`Будем проверять: ${todo.length} товаров со штрихкодом и без фото`);
    for (const p of todo) {
      if (!photoSearchRunning || $('photoSearchSheet').hidden) break;
      const bc = p.barcodes[0];
      try {
        const url = await offLookup(bc);
        if (url) { await attachFoundPhoto(p, url); found++; }
        else checked[bc] = 1;
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

  function photoExcelStatus(msg) { const el = $('photoExcelStatus'); el.hidden = false; el.textContent = msg; }

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

  function contactsStatus(msg) { const el = $('contactsStatus'); el.hidden = false; el.textContent = msg; }

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

  function stockStatus(msg) { const el = $('stockStatus'); el.hidden = false; el.textContent = msg; }

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
      const updates = []; const inserts = [];
      for (const r of recs) {
        const pid = (r.code && byCode.get(r.code))
          || (r.barcode && byBarcode.get(String(r.barcode).trim()))
          || byName.get(norm(r.name));
        if (pid) {
          // name обязательно (NOT NULL): если id вдруг устарел и строка вставится,
          // а не обновится — не упадём на пустом имени
          const u = { id: pid, name: r.name, stock_qty: r.stock, stock_at: at, updated_at: new Date().toISOString() };
          if (r.retail != null) u.retail_price = r.retail; // не затираем, если цены нет
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

  // загруженные периоды продаж — чипами, по ним и смотрим топ
  async function renderTopPeriods() {
    const box = $('topChips');
    let periods = [];
    try {
      const { data, error } = await sb.rpc('catalog_sales_periods');
      if (error) throw error;
      periods = data || [];
    } catch (e) {
      box.innerHTML = '';
      $('topList').innerHTML = '<p class="muted">Не получилось прочитать продажи. Если база старой версии — выполни setup/ВСЕ-ОБНОВЛЕНИЯ.sql</p>';
      return;
    }
    if (!periods.length) {
      box.innerHTML = '';
      $('topList').innerHTML = '<p class="muted">Продажи ещё не загружены. Меню админа → «📈 Импорт продаж» — загрузи отчёт «Продажи» из 1С.</p>';
      return;
    }
    box.innerHTML = periods.map((p, i) =>
      `<button class="chip${i === 0 ? ' active' : ''}" data-from="${esc(p.period_from)}" data-to="${esc(p.period_to)}">${fmtDate(p.period_from)}–${fmtDate(p.period_to)}</button>`).join('');
    loadTopProducts();
  }

  async function loadTopProducts() {
    const chip = document.querySelector('#topChips .chip.active');
    if (!chip) return;
    const from = chip.dataset.from;
    const to = chip.dataset.to;
    const days = daysBetween(from, to);
    const box = $('topList');
    box.innerHTML = '<p class="muted">Считаем…</p>';
    const { data, error } = await sb.rpc('catalog_top_products', { p_from: from, p_to: to, p_limit: 300 });
    if (error) { box.innerHTML = '<p class="muted">Не получилось посчитать: ' + esc(error.message || '') + '</p>'; return; }
    if (!data || !data.length) { box.innerHTML = '<p class="muted">За этот период продаж нет</p>'; return; }
    const byId = new Map(state.products.map((p) => [p.id, p]));
    const rnd = (n) => (n % 1 ? Math.round(n * 10) / 10 : n);
    box.innerHTML = `<p class="muted top-period-note">За ${fmtDate(from)}–${fmtDate(to)} · ${days} дн.</p>` + data.map((row, i) => {
      const p = byId.get(row.product_id);
      if (!p) return '';
      const photo = (p.photos || [])[0];
      const qty = Number(row.total_qty);
      const perDay = rnd(qty / days);
      const u = p.unit || 'шт';
      const amt = row.total_amount != null ? `<span class="top-amt">${fmtPrice(row.total_amount)}</span>` : '';
      return `<div class="top-row" data-id="${esc(p.id)}">
        <span class="top-rank">${i + 1}</span>
        <span class="top-photo">${photo ? `<img src="${esc(photo)}" loading="lazy" alt="">` : '📦'}</span>
        <span class="top-name">${esc(p.name)}</span>
        <span class="top-qty">${rnd(qty)} ${esc(u)}<span class="top-amt">≈${perDay}/день</span>${amt}</span>
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

  async function scanNative(done) {
    const box = $('scanContainer');
    box.innerHTML = '';
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    box.appendChild(video);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false,
    });
    let active = true;
    scanStopFn = () => {
      active = false;
      stream.getTracks().forEach((t) => t.stop());
      box.innerHTML = '';
    };
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const tick = async () => {
      if (!active) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) { done(codes[0].rawValue); return; }
      } catch (e) { /* кадр не считался — пробуем дальше */ }
      setTimeout(tick, 250);
    };
    tick();
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
    const scanner = new window.Html5Qrcode('scanContainer');
    scanStopFn = () => { scanner.stop().then(() => scanner.clear()).catch(() => {}); };
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10 },
      (text) => done(text),
    );
  }

  // сотрудник отсканировал штрихкод → ищем товар
  function scanToSearch(text) {
    const input = $('searchInput');
    input.value = text;
    state.query = text;
    $('searchClear').hidden = false;
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
        renderGrid();
      }, 150);
    });
    $('searchClear').addEventListener('click', () => {
      input.value = '';
      state.query = '';
      state.renderLimit = PAGE_SIZE;
      $('searchClear').hidden = true;
      renderGrid();
      input.focus();
    });

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
      // повторный тап снимает отметку; можно отметить несколько
      if (chip.hasAttribute('data-all')) { state.selCats = []; state.selGroups = []; }
      else if (chip.hasAttribute('data-reset')) { state.selCats = []; state.selGroups = []; state.selSuppliers = []; }
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
        openSheet('adminMenuSheet');
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

    // Фото из Excel по ссылкам (только админ)
    $('menuPhotoExcel').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      photoExcelParsed = null;
      $('photoExcelRun').textContent = 'Проверить файл';
      $('photoExcelStatus').hidden = true;
      $('photoExcelName').textContent = '';
      openSheet('photoExcelSheet');
    });
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
    $('menuPhotoSearch').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
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
        const url = await offLookup(p.barcodes[0]);
        if (!url) {
          toast('В открытой базе фото этого товара нет — добавь своё через ✏️ Изменить');
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

    // Импорт из 1С (только админ)
    $('menuImport').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      impParsed = null;
      $('impRun').textContent = 'Проверить файлы';
      $('impStatus').hidden = true;
      openSheet('importSheet');
    });
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
    $('topChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#topChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      loadTopProducts();
    });
    $('topList').addEventListener('click', (e) => {
      const row = e.target.closest('.top-row');
      if (!row) return;
      const p = state.products.find((x) => x.id === row.dataset.id);
      if (p) { closeSheet('topSheet'); openProduct(p); }
    });

    // Импорт продаж (только админ)
    $('menuSalesImport').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      salesParsed = null;
      $('salesRun').textContent = 'Проверить файл';
      $('salesStatus').hidden = true;
      openSheet('salesImportSheet');
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

    // Импорт остатков (только админ)
    $('menuStockImport').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      stockParsed = null;
      $('stockRun').textContent = 'Проверить файл';
      $('stockStatus').hidden = true;
      $('stockFileName').textContent = '';
      openSheet('stockImportSheet');
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

    // Импорт контактов поставщиков (только админ)
    $('menuContactsImport').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      contactsParsed = null;
      $('contactsRun').textContent = 'Проверить файл';
      $('contactsStatus').hidden = true;
      $('contactsFileName').textContent = '';
      openSheet('contactsImportSheet');
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
    bindEvents();

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
  }

  init();

  // для автотестов разбора 1С-файлов (не влияет на работу приложения)
  window.__catalogTest = { detectColumns, parsePriceReport, mergeBarcodesReport, parseSalesReport, parseDateCell, parsePhotoSheet, categoryOf };
})();
