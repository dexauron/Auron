// Общее состояние каталога и сохранение на устройстве

/* Каталог товаров для сотрудников магазина (название магазина — в js/config.js).
 * Сервера нет: витрина лежит файлом на сайте, полный каталог — в зашифрованном
 * файле в репозитории. Здесь общее состояние и хранение на устройстве. */

export const $ = (id) => document.getElementById(id);
export const CFG = window.CATALOG_CONFIG || {};
export const CACHE_KEY = 'wm_catalog';       // ключ в IndexedDB
export const SEARCH_THRESHOLD = 25;
// Доля от лучшего совпадения, ниже которой результат считаем мусором.
// Пример: нашлось точное «Молоко» (100) — товары из группы «Молочные» (45)
// уже не показываем. Но если хорошего нет, слабые остаются: пустая выдача хуже.
export const RELATIVE_CUTOFF = 0.6;

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
export async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const PAGE_SIZE = 80; // карточек на экране до кнопки «Показать ещё»

// Общее изменяемое состояние интерфейса. Отдельным объектом, а не набором
// переменных: модули не могут присваивать чужим переменным, а полю объекта — могут.
export const ui = {
  secretPw: null,
  currentProduct: null,
  editingProduct: null,
  formPhotos: [],
  formSupplierIds: [],
  openCat: null,
  cardSuppliers: {},
  cardSales: null,
  compFilter: { store: '', from: '', to: '' },
  compChosenId: null,
  compProduct: null,
  photoFillTarget: null,
  smartEntries: [],
  photoSearchRunning: false,
  topPeriod: null,
  topMode: 'amount',
  openAdminOrLogin: () => {},
  calcProduct: null,
  lastMissing: [],
  dedupRunning: false,
};

export const state = {
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
  canPurchase: false, // видят закупочные цены и контакты
  canSales: false,  // видят «Ходовые товары» (продажи/выручка) — только владелец
  serverless: false, // режим без сервера (каталог на GitHub)
  staffPassword: null, // пароль сотрудника (задаёт владелец; хранится в его каталоге)
  contacts: {},     // supplier_id → контакты (загружаются после входа)
  competitors: [],  // магазины конкурентов (список названий)
  compPrices: [],   // записанные цены магазинов: {product_id, competitor_id, price, observed_at}
  unitCoef: {},     // словарь единиц: «упак (24)» → 24 базовых единицы
  orders: [],       // заказы поставщикам (у кого, когда, на сколько, кто заказал)
  orderRules: null, // правила заказа: срок доставки, периодичность, страховой запас (в днях)
  lastFetch: 0,
  syncMax: '',      // самый свежий updated_at — для докачки только изменившихся товаров
  showcaseAt: '',   // когда владелец в последний раз опубликовал витрину
  renderLimit: PAGE_SIZE,
  sort: 'relevance',   // relevance | name | cheap | expensive | new
  view: 'normal',      // normal | compact — размер плиток
  quick: [],           // быстрые фильтры: 'withprice'|'barcode'|'nophoto'|'noprice'|'nobarcode'
  priceMin: null,      // диапазон розничной цены (₽)
  priceMax: null,
  selType: '',         // '' | 'weighted' | 'piece' — весовые/штучные (сотрудникам)
  arrivalFrom: '',     // диапазон дат поступления (завоза), ISO YYYY-MM-DD; пусто = без границы
  arrivalTo: '',
  favOnly: false,      // показывать только избранные товары (сердечко)
  tab: 'catalog',      // раздел нижней панели: catalog | cats | fav
  popularity: {},      // id товара → сколько раз открывали (для «Популярное»)
  popularTerms: [],    // частые запросы (обезличенно) — подсказки поиска
};
