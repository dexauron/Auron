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
    groupId: 'all',
    category: null,   // выбранная категория (раздел) — null = показаны все категории
    supplierId: null, // null = все поставщики
    session: null,
    isAdmin: false,   // админ может менять каталог; сотрудник — только смотреть цены и контакты
    contacts: {},     // supplier_id → контакты (загружаются после входа)
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

  function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet(id) {
    $(id).hidden = true;
    if (![...document.querySelectorAll('.sheet-backdrop')].some((s) => !s.hidden)) {
      document.body.style.overflow = '';
    }
    if (id === 'scanSheet') stopScan();
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

  function scoreProduct(p, q, qVars) {
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

    // нечёткий поиск — только если точного совпадения не нашлось (экономит время на больших каталогах)
    if (s < 60 && q.length >= 3) {
      const fuzzy = fuzzyScore(p._name, p._nameT, qVars);
      if (fuzzy >= 0.4) s = Math.max(s, Math.round(65 * fuzzy));
    }
    return s;
  }

  function visibleProducts() {
    let list = state.products;
    if (state.groupId === 'none') list = list.filter((p) => !p.group_id);
    else if (state.groupId === 'weighted') list = list.filter((p) => p.is_weighted);
    else if (state.groupId !== 'all') list = list.filter((p) => p.group_id === state.groupId);
    else if (state.category) list = list.filter((p) => productCategory(p) === state.category);
    if (state.supplierId) list = list.filter((p) => (p.supplier_ids || []).includes(state.supplierId));

    const q = norm(state.query);
    if (!q) return list;
    const qT = translit(q);
    const qVars = q === qT ? [q] : [q, qT];
    return list
      .map((p) => ({ p, s: scoreProduct(p, q, qVars) }))
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

    // ── Верхний ряд: Все · Поставщики · Ходовые · Весовые · категории ──
    const allActive = state.category === null && state.groupId === 'all';
    let html = `<button class="chip${allActive ? ' active' : ''}" data-all>Все<span class="chip-count">${state.products.length}</span></button>`;
    if (state.suppliers.length) {
      const sup = supplierById(state.supplierId);
      const label = sup ? `🚚 ${sup.name}` : '🚚 Поставщики';
      const cnt = sup
        ? state.products.filter((p) => (p.supplier_ids || []).includes(sup.id)).length
        : state.suppliers.length;
      html += `<button class="chip${sup ? ' active' : ''}" data-supplier-chip>${esc(label)}<span class="chip-count">${cnt}</span></button>`;
    }
    if (state.session) html += '<button class="chip" data-top-chip>🔥 Ходовые</button>';
    if (weighted > 0) html += `<button class="chip${state.groupId === 'weighted' ? ' active' : ''}" data-group="weighted">⚖ Весовые<span class="chip-count">${weighted}</span></button>`;

    // категории — по убыванию числа товаров; порядок стабильный
    const cats = [...CATEGORIES.map((c) => c.name), OTHER_CAT.name]
      .filter((c) => catCounts[c])
      .sort((a, b) => catCounts[b] - catCounts[a]);
    for (const c of cats) {
      const active = state.category === c ? ' active' : '';
      html += `<button class="chip${active}" data-category="${esc(c)}">${catIcon(c)} ${esc(c)}<span class="chip-count">${catCounts[c]}</span></button>`;
    }
    if (noGroup > 0) html += `<button class="chip${state.groupId === 'none' ? ' active' : ''}" data-group="none">Без группы<span class="chip-count">${noGroup}</span></button>`;
    $('groupChips').innerHTML = html;

    // ── Нижний ряд: подгруппы выбранной категории ──
    const sub = $('subChips');
    if (!state.category) { sub.hidden = true; sub.innerHTML = ''; return; }
    const subGroups = state.groups
      .filter((g) => categoryOf(g.name) === state.category && groupCounts[g.id])
      .sort((a, b) => (groupCounts[b.id] || 0) - (groupCounts[a.id] || 0));
    let subHtml = `<button class="chip${state.groupId === 'all' ? ' active' : ''}" data-group="all">Все · ${esc(state.category)}<span class="chip-count">${catCounts[state.category] || 0}</span></button>`;
    for (const g of subGroups) subHtml += chipHtml(g.id, g.name, groupCounts[g.id] || 0);
    sub.innerHTML = subHtml;
    sub.hidden = false;
  }

  function chipHtml(id, name, count) {
    const active = state.groupId === id ? ' active' : '';
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
      return `<article class="card" data-id="${esc(p.id)}">
        <div class="${photoCls}">${img}</div>
        <div class="card-body">
          <div class="card-name">${esc(p.name)}</div>
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

    const sups = (p.supplier_ids || []).map(supplierById).filter(Boolean);
    $('sheetSupplier').innerHTML = sups.map((s) => {
      // после входа — контакты поставщика прямо в карточке: позвонить / WhatsApp
      const c = state.contacts[s.id];
      const contact = (state.session && c && (c.phone || c.contact_name))
        ? `<div class="sup-contact-card">${c.contact_name ? `<span class="sup-person">${esc(c.contact_name)}</span>` : ''}${
          c.phone ? `<div class="sup-actions"><a class="btn btn-secondary sup-call" href="${esc(telHref(c.phone))}">📞 ${esc(c.phone)}</a><a class="btn sup-wa" href="${esc(waHref(c.phone))}" target="_blank" rel="noopener">💬 WhatsApp</a></div>` : ''}${
          c.note ? `<div class="sup-note">${esc(c.note)}</div>` : ''}</div>`
        : (state.session ? '<div class="sup-nocontact muted">Контакты не заполнены — добавь в 🚚 Поставщики</div>' : '');
      return `<div class="sup-card">
        <div class="sup-head">🚚 ${esc(s.name)}</div>
        ${contact}
        <button class="btn btn-ghost sup-allbtn" data-supplier-all="${esc(s.id)}">Показать все товары поставщика →</button>
      </div>`;
    }).join('');

    const rows = [];
    if (p.code) rows.push(fieldRow('Код кассы', p.code, true));
    if (p.article) rows.push(fieldRow('Артикул', p.article, false, true));
    barcodes.forEach((b, i) => rows.push(fieldRow(barcodes.length > 1 ? `Штрихкод ${i + 1}` : 'Штрихкод', b, false, true)));
    if (p.department) rows.push(fieldRow('Отдел', p.department));
    if (p.note) rows.push(`<div class="field-row"><span class="field-key">Примечание</span><span class="field-val" style="font-weight:400;font-size:14px">${esc(p.note)}</span></div>`);
    if (!rows.length) rows.push('<div class="field-row"><span class="field-key">Коды не указаны</span></div>');
    $('sheetFields').innerHTML = rows.join('');

    $('sheetAdminActions').hidden = !state.isAdmin;
    $('btnFindPhoto').hidden = !(state.isAdmin && !(p.photos || []).length && (p.barcodes || []).length);
    renderProductSales(p);
    renderProductPrices(p);
    openSheet('productSheet');
  }

  /* ── Продажи товара в карточке (для заказа) ────────
   * После входа: сколько штук продано за 7 и 30 дней и в среднем в день —
   * помогает решить, сколько заказывать. Деньги не показываем — только штуки. */

  const SALES_CACHE_KEY = 'wm_sales_cache_v1';

  function renderSalesBox(p, d7, d30, unit, stale) {
    const perDay = d30 / 30;
    const per = perDay >= 10 ? Math.round(perDay) : Math.round(perDay * 10) / 10;
    const u = unit || 'шт';
    $('sheetSales').innerHTML = `<div class="sales-box">
      <div class="sales-title">Продажи${stale ? ' <span class="sales-stale">· без связи</span>' : ''}</div>
      <div class="sales-nums">
        <div class="sales-cell"><span class="sales-n">${d7}</span><span class="sales-l">за 7 дней</span></div>
        <div class="sales-cell"><span class="sales-n">${d30}</span><span class="sales-l">за 30 дней</span></div>
        <div class="sales-cell"><span class="sales-n">${per}</span><span class="sales-l">${esc(u)}/день</span></div>
      </div>
    </div>`;
  }

  async function renderProductSales(p) {
    const box = $('sheetSales');
    box.innerHTML = '';
    if (!sb || !state.session) return; // продажи — только после входа
    const today = new Date();
    const from30 = isoDay(new Date(today - 29 * 86400000));
    const from7 = isoDay(new Date(today - 6 * 86400000));
    let rows;
    try {
      const { data, error } = await sb.from('catalog_sales')
        .select('sale_date,qty').eq('product_id', p.id).gte('sale_date', from30);
      if (error) throw error;
      rows = data;
    } catch (e) {
      const cached = readCache(SALES_CACHE_KEY)[p.id];
      if (cached && currentProduct === p) renderSalesBox(p, cached.d7, cached.d30, p.unit, true);
      return;
    }
    if (currentProduct !== p) return;
    let d7 = 0;
    let d30 = 0;
    for (const r of rows) {
      const q = Number(r.qty) || 0;
      d30 += q;
      if (r.sale_date >= from7) d7 += q;
    }
    const round = (n) => (n % 1 ? Math.round(n * 10) / 10 : n);
    d7 = round(d7); d30 = round(d30);
    writeCache(SALES_CACHE_KEY, p.id, { d7, d30 }, 400);
    if (!d30) { box.innerHTML = ''; return; } // не продавался за месяц — не мозолим глаза
    renderSalesBox(p, d7, d30, p.unit, false);
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

  /* ── Цены поставщиков в карточке (видны после входа) ── */

  async function renderProductPrices(p) {
    const box = $('sheetPrices');
    if (!sb) { box.innerHTML = ''; return; }
    if (!state.session) {
      box.innerHTML = '<button class="btn btn-secondary btn-block" id="pricesLoginBtn">🔒 Цены поставщиков — вход для сотрудников</button>';
      return;
    }
    box.innerHTML = '<p class="muted">Загружаем цены…</p>';
    let rows;
    try {
      const { data, error } = await sb.from('catalog_prices').select('*')
        .eq('product_id', p.id).order('price_date', { ascending: false });
      if (error) throw error;
      rows = data;
    } catch (e) {
      if (currentProduct !== p) return;
      // нет связи — показываем цены, сохранённые на телефоне (если карточку уже открывали)
      const cached = readPriceCache()[p.id];
      if (cached && cached.rows.length) {
        renderPriceRows(p, cached.rows,
          `⚠ Нет связи — показаны цены, сохранённые ${fmtDate(new Date(cached.ts).toISOString())}`);
      } else {
        box.innerHTML = ''; // база старой версии или кэша нет — блок не показываем
      }
      return;
    }
    if (currentProduct !== p) return; // пока грузили, открыли другой товар
    cachePrices(p.id, rows);
    if (!rows.length) {
      box.innerHTML = '<p class="muted">Цен поставщиков пока нет — появятся после импорта из 1С</p>';
      return;
    }
    renderPriceRows(p, rows);
  }

  function renderPriceRows(p, rows, staleNote) {
    const box = $('sheetPrices');
    // по каждому поставщику: свежая цена + история (строки уже от новых к старым)
    const bySup = new Map();
    for (const r of rows) {
      if (!bySup.has(r.supplier_id)) bySup.set(r.supplier_id, []);
      bySup.get(r.supplier_id).push(r);
    }
    const entries = [...bySup.entries()]
      .map(([id, hist]) => ({
        sup: supplierById(id),
        hist,
        last: hist[0],
        prev: hist.find((h) => Number(h.price) !== Number(hist[0].price)),
      }))
      .filter((e) => e.sup)
      .sort((a, b) => Number(a.last.price) - Number(b.last.price));
    if (!entries.length) { box.innerHTML = ''; return; }
    const best = Number(entries[0].last.price);

    const rowsHtml = entries.map((e) => {
      const isBest = entries.length > 1 && Number(e.last.price) === best;
      let trend = '';
      if (e.prev) {
        const diff = ((Number(e.last.price) - Number(e.prev.price)) / Number(e.prev.price)) * 100;
        const pct = Math.abs(diff) >= 10 ? Math.round(Math.abs(diff)) : Math.round(Math.abs(diff) * 10) / 10;
        trend = diff > 0
          ? `<span class="price-up" title="Цена выросла">↑ ${pct}%</span>`
          : `<span class="price-down" title="Цена снизилась">↓ ${pct}%</span>`;
      }
      const c = state.contacts[e.sup.id];
      const call = c?.phone
        ? `<span class="price-call"><a class="mini-btn" href="${esc(telHref(c.phone))}" title="Позвонить">📞</a><a class="mini-btn" href="${esc(waHref(c.phone))}" target="_blank" rel="noopener" title="WhatsApp">💬</a></span>`
        : '';
      const hist = e.hist.length > 1
        ? `<div class="price-history" hidden>${e.hist.slice(0, 12).map((h) =>
          `<div class="price-hist-row"><span>${fmtDate(h.price_date)}</span><span>${fmtPrice(h.price)}</span></div>`).join('')}</div>`
        : '';
      return `<div class="price-row-wrap">
        <div class="price-row${isBest ? ' price-best' : ''}"${e.hist.length > 1 ? ' data-hist-toggle' : ''}>
          <span class="price-sup">🚚 ${esc(e.sup.name)}${c?.contact_name ? ` <span class="price-contact">· ${esc(c.contact_name)}</span>` : ''}</span>
          <span class="price-val">${fmtPrice(e.last.price)}</span>
          <span class="price-meta">${isBest ? '<span class="price-badge">✓ выгоднее</span>' : ''}${trend}<span class="price-date">от ${fmtDate(e.last.price_date)}</span></span>
          ${call}
        </div>${hist}</div>`;
    }).join('');

    box.innerHTML = `<div class="price-block"><div class="price-title">Цены поставщиков</div>${rowsHtml}`
      + (staleNote ? `<p class="muted price-hint">${esc(staleNote)}</p>` : '')
      + (entries.some((e) => e.hist.length > 1) ? '<p class="muted price-hint">Нажми на строку — покажем историю цены</p>' : '')
      + '</div>';
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
    if (session) {
      try {
        const { data, error } = await sb.from('catalog_admins').select('email');
        if (error) throw error;
        state.isAdmin = data.some((a) => a.email === session.user?.email);
      } catch (e) {
        state.isAdmin = true; // база старой версии (списка админов ещё нет) — прежнее поведение
      }
      loadContacts();
    } else {
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
      if (currentProduct) renderProductPrices(currentProduct);
    }
    renderAll(); // и сетка, и чипы — после входа появляется «🔥 Ходовые»
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
    if (state.groupId === id) state.groupId = 'all';
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
    if (state.supplierId) {
      html += '<button class="btn btn-secondary btn-block" data-pick-supplier="">← Показать всех</button>';
    }
    html += filtered.slice(0, 100).map((s) => {
      // после входа под поставщиком видны контакты: позвонить или написать в WhatsApp
      const c = state.contacts[s.id];
      const contact = c && (c.phone || c.contact_name || c.note)
        ? `<div class="sup-contact">${c.contact_name ? `<span>${esc(c.contact_name)}</span>` : ''}${
          c.phone ? `<a href="${esc(telHref(c.phone))}">📞 ${esc(c.phone)}</a><a href="${esc(waHref(c.phone))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}${
          c.note ? `<div class="sup-note">${esc(c.note)}</div>` : ''}</div>`
        : '';
      return `<div class="sup-row">
        <button class="btn btn-secondary btn-block" data-pick-supplier="${esc(s.id)}">
          🚚 ${esc(s.name)} <span class="chip-count">${counts[s.id] || 0}</span>
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
    let html = '';
    if (state.groupId !== 'all') {
      html += '<button class="btn btn-secondary btn-block" data-pick-group="all">← Показать все товары</button>';
    }
    html += filtered.map((g) => `
      <button class="btn btn-secondary btn-block" data-pick-group="${esc(g.id)}">
        📁 ${esc(g.name)} <span class="chip-count">${counts[g.id] || 0}</span>
      </button>`).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
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
    if (state.supplierId === id) state.supplierId = null;
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
        else if (l.includes('цена')) cols.price ??= c;
        else if (l.includes('количество') || /(^|\s)кол-?во(\s|$)/.test(l)) cols.qty ??= c;
        else if (l.includes('сумма') || l.includes('выручка')) cols.amount ??= c;
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
  function parsePriceNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v > 0 ? v : null;
    const n = parseFloat(String(v).replace(/[\s ]/g, '').replace(',', '.'));
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
        item = { name, code: code || null, article: null, group: null, suppliers: new Set(), barcodes: new Set(), weighted: false, unit: null, prices: new Map() };
        byKey.set(key, item);
      }
      const art = cols.article !== undefined ? cellStr(row[cols.article]) : '';
      const grp = cols.group !== undefined ? cellStr(row[cols.group]) : '';
      const sup = cols.supplier !== undefined ? cellStr(row[cols.supplier]) : '';
      const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
      const unit = cols.unit !== undefined ? cellStr(row[cols.unit]).toLowerCase() : '';
      const price = cols.price !== undefined ? parsePriceNum(row[cols.price]) : null;
      const rowDate = cols.date !== undefined ? parseDateCell(row[cols.date]) : null; // дата последнего поступления
      if (art && !item.article) item.article = art;
      if (grp && !item.group) item.group = grp;
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
    impParsed = items;
    impStatus(`Найдено: ${items.length} товаров, ${groups.size} групп, ${sups.size} поставщиков, ${priceCnt} цен. `
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

      const withCode = [];
      const noCode = [];
      const noCodeItems = []; // параллельно записям — чтобы связать цены с товарами без кода
      for (const i of items) {
        const rec = {
          name: i.name,
          code: i.code,
          article: i.article,
          group_id: i.group ? groupMap.get(norm(i.group)) : null,
          supplier_ids: [...i.suppliers].map((s) => supMap.get(norm(s))).filter(Boolean),
          barcodes: [...i.barcodes],
          is_weighted: i.weighted,
          unit: i.unit,
          updated_at: new Date().toISOString(),
        };
        if (i.code) withCode.push(rec);
        else { noCode.push(rec); noCodeItems.push(i); }
      }

      const idByCode = new Map(); // код товара → id в базе (для загрузки цен)
      let done = 0;
      const total = withCode.length + noCode.length;
      for (let i = 0; i < withCode.length; i += 400) {
        const { data, error } = await sb.from('catalog_products')
          .upsert(withCode.slice(i, i + 400), { onConflict: 'code' })
          .select('id,code');
        if (error) throw error;
        for (const row of data) idByCode.set(row.code, row.id);
        done += Math.min(400, withCode.length - i);
        impStatus(`Загружаем товары… ${done} из ${total}`);
      }
      for (let i = 0; i < noCode.length; i += 400) {
        const chunk = noCode.slice(i, i + 400);
        const { data, error } = await sb.from('catalog_products').insert(chunk).select('id');
        if (error) throw error;
        data.forEach((row, j) => { noCodeItems[i + j]._id = row.id; });
        done += Math.min(400, noCode.length - i);
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

  function parseSalesReport(rows) {
    const det = detectColumns(rows);
    if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура…) в отчёте');
    const { cols, dataStart } = det;
    if (cols.qty === undefined) throw new Error('Не нашёл колонку «Количество» — выгрузи отчёт «Продажи» с количеством');
    const recs = new Map(); // товар × дата → количество и сумма
    const dates = new Set();
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const name = cellStr(row[cols.name]);
      if (!name) continue;
      const qty = parsePriceNum(row[cols.qty]);
      if (qty == null) continue; // итоговые и пустые строки
      const code = cols.code !== undefined ? cellStr(row[cols.code]) : '';
      const date = cols.date !== undefined ? parseDateCell(row[cols.date]) : null;
      const amount = cols.amount !== undefined ? parsePriceNum(row[cols.amount]) : null;
      const key = (code || norm(name)) + '::' + (date || '');
      let rec = recs.get(key);
      if (!rec) {
        rec = { code: code || null, name, date, qty: 0, amount: 0, hasAmount: false };
        recs.set(key, rec);
      }
      rec.qty += qty;
      if (amount != null) { rec.amount += amount; rec.hasAmount = true; }
      if (date) dates.add(date);
    }
    return { recs: [...recs.values()], dates: [...dates].sort(), hasDateCol: cols.date !== undefined };
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
    const { recs, dates, hasDateCol } = salesParsed;
    if (!recs.length) { salesParsed = null; salesStatus('В файле не нашлось строк с продажами'); return; }
    const when = hasDateCol && dates.length
      ? `Даты в файле: ${fmtDate(dates[0])} — ${fmtDate(dates[dates.length - 1])}.`
      : `Колонки с датой в файле нет — все продажи запишутся на ${fmtDate($('salesDate').value || new Date().toISOString().slice(0, 10))}.`;
    salesStatus(`Найдено строк продаж: ${recs.length}. ${when} `
      + 'Проверь и нажми кнопку ещё раз — начнётся загрузка.');
    $('salesRun').textContent = `⬆ Загрузить продажи (${recs.length})`;
  }

  async function salesUpload() {
    const { recs } = salesParsed;
    const btn = $('salesRun');
    btn.disabled = true;
    try {
      const fallbackDate = $('salesDate').value || new Date().toISOString().slice(0, 10);
      const byCode = new Map();
      const byName = new Map();
      for (const p of state.products) {
        if (p.code) byCode.set(p.code, p.id);
        byName.set(norm(p.name), p.id);
      }
      const out = new Map(); // товар в базе × дата → строка для сохранения
      let unmatched = 0;
      for (const r of recs) {
        const pid = (r.code && byCode.get(r.code)) || byName.get(norm(r.name));
        if (!pid) { unmatched++; continue; }
        const date = r.date || fallbackDate;
        const k = pid + '::' + date;
        let row = out.get(k);
        if (!row) { row = { product_id: pid, sale_date: date, qty: 0, amount: null }; out.set(k, row); }
        row.qty += r.qty;
        if (r.hasAmount) row.amount = (row.amount || 0) + r.amount;
      }
      const list = [...out.values()];
      if (!list.length) throw new Error('Ни один товар из отчёта не найден в каталоге — сначала сделай импорт товаров');
      let done = 0;
      for (let i = 0; i < list.length; i += 500) {
        const { error } = await sb.from('catalog_sales')
          .upsert(list.slice(i, i + 500), { onConflict: 'product_id,sale_date' });
        if (error) throw error;
        done += Math.min(500, list.length - i);
        salesStatus(`Сохраняем продажи… ${done} из ${list.length}`);
      }
      salesStatus(`Готово! Продажи сохранены: ${list.length} ✓`
        + (unmatched ? ` Не найдено в каталоге: ${unmatched} товаров (обнови импорт товаров и повтори).` : '')
        + ' Смотри «🔥 Ходовые товары» в меню.');
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

  /* ── Ходовые товары (после входа) ─────────────── */

  const isoDay = (d) => d.toISOString().slice(0, 10);

  function topPeriodDates(kind) {
    const now = new Date();
    const to = isoDay(now);
    if (kind === 'day') return [to, to];
    if (kind === 'week') return [isoDay(new Date(now - 6 * 86400000)), to];
    if (kind === 'month') return [isoDay(new Date(now - 29 * 86400000)), to];
    return [$('topFrom').value, $('topTo').value]; // свой период
  }

  async function loadTopProducts() {
    const kind = document.querySelector('#topChips .chip.active')?.dataset.topPeriod || 'week';
    const [from, to] = topPeriodDates(kind);
    const box = $('topList');
    if (!from || !to) { box.innerHTML = '<p class="muted">Выбери обе даты</p>'; return; }
    box.innerHTML = '<p class="muted">Считаем…</p>';
    const { data, error } = await sb.rpc('catalog_top_products', { p_from: from, p_to: to, p_limit: 200 });
    if (error) {
      box.innerHTML = '<p class="muted">Не получилось посчитать: ' + esc(error.message || '')
        + '. Если база старой версии — выполни setup/ОБНОВЛЕНИЕ-3.sql</p>';
      return;
    }
    if (!data || !data.length) {
      box.innerHTML = '<p class="muted">Продаж за этот период нет. Админ загружает их через «📈 Импорт продаж» в меню</p>';
      return;
    }
    const byId = new Map(state.products.map((p) => [p.id, p]));
    box.innerHTML = data.map((row, i) => {
      const p = byId.get(row.product_id);
      if (!p) return '';
      const photo = (p.photos || [])[0];
      const qty = Number(row.total_qty);
      const qtyStr = (qty % 1 ? qty.toFixed(1) : qty) + ' ' + (p.unit || 'шт');
      const amt = row.total_amount != null ? `<span class="top-amt">${fmtPrice(row.total_amount)}</span>` : '';
      return `<div class="top-row" data-id="${esc(p.id)}">
        <span class="top-rank">${i + 1}</span>
        <span class="top-photo">${photo ? `<img src="${esc(photo)}" loading="lazy" alt="">` : '📦'}</span>
        <span class="top-name">${esc(p.name)}</span>
        <span class="top-qty">${esc(qtyStr)}${amt}</span>
      </div>`;
    }).join('');
  }

  function openTopSheet() {
    const now = new Date();
    if (!$('topTo').value) $('topTo').value = isoDay(now);
    if (!$('topFrom').value) $('topFrom').value = isoDay(new Date(now - 29 * 86400000));
    openSheet('topSheet');
    loadTopProducts();
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
      if (chip.hasAttribute('data-all')) { state.category = null; state.groupId = 'all'; }
      else if (chip.hasAttribute('data-category')) { state.category = chip.dataset.category; state.groupId = 'all'; }
      else { state.groupId = chip.dataset.group; if (state.groupId !== 'all') state.category = null; }
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // подгруппы выбранной категории
    $('subChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.groupId = chip.dataset.group; // 'all' = вся категория
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // выбор поставщика в списке (+ живой поиск по списку)
    $('supplierList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-supplier]');
      if (!btn) return;
      state.supplierId = btn.dataset.pickSupplier || null;
      state.renderLimit = PAGE_SIZE;
      closeSheet('supplierSheet');
      renderAll();
    });
    $('supplierSearch').addEventListener('input', renderSupplierList);

    // выбор группы в полном списке (+ живой поиск)
    $('groupsPickList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-group]');
      if (!btn) return;
      state.groupId = btn.dataset.pickGroup;
      state.renderLimit = PAGE_SIZE;
      closeSheet('groupsPickSheet');
      renderAll();
    });
    $('groupsPickSearch').addEventListener('input', renderGroupsPick);

    // «все товары поставщика» из карточки товара
    $('sheetSupplier').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-supplier-all]');
      if (!btn) return;
      state.supplierId = btn.dataset.supplierAll;
      state.groupId = 'all';
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

    // Закрытие шторок: крестики, кнопки, тап по фону
    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => closeSheet(b.dataset.close)));
    $('sheetClose').addEventListener('click', () => closeSheet('productSheet'));
    document.querySelectorAll('.sheet-backdrop').forEach((bd) =>
      bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(bd.id); }));

    // Вход: одна форма для всех, права определяются по аккаунту.
    // Сотрудник вводит только пароль магазина. Админ — свой пароль: email
    // спрашивается один раз, дальше хранится на устройстве и подставляется сам.
    const ADMIN_EMAIL_KEY = 'wm_admin_email';

    function openLogin() {
      // email виден сразу, только если вход сотрудников не настроен в config.js
      $('loginEmailWrap').hidden = !!CFG.STAFF_EMAIL;
      $('loginError').hidden = true;
      openSheet('loginSheet');
    }

    $('adminBtn').addEventListener('click', () => {
      if (state.session) {
        $('menuTitle').textContent = state.isAdmin ? 'Администратор' : 'Сотрудник';
        $('adminEmail').textContent = state.isAdmin
          ? (state.session.user?.email || '')
          : 'Вход выполнен — цены и контакты поставщиков открыты';
        $('menuAdminOnly').hidden = !state.isAdmin;
        openSheet('adminMenuSheet');
      } else {
        openLogin();
      }
    });

    // цены в карточке: 🔒 открывает вход, тап по строке — историю цены
    $('sheetPrices').addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // позвонить / WhatsApp — обычные ссылки
      if (e.target.closest('#pricesLoginBtn')) { openLogin(); return; }
      const row = e.target.closest('[data-hist-toggle]');
      if (row) {
        const hist = row.parentElement.querySelector('.price-history');
        if (hist) hist.hidden = !hist.hidden;
      }
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
        if (CFG.STAFF_EMAIL) emails.push(CFG.STAFF_EMAIL);
        const savedAdmin = localStorage.getItem(ADMIN_EMAIL_KEY);
        if (savedAdmin && savedAdmin !== CFG.STAFF_EMAIL) emails.push(savedAdmin);
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

    // Ходовые товары (после входа)
    $('menuTop').addEventListener('click', () => { closeSheet('adminMenuSheet'); openTopSheet(); });
    $('topChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-top-period]');
      if (!chip) return;
      document.querySelectorAll('#topChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      $('topCustom').hidden = chip.dataset.topPeriod !== 'custom';
      loadTopProducts();
    });
    $('topFrom').addEventListener('change', loadTopProducts);
    $('topTo').addEventListener('change', loadTopProducts);
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
      if (!$('salesDate').value) $('salesDate').value = new Date().toISOString().slice(0, 10);
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

    // Возврат на вкладку — обновляем каталог, если данные старше 5 минут
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && sb && Date.now() - state.lastFetch > 5 * 60 * 1000) {
        refresh({ silent: true }).then(renderAll);
      }
    });
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
