/* ============================================================================
   Хранилище оперативных журналов и настроек магазина.
   Всё лежит в браузере (localStorage) — интернет не нужен.
   Выгрузки 1С здесь НЕ хранятся: они большие и читаются из папки заново.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Ключ, под которым база лежит в браузере. Имя нейтральное: программа
     не привязана к одному магазину. Старый ключ читается при первом запуске
     и переносится сюда — записи, накопленные до переименования, не пропадут. */
  var KEY = 'store_erp_v1';
  var OLD_KEYS = ['waymarket_erp_v1'];

  var DEFAULT_SETTINGS = {
    /* --- Магазин ------------------------------------------------------- */
    /* Название магазина владелец вписывает при первом запуске. Пусто —
       значит программа ещё не настроена и предложит быструю настройку. */
    storeName: '',
    legalName: '', inn: '', address: '', phone: '',
    workMode: 'Круглосуточно',
    tills: 'Касса 1, Касса 2',          // сколько денежных ящиков в магазине
    shiftNames: 'День, Ночь',
    dayStart: '09:00', nightStart: '21:00',

    /* --- Начальные остатки: с чего программа начинает считать ----------
       Их вписывают один раз, при запуске. Без них остаток наличных и долг
       поставщикам начнутся с нуля, а не с того, что есть на самом деле. */
    openSafeStart: 0,       // сколько наличных в сейфе на старте
    openDebtStart: 0,       // сколько уже должны поставщикам на старте

    /* --- Пороги, по которым программа предупреждает --------------------- */
    diffCrit: 1000,         // расхождение кассы, после которого это ЧП
    cashLimit: 0,           // наличных у владельца больше этого — пора отвезти в банк
    collectTo: 'Сейф',      // куда обычно увозят инкассацию: Сейф или Банк

    /* --- Как магазин ведёт учёт ----------------------------------------
       В каждом магазине по-своему, поэтому это не зашито, а выбирается.
       Значения по умолчанию — самые простые: меньше полей, меньше работы. */
    /* --- Насколько подробно показывать каждый раздел --------------------
       Владелец сказал прямо: функции нравятся, убирать нечего, но «когда
       куча информации перед глазами, фокус теряется». Поэтому подробность
       не отрезает возможности, а решает, ЧТО показать сразу.

       Уровень свой у каждого раздела: по деньгам можно вести подробно, а по
       товарам — просто. Экран, спрятанный уровнем, никуда не девается:
       он находится поиском и командной палитрой. */
    levelMoney: 'обычно',        // просто · обычно · подробно
    levelGoods: 'обычно',
    levelPeople: 'обычно',
    levelReports: 'обычно',

    shiftMode: 'по кассам',      // «по кассам» или «одной записью за день»
    countMode: 'суммой',         // как вписывать полученное: «суммой» или «по купюрам»
    shortAction: 'показывать',   // недостача: «показывать» или «спрашивать»
    bankCheck: 'не сверять',     // безнал: «не сверять», «каждый день», «раз в месяц»
    debtMode: 'общей суммой',    // долг поставщику: «по накладным» или «общей суммой»
    salaryMode: 'просто',        // зарплата: «просто» или «с табелем»
    ownFunds: 'да',              // считать ли долг магазина перед владельцем
    debtChecked: {},        // долг, названный поставщиками при сверке, по месяцам
    ownerMode: 'месяц',     // отчёт собственнику: за месяц или за день
    ownerDay: '',           // какой день смотрим, если режим «за день»
    debtWarn: 200000,       // долг поставщикам: внимание
    debtCrit: 500000,       // долг поставщикам: критично
    dueWarn: 7,             // за сколько дней напоминать о выплате
    debtorOldDays: 30,      // с какого возраста долг покупателя считается старым

    /* --- Справочники: подставляются в формах ---------------------------- */
    /* Статьи расходов. Закупа, оплаты поставщикам и инкассации здесь НЕТ и
       быть не должно: это не траты магазина, у них свои формы и свои
       формулы. Иначе одни и те же деньги попадут в прибыль дважды. */
    /* Статьи расходов продуктового магазина. Владелец добавляет свои
       в справочнике — эти просто чаще всего нужны. */
    finCategories: 'ЗП, Аренда, Коммунальные, Интернет и связь, Охрана, Вывоз мусора, ' +
      'Налоги, Комиссия банка, Обед, ГСМ, Расходники, Ремонт и обслуживание, ' +
      'Списания, Реклама, Прочее',
    finSources: 'Из ящика, Из сейфа, Со счёта',
    finCashiers: '',
    finShifts: 'День, Ночь',
    finMethods: 'Наличные, Карта, СБП, Перевод',
    finSuppliers: '',
    finEmployees: '',
    /* Должности продуктового магазина. Список — только заготовка: свои
       добавляются, лишние убираются в справочнике. У одного человека их
       может быть несколько: в маленьком магазине администратор нередко
       и за кассой стоит, и товар принимает. */
    finPositions: 'Продавец-кассир, Продавец зала, Оператор, Товаровед, ' +
      'Администратор, Старший смены, Уборщица, Грузчик, Бухгалтер, ' +
      'Управляющий, Директор, Владелец',

    /* --- Зарплата кассиров ---------------------------------------------- */
    rateDay: 200,           // ставка дневной смены, ₽/час
    rateNight: 220,         // ставка ночной смены, ₽/час
    shiftHours: 12,
    advanceDay: 25,         // какого числа аванс
    advancePct: 40,         // какую долю начисленного выдаём авансом
    salaryDay: 10,          // какого числа окончательный расчёт
    bonusPlan: 0,           // премия за выполнение плана выручки, ₽
    marginManual: 25,       // наценка для расчёта безубыточности, %
    lateGrace: 5,           // опоздание до стольких минут не считаем опозданием
    /* Сколько выручки магазин вправе тратить на товар. Всё, что выше, съедает
       то, из чего платят аренду, зарплату и налоги. 75% — обычная планка для
       продуктового; владелец меняет под себя. */
    purchaseLimitPct: 75,

    /* --- Запас товара: через сколько заказывать и сколько держать ------
       Эти числа в каждом магазине свои: у одного поставщик едет два дня,
       у другого неделю. Раньше они были зашиты в расчёт и поменять их
       было нельзя — теперь это обычные настройки. */
    leadDays: 2,            // через сколько дней приезжает заказ
    safetyPct: 30,          // страховой запас сверх расхода за срок поставки, %
    coverDays: 0,           // на сколько дней вперёд держим запас. 0 — только страховой

    /* --- Залежавшийся товар -------------------------------------------- */
    deadDays: 60,           // не завозили столько дней — товар под подозрением
    deadSoldPct: 20,        // и продали меньше этой доли остатка, %

    /* --- Сроки годности и уценка ---------------------------------------- */
    fefoWarn: 5,            // дней до конца срока: пора двигать в первую линию
    fefoCrit: 2,            // дней до конца срока: уценка, иначе списание
    discountWarn: 15,       // на сколько уценять при «внимание», %
    discountCrit: 30,       // на сколько уценять при «критично», %

    /* --- Налоги (прикидочно, для понимания порядка суммы) --------------- */
    taxMode: 'УСН 6% (доходы)', taxRate: 6, patentMonth: 0,
    legalForm: 'ИП',        // ИП или ООО: от этого зависят сроки и взносы за себя
    patentSum: 0,           // патент за год, ₽. 0 — посчитаем как «патент в месяц» × 12
    ipFixed: 53658,         // фиксированные страховые взносы ИП за себя, ₽ в год

    /* --- Постоянные расходы: для прикидки, сколько надо заработать ------ */
    fot: 280000, rent: 110000, utilities: 35000, taxes: 40000, other: 0,
    planRevenue: 0,

    /* --- Данные и копии -------------------------------------------------- */
    keepBackups: 30, backupEveryHours: 24, autoSyncSeconds: 3,
    /* НОЛЬ — ЗНАЧИТ НЕ ОГРАНИЧИВАТЬ, и это не случайность.

       Владелец сказал прямо: «не нужно ограничивать память программы, пусть
       весит хоть гигабайт, хоть четыре — разницы нет. Самое главное, чтобы
       работала стабильно. Не ограничивай программу в памяти, функциях,
       возможностях».

       Раньше здесь стояло 24 месяца, и выгрузки старше двух лет программа
       молча выбрасывала: владелец загружал десять лет, а сезонность за
       восемь из них не видел и не знал почему. Замерено на десяти годах
       (120 файлов, 4 000 товаров в каждом, 480 000 строк):

           разбор всех файлов      2,2 с — но по 18 мс на файл, окно не встаёт
           слить одинаковые товары  0,4 с
           ABC и XYZ               0,9 с
           памяти                  316 МБ

       Это медленнее, чем с обрезкой, но это секунда ожидания, а не потеря
       данных. Кому важнее скорость — ставит число месяцев в настройках. */
    anaKeepMonths: 0,       // 0 — держать все выгрузки. Число — сколько месяцев держать
    bookAutoSave: 'да', bookAutoRead: 'да', writeoffsToMonth: 'да',

    /* --- Доступ ---------------------------------------------------------- */
    askPin: 'нет', lockMinutes: 1,

    /* --- Внешний вид ----------------------------------------------------- */
    /* По умолчанию тёмная и компактная — владелец показал своё второе
       приложение, Auron Finance, и попросил такой же вид. Светлая тема и
       просторный режим никуда не делись, они рядом в настройках. */
    theme: 'Тёмная', themeDayFrom: '07:00', themeNightFrom: '20:00',
    density: 'компактно',
    bigText: 'нет', privacyDefault: 'нет', haptics: 'да',
    acqOn: 'нет', acqCard: '', acqQr: '', acqNfc: '',
    startView: 'Пульт', defaultPeriod: 'Месяц',
    showAllViews: 'нет'      // меню: только рабочие экраны или все сорок
  };

  /* Пять рабочих коллекций — больше учёту магазина не нужно:
       dds       — движение денег: смены, итоги дня, приходы и расходы;
       plans     — план выплат поставщикам (календарь);
       staff     — сотрудники: ставка, оклад, телефон, когда принят и уволен;
       timesheet — табель: кто, когда, сколько часов, премия и штраф;
       payouts   — выданные деньги: аванс и окончательный расчёт;
       debtors   — долги покупателей, бывшая тетрадка у кассы;
       cashcount — пересчёты денег в ящике по купюрам.
     Остальные — служебные: журнал правок, корзина, скрытое в справочниках,
     сохранённые наборы фильтров и шаблоны частых записей. */
  var COLLECTIONS = ['accounts', 'funds', 'budgets', 'dds', 'plans', 'staff', 'timesheet',
    'payouts', 'debtors', 'cashcount', 'log', 'templates', 'dictoff', 'filtersets', 'trash'];

  /* Настоящие журналы — то, что владелец вводит руками и что нельзя потерять.
     Служебное (журнал правок, корзина, шаблоны, наборы фильтров, скрытые
     слова справочников) при сверке версий не учитывается: журнал правок
     растёт от каждой мелочи, и из-за него две одинаковые базы выглядели бы
     разошедшимися. */
  var DATA_COLLECTIONS = ['accounts', 'funds', 'budgets', 'dds', 'plans', 'staff', 'timesheet',
    'payouts', 'debtors', 'cashcount'];

  /* Что считать «записями» в разговоре с владельцем. Счета — это настройка,
     а не записи: сказать «восстановлено 4 записи», когда из них три — это
     заведённые программой касса, сейф и счёт, значит соврать. Сверяться с
     файлом они всё равно должны, поэтому из DATA_COLLECTIONS не убраны. */
  var JOURNALS = ['dds', 'plans', 'staff', 'timesheet', 'payouts', 'debtors', 'cashcount'];

  /* --------------------------------------------------------------------------
     КОНВЕРТЫ — на что магазин откладывает

     Самая частая причина, по которой небольшой магазин внезапно остаётся без
     денег: выручка была, её потратили на товар, а в конце месяца пришли
     аренда, зарплата и налог. Деньги вроде были — и вроде не было.

     Лечится способом, которым люди пользуются веками: откладывать сразу, а
     не в конце. Конверт — это цель («Аренда, 60 000 в месяц») и счёт, куда
     деньги складывают. Отложенное видно отдельно от свободных денег.
     -------------------------------------------------------------------------- */
  function starterFunds(accounts) {
    var safe = (accounts || []).filter(function (a) { return a.kind === 'cash'; })[0];
    var to = safe ? safe.id : '';
    return [
      { name: 'Аренда', plan: 0, account: to, note: 'платим раз в месяц' },
      { name: 'Зарплата', plan: 0, account: to, note: 'чтобы было чем рассчитаться' },
      { name: 'Налоги', plan: 0, account: to, note: 'квартальный платёж' }
    ];
  }

  /* ==========================================================================
     СЧЕТА — где лежат деньги

     Магазин держит деньги в нескольких местах: ящик в зале, сейф, расчётный
     счёт, иногда карта владельца. Раньше мест было ровно три и назывались
     они жёстко. Теперь это обычный справочник: сколько нужно, столько и
     заводите, называйте как привыкли.

     Вид счёта решает, как он участвует в учёте:
       ящик  — денежный ящик в зале. Его остаток правит сверка смены: сколько
               насчитали руками, столько и есть;
       нал   — прочие наличные: сейф, деньги дома. Меняются переводами и
               расходами, пересчёту при закрытии смены не подлежат;
       безнал— расчётный счёт или карта. Сюда падает эквайринг, СБП и оплата
               картой; наличными этих денег никогда не бывает.
     ====================================================================== */
  var ACCOUNT_KINDS = [
    { key: 'till', name: 'Денежный ящик', hint: 'касса в зале, её пересчитывают при закрытии смены' },
    { key: 'cash', name: 'Наличные', hint: 'сейф, деньги дома — всё, что лежит купюрами' },
    { key: 'bank', name: 'Безнал', hint: 'расчётный счёт или карта: эквайринг, СБП, переводы' }
  ];

  /* С чего начинается новый магазин: сейф и счёт. Денежного ящика здесь нет
     намеренно. Владелец ведёт СВОИ деньги: он приходит, забирает выручку у
     кассира и уносит её в сейф. Сколько осталось в ящике на размен — забота
     кассира, а не его бухгалтерии. Названия и остатки владелец меняет,
     лишние счета удаляет, свои добавляет. */
  function starterAccounts() {
    return [
      { name: 'Сейф', kind: 'cash', opening: 0, defaultCash: true,
        note: 'наличные, забранные со смен' },
      { name: 'Расчётный счёт', kind: 'bank', opening: 0, defaultCashless: true,
        note: 'эквайринг, СБП, переводы поставщикам' }
    ];
  }

  /* ==========================================================================
     МИГРАЦИИ: КАК БАЗА ПЕРЕЕЗЖАЕТ НА НОВЫЙ ФОРМАТ

     Номер версии в базе стоял с самого начала, а кода, который бы что-то с
     ним делал, не было. Каждое изменение формата старая база переживала
     СЛУЧАЙНО — просто потому, что новые поля оказывались необязательными.
     Однажды повезло бы меньше, и владелец открыл бы программу с пустыми
     цифрами, не поняв почему.

     Теперь так: у формата есть номер, у каждого перехода — своя функция.
     База младше — её поднимают по очереди, шаг за шагом, и записывают новый
     номер. База уже свежая — не трогают.

     ОТДЕЛЬНО ПРО ФАЙЛ ИЗ БУДУЩЕГО. Если база новее самой программы (владелец
     обновил её на одном компьютере, а на втором открыл старой копией),
     чинить её нельзя ни в коем случае: старая программа не знает, что там
     появилось, и «починит» так, что данные испортятся. В этом случае просто
     оставляем как есть и поднимаем флаг — экран о нём скажет.

     ПОДНИМАЕМ ДО СЛИЯНИЯ С НАСТРОЙКАМИ ПО УМОЛЧАНИЮ, и это принципиально.
     После слияния пустое поле уже не отличить от заданного: настройки по
     умолчанию подставят своё значение, и миграция решит, что всё на месте.
     Я написал сначала наоборот и получил ровно это — finShifts осталась
     «День, Ночь» там, где владелец задал «Утро, Вечер, Ночь».

     ПРАВИЛО ДЛЯ ТОГО, КТО БУДЕТ ПРАВИТЬ ДАЛЬШЕ: меняешь формат данных —
     подними ВЕРСИЯ на единицу и допиши шаг сюда. Миграция обязана быть
     безопасной при повторном запуске: её могут применить дважды.
     ========================================================================== */
  var ВЕРСИЯ = 4;

  /* Движок сюда не подключается намеренно: хранилище обязано работать само
     по себе. Поэтому своя строка — маленькая и без затей. */
  function строка(v) { return String(v == null ? '' : v).trim(); }

  var МИГРАЦИИ = [
    {
      до: 4,
      имя: 'долг поставщику: честное значение вместо обещанного',
      делать: function (s) {
        /* Настройка «Долг поставщику веду» была заведена со значением «по
           накладным», но НИ ОДНА строка программы её не читала: что бы
           владелец ни выбрал, считалось всё равно общей суммой из вечерних
           итогов. Теперь настройка работает, и старое значение оказалось бы
           обещанием, которого магазин никогда не давал: экран поставщиков
           открывался бы подробным у всех подряд.

           Поэтому один раз приводим к тому, что программа делает на самом
           деле. Кто ведёт по накладным — переключит обратно, и с этого раза
           переключение действительно что-то изменит. */
        var н = s.settings;
        if (!н || typeof н !== 'object') return;
        н.debtMode = 'общей суммой';
      }
    },
    {
      до: 3,
      имя: 'кассовый ящик перестал быть счётом',
      делать: function (s) {
        /* Владелец — бухгалтер, а не кассир. Ящик из картины мира убран:
           он забирает деньги и кладёт их к себе в сейф.

           Записи НЕ переписываем. Смены, сделанные по-старому, у которых
           заполнен «факт в ящике», продолжают считаться по-старому — так же
           до копейки. Переписать историю задним числом значит соврать о том,
           чего владелец не делал.

           Со счетами иначе. Деньги, которые программа держала «в ящике»,
           физически лежат у владельца, поэтому ящик закрываем, а его остаток
           переносим в сейф отдельной строкой начального остатка. Удалять
           ящик нельзя: на него ссылаются старые записи, и без него они
           потеряли бы счёт. */
        var счета = s.accounts;
        if (Object.prototype.toString.call(счета) !== '[object Array]') return;

        var сейф = null, i;
        for (i = 0; i < счета.length; i++) {
          if (счета[i] && счета[i].kind === 'cash' && !счета[i].archived) { сейф = счета[i]; break; }
        }
        for (i = 0; i < счета.length; i++) {
          var a = счета[i];
          if (!a || a.kind !== 'till' || a.archived) continue;
          a.archived = true;
          a.defaultCash = false;
          a.note = строка(a.note) ? a.note + ' · закрыт при переходе' : 'закрыт при переходе';
          if (сейф) сейф.opening = (+сейф.opening || 0) + (+a.opening || 0);
          a.opening = 0;
        }
        if (сейф) сейф.defaultCash = true;
      }
    },
    {
      до: 2,
      имя: 'смены под двумя именами и записи без номера',
      делать: function (s) {
        /* Смены хранятся в двух настройках сразу: shiftNames видит мастер
           настройки, finShifts — форма сверки. Мы это уже один раз забыли.
           В старых базах заполнена обычно одна: копируем в пустую. */
        var н = s.settings || {};
        if (строка(н.shiftNames) && !строка(н.finShifts)) н.finShifts = н.shiftNames;
        else if (строка(н.finShifts) && !строка(н.shiftNames)) н.shiftNames = н.finShifts;

        /* Записи без номера. Такое бывает у баз, которые правили руками или
           собирали из старых выгрузок. Без номера запись нельзя ни исправить,
           ни удалить — она просто «прилипает» к экрану. */
        for (var i = 0; i < COLLECTIONS.length; i++) {
          var список = s[COLLECTIONS[i]];
          if (Object.prototype.toString.call(список) !== '[object Array]') continue;
          for (var j = 0; j < список.length; j++) {
            if (список[j] && !список[j].id) список[j].id = uid();
          }
        }
      }
    }
  ];

  var ИЗ_БУДУЩЕГО = false;      // база новее программы — трогать нельзя

  function поднять(s) {
    if (!s || typeof s !== 'object') return s;
    var было = +s.version || 1;
    ИЗ_БУДУЩЕГО = было > ВЕРСИЯ;
    if (ИЗ_БУДУЩЕГО) return s;            // файл из будущего не чиним
    for (var i = 0; i < МИГРАЦИИ.length; i++) {
      if (было < МИГРАЦИИ[i].до) {
        try { МИГРАЦИИ[i].делать(s); }
        catch (e) { /* одна неудачная миграция не должна ронять запуск */ }
      }
    }
    s.version = ВЕРСИЯ;
    return s;
  }

  function emptyState() {
    var s = { settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), version: ВЕРСИЯ };
    for (var i = 0; i < COLLECTIONS.length; i++) s[COLLECTIONS[i]] = [];
    return s;
  }

  var state = emptyState();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      // База под прежним именем: переносим один раз и оставляем старую копию
      if (!raw) {
        for (var i = 0; i < OLD_KEYS.length && !raw; i++) {
          raw = localStorage.getItem(OLD_KEYS[i]);
          if (raw) { try { localStorage.setItem(KEY, raw); } catch (e2) {} }
        }
      }
      if (raw) {
        var parsed = JSON.parse(raw);
        state = merge(emptyState(), поднять(parsed));
      }
    } catch (e) { /* повреждённое хранилище не должно ломать запуск */ }
    // Счета заводим в любом случае: даже если хранилище не прочиталось,
    // деньги должно быть куда класть
    ensureAccounts();
    ensureFunds();
    return state;
  }

  /* Счета должны быть всегда: без них некуда положить выручку. Если их нет
     (новая база или база, заведённая до появления счетов), создаём три
     обычных и переносим в них прежние начальные остатки. */
  /* Конверты заводим один раз, пустыми: владелец вписывает свои суммы.
     Сумма 0 значит «пока не откладываю» — конверт не мешает и не ругается. */
  function ensureFunds() {
    if ((state.funds || []).length) return;
    state.funds = starterFunds(state.accounts || []).map(function (f) {
      return { id: uid(), name: f.name, plan: f.plan, account: f.account, note: f.note };
    });
  }

  function ensureAccounts() {
    if ((state.accounts || []).length) return state.accounts;
    var st = state.settings || {};
    state.accounts = starterAccounts().map(function (a) {
      /* Начальный остаток наличных — это то, что лежит У ВЛАДЕЛЬЦА в сейфе.
         Деньги в ящиках он не считает своими: они у кассиров на сдачу. */
      if (a.kind === 'cash') a.opening = +st.openSafeStart || 0;
      a.id = uid();
      return a;
    });
    return state.accounts;
  }

  // Ключи, которыми можно подменить прототип объекта: в базе им не место
  function unsafeKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }

  function merge(base, patch) {
    for (var k in patch) {
      if (unsafeKey(k) || !Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (k === 'settings') {
        for (var s in patch.settings) { if (!unsafeKey(s)) base.settings[s] = patch.settings[s]; }
      } else if (Object.prototype.toString.call(patch[k]) === '[object Array]') {
        base[k] = patch[k];
      } else if (patch[k] !== null && typeof patch[k] === 'object') {
        base[k] = merge(base[k] || {}, patch[k]);
      } else {
        base[k] = patch[k];
      }
    }
    return base;
  }

  var changeHooks = [];
  // на изменение подписывается сохранение в файл (js/filestore.js)
  function onChange(fn) { changeHooks.push(fn); }

  /* ==========================================================================
     СОХРАНЕНИЕ: localStorage — главный источник правды

     Запись в браузер происходит МГНОВЕННО и синхронно: закрыли окно сразу
     после ввода — запись уже там. Файл в папке пишется следом, с небольшой
     задержкой (браузер не даёт писать на диск синхронно).

     Чтобы отставший файл не затёр свежую запись при следующем запуске,
     у базы есть отпечаток: rev — номер версии, растёт с каждой записью, и
     savedAt — когда записали. Тот же отпечаток кладётся в файл. При старте
     программа сравнивает их и берёт то, что новее, а не то, что в файле.
     ====================================================================== */
  function save() {
    var ok = true;
    state.rev = (+state.rev || 0) + 1;
    state.savedAt = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      ok = false; // например, переполнено хранилище браузера
      lastSaveError = e && e.message ? e.message : 'хранилище браузера переполнено';
    }
    if (ok) lastSaveError = '';
    changeHooks.forEach(function (fn) { try { fn(state); } catch (e) {} });
    return ok;
  }
  var lastSaveError = '';

  // Отпечаток базы: по нему видно, что новее — браузер или файл
  function stamp(st) {
    st = st || state;
    var n = 0;
    for (var i = 0; i < JOURNALS.length; i++) n += (st[JOURNALS[i]] || []).length;
    return { rev: +st.rev || 0, savedAt: st.savedAt || '', records: n };
  }

  /* Что делать при запуске: взять браузер, взять файл или спросить.
       'local'  — в браузере свежее: файл отстал, запись бы потерялась;
       'file'   — в файле свежее: работали в другой вкладке или на другом
                  компьютере, наши данные старые;
       'same'   — одно и то же, делать нечего;
       'ask'    — разошлись: и там, и там есть своё, нужен разбор вручную. */
  function compare(fileState) {
    var mine = stamp(state), theirs = stamp(fileState || {});
    if (!fileState) {
      return { verdict: 'local', mine: mine, theirs: theirs,
        onlyMine: mine.records, onlyTheirs: 0 };
    }
    if (!mine.records && !theirs.records) {
      return { verdict: 'same', mine: mine, theirs: theirs, onlyMine: 0, onlyTheirs: 0 };
    }
    if (!mine.records) {
      return { verdict: 'file', mine: mine, theirs: theirs,
        onlyMine: 0, onlyTheirs: theirs.records };
    }
    if (!theirs.records) {
      return { verdict: 'local', mine: mine, theirs: theirs,
        onlyMine: mine.records, onlyTheirs: 0 };
    }

    // Записи по номерам: есть ли у одной стороны то, чего нет у другой
    var mineIds = {}, theirsIds = {}, onlyMine = 0, onlyTheirs = 0, i, j, c, list;
    for (i = 0; i < JOURNALS.length; i++) {
      c = JOURNALS[i];
      list = state[c] || [];
      for (j = 0; j < list.length; j++) if (list[j] && list[j].id) mineIds[c + ':' + list[j].id] = 1;
      list = fileState[c] || [];
      for (j = 0; j < list.length; j++) if (list[j] && list[j].id) theirsIds[c + ':' + list[j].id] = 1;
    }
    for (var k in mineIds) if (!theirsIds[k]) onlyMine++;
    for (var k2 in theirsIds) if (!mineIds[k2]) onlyTheirs++;

    var res = { mine: mine, theirs: theirs, onlyMine: onlyMine, onlyTheirs: onlyTheirs };
    if (!onlyMine && !onlyTheirs) {
      // состав одинаковый — берём более позднюю версию, чтобы подхватить правки
      res.verdict = theirs.savedAt > mine.savedAt ? 'file' : 'same';
      return res;
    }
    if (onlyMine && !onlyTheirs) { res.verdict = 'local'; return res; }
    if (!onlyMine && onlyTheirs) { res.verdict = 'file'; return res; }
    res.verdict = 'ask';                  // и там, и там своё — сливать вручную
    return res;
  }

  // Заменить всё содержимое базы (например, прочитанное из файла в папке)
  function replaceAll(data) {
    var keepRev = +state.rev || 0;
    state = merge(emptyState(), поднять(data || {}));
    // номер версии не откатываем назад: иначе следующая запись выглядела бы
    // старее файла и программа снова взяла бы файл
    state.rev = Math.max(keepRev, +state.rev || 0) + 1;
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    return state;
  }

  function uid() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* --- Журнал действий -------------------------------------------------------
     Каждая правка, добавление и удаление оставляют след: что было до, что
     стало после. Отсюда «Отменить» возвращает одну запись, не трогая базу
     целиком, и видно, кто что менял.
     ------------------------------------------------------------------------ */
  var LOG_MAX = 500;
  var COLL_RU = {
    dds: 'Касса и деньги', plans: 'План выплат', staff: 'Сотрудники',
    timesheet: 'Табель смен', payouts: 'Выплаты зарплаты',
    debtors: 'Долги покупателей', cashcount: 'Пересчёт кассы',
    templates: 'Шаблоны', dictoff: 'Скрытое в справочниках',
    filtersets: 'Наборы фильтров'
  };
  // Как записать строку в журнал, чтобы через месяц было понятно
  /* Как назвать запись в истории. Смена и итоги дня не имеют ни названия,
     ни суммы в обычных полях — раньше они попадали в историю строкой
     «Касса и деньги — —», по которой невозможно понять, о чём речь.
     Теперь у каждой записи есть человеческое имя. */
  function logTitle(rec) {
    if (!rec) return '';
    var t = str(rec.type);
    if (t === 'Смена') {
      return [str(rec.till), str(rec.shift), str(rec.cashier)]
        .filter(Boolean).join(' · ').slice(0, 60) || 'смена';
    }
    if (t === 'День') return 'итоги дня';
    if (t === 'Перемещение') return 'перевод между счетами';
    return String(rec.name || rec.firm || rec.supplier || rec.employee ||
      rec.category || rec.doc || rec.title || '').slice(0, 60);
  }

  /* Сумма записи для истории. У смены «сумма» — это выручка, у итогов дня —
     закуп и долги, у пересчёта кассы — насчитанное. Ноль вместо них означал
     бы, что запись пустая, а это неправда. */
  function logSum(rec) {
    if (!rec) return 0;
    var t = str(rec.type);
    function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
    if (t === 'Смена') return Math.round((n(rec.zCash) + n(rec.zCashless)) * 100) / 100;
    if (t === 'День') {
      return Math.round((n(rec.goodsCash) + n(rec.debtTaken) + n(rec.debtPaid)) * 100) / 100;
    }
    var v = rec.amount != null ? rec.amount : (rec.sum != null ? rec.sum : rec.counted);
    return n(v);
  }
  function writeLog(what, coll, rec, before) {
    if (coll === 'log' || coll === 'trash') return;
    state.log = state.log || [];
    state.log.push({
      id: uid(), at: new Date().toISOString(), what: what, coll: coll,
      collName: COLL_RU[coll] || coll, recId: rec && rec.id,
      title: logTitle(rec), sum: logSum(rec),
      before: before ? JSON.parse(JSON.stringify(before)) : null
    });
    if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
  }

  /* --------------------------------------------------------------------------
     ЗАКРЫТЫЙ МЕСЯЦ НЕ ПРАВЯТ

     Владелец сводит месяц, смотрит прибыль, платит налог — и с этого момента
     цифры должны остаться как есть. Если потом задним числом поправить смену,
     отчёт поедет, а владелец об этом не узнает.

     Поэтому месяц можно «запереть»: в настройке closedTo стоит последняя
     закрытая дата, и всё, что раньше неё, не добавляется, не правится и не
     удаляется. Запирание снимается тем же владельцем в один клик — это защита
     от случайности, а не замок от самого себя.
     -------------------------------------------------------------------------- */
  var LOCKED = ['dds', 'plans', 'timesheet', 'payouts', 'debtors', 'cashcount'];

  // Своего txt в этом файле нет — движок сюда не подключается
  function str(v) { return String(v == null ? '' : v).trim(); }

  function closedTo() { return str(state.settings && state.settings.closedTo); }

  // Дата записи: у выплат она называется due, у остальных date
  function recDate(item) { return str(item && (item.date || item.due)); }

  /* Заперто ли редактирование этой записи. Возвращает объяснение для владельца
     или пустоту, если править можно. */
  function lockedWhy(coll, item) {
    var to = closedTo();
    if (!to) return '';
    if (LOCKED.indexOf(coll) < 0) return '';
    var d = recDate(item);
    if (!d || d > to) return '';
    return 'Месяц закрыт по ' + to.split('-').reverse().join('.') +
      ', и записи за это время уже не меняются. Если поправить действительно нужно — ' +
      'откройте «Закрытие месяца» и снимите замок.';
  }

  function add(coll, item) {
    /* Последняя линия обороны. Основную проверку делает форма — она умеет
       объяснить владельцу словами. Здесь молча отказываем, чтобы закрытый
       месяц нельзя было тронуть даже по недосмотру в коде. */
    if (lockedWhy(coll, item)) return null;
    if (!state[coll]) state[coll] = [];
    if (!item.id) item.id = uid();
    state[coll].push(item);
    writeLog('добавление', coll, item, null);
    save();
    return item;
  }

  function addMany(coll, items, replace) {
    if (!state[coll]) state[coll] = [];
    if (replace) state[coll] = [];
    for (var i = 0; i < items.length; i++) {
      if (!items[i].id) items[i].id = uid();
      state[coll].push(items[i]);
    }
    save();
    return state[coll].length;
  }

  function update(coll, id, patch) {
    var rows = state[coll] || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        if (lockedWhy(coll, rows[i])) return null;
        var before = JSON.parse(JSON.stringify(rows[i]));
        for (var k in patch) rows[i][k] = patch[k];
        writeLog('правка', coll, rows[i], before);
        save(); return rows[i];
      }
    }
    return null;
  }

  var TRASH_MAX = 200;      // сколько удалённых записей помним

  // Удаление не стирает запись насовсем: она уезжает в корзину,
  // откуда её можно вернуть одной кнопкой.
  function remove(coll, id, forever) {
    var rows = state[coll] || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        var rec = rows[i];
        if (lockedWhy(coll, rec)) return null;
        rows.splice(i, 1);
        writeLog('удаление', coll, rec, rec);
        if (!forever && coll !== 'trash') {
          state.trash = state.trash || [];
          state.trash.push({ id: uid(), coll: coll, at: new Date().toISOString(), rec: rec });
          if (state.trash.length > TRASH_MAX) state.trash = state.trash.slice(-TRASH_MAX);
        }
        save();
        return rec;
      }
    }
    return null;
  }

  // Вернуть запись из корзины на место
  function restore(trashId) {
    var t = state.trash || [];
    for (var i = 0; i < t.length; i++) {
      if (t[i].id === trashId) {
        var item = t.splice(i, 1)[0];
        state[item.coll] = state[item.coll] || [];
        state[item.coll].push(item.rec);
        save();
        return item;
      }
    }
    return null;
  }

  // Вернуть последнее удалённое
  function undo() {
    var t = state.trash || [];
    return t.length ? restore(t[t.length - 1].id) : null;
  }

  function emptyTrash() { state.trash = []; save(); }

  function clear(coll) {
    if (coll) state[coll] = []; else state = emptyState();
    save();
  }

  // Отменить одно действие из журнала: вернуть запись, какой она была до
  function logUndo(logId) {
    var log = state.log || [];
    var row = null;
    for (var i = 0; i < log.length; i++) if (log[i].id === logId) row = log[i];
    if (!row || !row.before) return null;
    var rows = state[row.coll] = state[row.coll] || [];
    var found = false;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].id === row.before.id) { rows[j] = JSON.parse(JSON.stringify(row.before)); found = true; break; }
    }
    if (!found) rows.push(JSON.parse(JSON.stringify(row.before)));   // удалённую возвращаем на место
    row.undone = true;
    save();
    return row.before;
  }

  function setSetting(key, value) { state.settings[key] = value; save(); }

  // Резервная копия: журналы и настройки одним файлом
  /* --- 126. Работа на двух компьютерах: примирение изменений ------------------
     Дома записали расход, в магазине — смену. Раньше выбор был «оставить моё»
     или «взять из файла», и одна из работ пропадала. Теперь записи
     объединяются: у каждой свой номер, поэтому пропасть ничего не может.
     Если одну и ту же запись правили в обоих местах — берём ту, что из более
     позднего файла, и говорим, сколько таких было. Удаления не теряются:
     корзина помнит, что и когда удалили.
     ------------------------------------------------------------------------ */
  function reconcile(mine, theirs, opts) {
    opts = opts || {};
    mine = mine || {}; theirs = theirs || {};
    // чей файл записан позже — тот и главный в спорных записях
    var mineNewer = !opts.theirsSaved || (opts.mineSaved && opts.mineSaved >= opts.theirsSaved);
    var out = emptyState();
    var res = { added: 0, kept: 0, conflicts: 0, removed: 0, collections: {} };

    // что удалено на каждой стороне — по корзине
    function deletedIds(st) {
      var map = {};
      (st.trash || []).forEach(function (t) {
        if (t && t.rec && t.rec.id) map[t.rec.id] = t.at || '';
      });
      return map;
    }
    var delMine = deletedIds(mine), delTheirs = deletedIds(theirs);

    for (var ci = 0; ci < COLLECTIONS.length; ci++) {
      var coll = COLLECTIONS[ci];
      if (coll === 'trash') continue;                 // корзину сливаем отдельно
      var a = mine[coll] || [], b = theirs[coll] || [];
      var byId = {}, order = [], stats = { added: 0, conflicts: 0, removed: 0 };

      function put(rec, fromMine) {
        if (!rec || typeof rec !== 'object') return;
        var id = rec.id;
        if (!id) { id = uid(); rec.id = id; }
        // запись, удалённая на другой стороне, не воскресает
        if (fromMine ? delTheirs[id] : delMine[id]) { stats.removed++; return; }
        if (!byId[id]) { byId[id] = rec; order.push(id); if (!fromMine) stats.added++; return; }
        var was = JSON.stringify(byId[id]), now = JSON.stringify(rec);
        if (was === now) return;                       // одинаковые — спорить не о чем
        stats.conflicts++;
        // побеждает та сторона, чей файл записан позже
        if (fromMine ? mineNewer : !mineNewer) byId[id] = rec;
      }
      for (var i = 0; i < a.length; i++) put(a[i], true);
      for (var j = 0; j < b.length; j++) put(b[j], false);

      out[coll] = order.map(function (id) { return byId[id]; });
      res.added += stats.added; res.conflicts += stats.conflicts; res.removed += stats.removed;
      if (stats.added || stats.conflicts || stats.removed) res.collections[coll] = stats;
    }

    // корзина: объединяем, чтобы удаления с обеих сторон помнились
    var trash = {}, tOrder = [];
    [(mine.trash || []), (theirs.trash || [])].forEach(function (list) {
      list.forEach(function (t) {
        if (!t || !t.id || trash[t.id]) return;
        trash[t.id] = t; tOrder.push(t.id);
      });
    });
    out.trash = tOrder.map(function (id) { return trash[id]; }).slice(-TRASH_MAX);

    // настройки берём у того, чей файл новее: это про один магазин, а не про
    // две разные базы, и мешать половинки настроек — хуже, чем взять целиком
    out.settings = merge(emptyState().settings,
      (mineNewer ? mine.settings : theirs.settings) || {});
    res.settingsFrom = mineNewer ? 'этот компьютер' : 'файл в папке';
    res.total = COLLECTIONS.reduce(function (n, c) { return n + (out[c] || []).length; }, 0);
    return { state: out, report: res };
  }

  // Примирить и сразу применить: возвращает отчёт для показа владельцу
  function reconcileWith(otherText, otherSaved) {
    var obj = typeof otherText === 'string' ? JSON.parse(otherText) : otherText;
    var data = obj.data || obj;
    var r = reconcile(state, data, { mineSaved: state.savedAt || '', theirsSaved: obj.saved || otherSaved || '' });
    state = r.state;
    save();
    return r.report;
  }

  /* База новее программы: чинить нельзя, но молчать тем более. */
  function fromFuture() { return ИЗ_БУДУЩЕГО; }
  function dataVersion() { return { now: +state.version || 1, app: ВЕРСИЯ }; }

  function exportJSON() {
    return JSON.stringify({ exported: new Date().toISOString(), data: state }, null, 2);
  }
  function importJSON(text) {
    var obj = JSON.parse(text);
    var data = obj.data || obj;
    state = merge(emptyState(), поднять(data));
    save();
    return state;
  }

  // Постоянные расходы в месяц — база для точки безубыточности
  function fixedMonthly() {
    var s = state.settings;
    return (+s.fot || 0) + (+s.rent || 0) + (+s.utilities || 0) + (+s.taxes || 0) + (+s.other || 0);
  }

  return {
    KEY: KEY, DEFAULT_SETTINGS: DEFAULT_SETTINGS, COLLECTIONS: COLLECTIONS,
    DATA_COLLECTIONS: DATA_COLLECTIONS, JOURNALS: JOURNALS,
    reconcile: reconcile, reconcileWith: reconcileWith,
    get state() { return state; },
    get settings() { return state.settings; },
    load: load, save: save, add: add, addMany: addMany, update: update, remove: remove,
    restore: restore, undo: undo, emptyTrash: emptyTrash, logUndo: logUndo, COLL_RU: COLL_RU,
    clear: clear, setSetting: setSetting, exportJSON: exportJSON, importJSON: importJSON,
    fromFuture: fromFuture, dataVersion: dataVersion,
    поднять: поднять, ВЕРСИЯ: ВЕРСИЯ,
    fixedMonthly: fixedMonthly, uid: uid, onChange: onChange, replaceAll: replaceAll,
    stamp: stamp, compare: compare,
    ACCOUNT_KINDS: ACCOUNT_KINDS, ensureAccounts: ensureAccounts,
    starterAccounts: starterAccounts, starterFunds: starterFunds,
    lockedWhy: lockedWhy, closedTo: closedTo,
    get lastSaveError() { return lastSaveError; }
  };
});
