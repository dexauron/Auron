// Связывание всего вместе и запуск

import { $, CFG, PAGE_SIZE, state, ui } from './store.js';
import { addBackButtons, closeSheet, enableSwipeToClose, norm, openSheet, safely, setRowText, toast, translit, watchErrors } from './core.js';
import { ic, paintIcons } from './icons.js';
import { buildIndex, categoryOf, daysAgoISO, productCategory, scoreProduct, todayISO, visibleProducts } from './catalog.js';
import { addRecentQuery, clearAllFilters, closeLightbox, deviceId, filterCatOpen, initTheme, loadFilters, openLightbox, removeFilter, renderActiveFilters, renderAll, renderCatScreen, renderFilterCats, renderGrid, renderRecent, showSkeleton, switchTab, syncControls, toggleFav, toggleTheme } from './render.js';
import { DEV_NAME_KEY, openDeviceSheet, resetDevice } from './device.js';
import { calcOffer, copyText, loadOrderRules, openFromHash, openOrderRules, openPriceCalc, openProduct, openSupplierView, orderPlan, renderCalcResult, renderOrderRulesExample, renderStock, saveOrderRules, shareProduct, updateFavButton } from './card.js';
import { loadCache, saveCache, tidyMemory } from './data.js';
import { SV_AUTH_KEY, applyServerless, applyStaff, autoPublish, buildFullSnapshot, buildPopularIds, buildPublicProducts, clearSvAuth, decryptJSON, encryptJSON, ghApi, ghBranch, ghCommit, ghConfigured, ghRepo, ghSetToken, ghToken, publishFull, publishShowcase, unlockAny, unlockSecret, unlockStaff } from './publish.js';
import { openCompStoreView, openCompetitorAdd, renderCompStoreList, renderCompStores, renderCompetitors, showCompChosen, submitCompetitorPrice } from './competitors.js';
import { attachFoundPhoto, autoPhotoSearch, compressImage, createCompetitor, dedupProducts, findProductPhoto, isOwner, openPhotoFill, photoCandidates, photoFillPick, renderPhotoFillList, renderPhotoManager, runPhotoSearch, sortByInternet, uncategorized } from './photos.js';
import { addGroup, addSupplier, deleteGroup, deleteProduct, deleteSupplier, openSupplierEdit, saveSupplierEdit, loadTopProducts, openForm, openTopSheet, periodLabel, renameGroup, renderFormSupplierTags, renderGroupsManager, renderGroupsPick, renderSupplierList, renderSuppliersManager, renderTopPeriods, submitForm } from './admin.js';
import { applyBrand } from './brand.js';
import { IMPORT_ORDER, downloadMissing, refresh, smartPick, smartRun, svImportRows, svSaveAndPublish } from './imports.js';
import { scanToPrice, scanToSearch, startScan, stopScan } from './scanner.js';
import { deleteOrder, markReceived, openOrderForm, openOrders, saveOrder, shareOrders, shiftWeek } from './orders.js';
import { clearCompare, inCompare, openCompare, removeFromCompare, toggleCompare } from './compare.js';

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
  $('filterFav').addEventListener('change', (e) => { state.favOnly = e.target.checked; state.renderLimit = PAGE_SIZE; renderAll(); });
  $('filterApply').addEventListener('click', () => closeSheet('filterSheet'));
  $('filterReset').addEventListener('click', clearAllFilters);
  // Круглая иконка «вид» в шапке — переключает размер плиток
  // Три режима по кругу: плитки → плотные плитки → список.
  // Список — для кассы: без фото влезает втрое больше строк, а код крупный.
  $('viewToggleBtn').addEventListener('click', () => {
    state.view = state.view === 'normal' ? 'compact' : (state.view === 'compact' ? 'list' : 'normal');
    state.renderLimit = PAGE_SIZE;
    renderAll();
  });

  // Категории-чекбоксы: отметка добавляет/снимает категорию (и её подгруппы)
  $('filterCats').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-fcat]');
    if (cb) {
      const c = cb.dataset.fcat;
      if (cb.checked) { if (!state.selCats.includes(c)) state.selCats = [...state.selCats, c]; }
      else {
        state.selCats = state.selCats.filter((x) => x !== c);
        const ids = new Set(state.groups.filter((g) => categoryOf(g.name) === c).map((g) => g.id));
        state.selGroups = state.selGroups.filter((x) => !ids.has(x));
      }
      state.renderLimit = PAGE_SIZE;
      renderAll();
      renderFilterCats(); // обновить дерево (счётчики/галочки)
      return;
    }
    // подкатегория (подгруппа) в дереве
    const gb = e.target.closest('[data-fgroup]');
    if (gb) {
      const gid = gb.dataset.fgroup;
      if (gb.checked) { if (!state.selGroups.includes(gid)) state.selGroups = [...state.selGroups, gid]; }
      else state.selGroups = state.selGroups.filter((x) => x !== gid);
      state.renderLimit = PAGE_SIZE;
      renderAll();
    }
  });
  // сворачивание/разворачивание категории в дереве
  $('filterCats').addEventListener('click', (e) => {
    const car = e.target.closest('[data-tcat]');
    if (!car) return;
    const c = car.dataset.tcat;
    if (filterCatOpen.has(c)) filterCatOpen.delete(c); else filterCatOpen.add(c);
    renderFilterCats();
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
    const cp = e.target.closest('[data-copy-code]');
    if (cp) { copyText(cp.dataset.copyCode, 'Код скопирован'); return; }  // карточку не открываем
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
  $('btnShareProduct').addEventListener('click', () => { if (ui.currentProduct) shareProduct(ui.currentProduct); });
  // ♥ в карточке — добавить/убрать из избранного
  $('btnFav').addEventListener('click', () => {
    if (!ui.currentProduct) return;
    const nowFav = toggleFav(ui.currentProduct.id);
    updateFavButton(ui.currentProduct);
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

  // Точки под фото
  $('sheetPhotos').addEventListener('scroll', () => {
    const strip = $('sheetPhotos');
    const i = Math.round(strip.scrollLeft / strip.clientWidth);
    [...$('sheetDots').children].forEach((d, j) => d.classList.toggle('active', i === j));
  }, { passive: true });

  // Копирование кодов
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (btn) copyText(btn.dataset.copy, 'Скопировано: ' + btn.dataset.copy);
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

  // через стрелку, а не напрямую: обработчик вешается ДО присваивания ниже,
  // и прямая ссылка запомнила бы пустую заглушку — кнопка «Войти» молчала бы
  $('adminBtn').addEventListener('click', () => ui.openAdminOrLogin());
  // Настройки устройства раньше открывались вкладкой «Ещё»; теперь на её месте
  // «Фильтры», поэтому вход к ним — из окна входа (там же, где кнопка «Войти»).
  $('loginDevice').addEventListener('click', () => { closeSheet('loginSheet'); openDeviceSheet(); });
  // Присваиваем внешней переменной: switchTab живёт вне bindEvents.
  ui.openAdminOrLogin = function () {
    if (state.session) {
      // Бесплатный режим: две роли — владелец и сотрудник. Подпись человеческая,
      // без служебных слов вроде «owner» (раньше они попадали на экран).
      let roleName, roleHint;
      if (state.serverless) {
        roleName = state.isAdmin ? 'Владелец' : 'Сотрудник магазина';
        roleHint = state.isAdmin
          ? 'Полный доступ: правка, загрузка файлов, публикация'
          : 'Виден весь каталог, цены и продажи — без правки';
      } else {
        roleName = { admin: 'Главный администратор', manager: 'Аналитик / зал' }[state.role] || 'Сотрудник';
        roleHint = {
          admin: state.session.user?.email || '',
          manager: 'Вход выполнен — цены, контакты и аналитика открыты',
        }[state.role] || 'Вход выполнен';
      }
      $('menuTitle').textContent = roleName;
      $('adminEmail').textContent = roleHint;
      $('menuAdminOnly').hidden = !state.isAdmin;
      $('menuTop').hidden = !state.canSales; // «Ходовые» (продажи/выручка) — только владелец
      // на кнопке «Дозаполнить фото» — сколько товаров ещё без фото
      const noCat = uncategorized().length;
      setRowText('menuSortCats', noCat
        ? `Разложить по категориям (${noCat} в «Прочем»)`
        : 'Разложить по категориям — всё разложено');
      const noPhoto = photoCandidates().length;
      setRowText('menuPhotoFill', noPhoto ? `Дозаполнить фото (${noPhoto})` : 'Дозаполнить фото — всё есть');
      // «Фото на проверке» — показываем, если в очереди что-то есть
      $('menuSuggestions').hidden = !(state.suggCount > 0);
      setRowText('menuSuggestions', `Фото на проверке (${state.suggCount || 0})`);
      // цены магазинов ведут все вошедшие — и владелец, и сотрудник
      $('menuCompStores').hidden = false;
      // Бесплатный режим: серверные функции скрываем — они работали только с сервером
      if (state.serverless) {
        $('menuPhotoFill').hidden = true;
        $('menuSuggestions').hidden = true;
        $('menuSuppliers').hidden = true;
        $('menuDedup').hidden = true;
      } else {
        $('menuPhotoFill').hidden = false;
      }
      openSheet('adminMenuSheet');
      if (!state.serverless) {
      }
    } else {
      openLogin();
    }
  };

  // нижняя панель: переключение разделов + плитки категорий
  $('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  $('catScreen').addEventListener('click', (e) => {
    if (e.target.closest('[data-cat-back]')) { ui.openCat = null; renderCatScreen(); window.scrollTo({ top: 0 }); return; }
    const open = e.target.closest('[data-cat-open]');
    if (open) { ui.openCat = open.dataset.catOpen; renderCatScreen(); window.scrollTo({ top: 0 }); return; }
    const grp = e.target.closest('[data-grp]');
    if (grp) { state.selCats = []; state.selGroups = [grp.dataset.grp]; switchTab('catalog'); return; }
    const all = e.target.closest('[data-cat-tile]');
    if (all) { state.selCats = [all.dataset.catTile]; state.selGroups = []; switchTab('catalog'); }
  });

  // цены в карточке: открывает вход, тап по строке — историю цены
  // тап по поставщику в карточке товара → его контакты и цена
  $('sheetPrices').addEventListener('click', (e) => {
    if (e.target.closest('#pricesLoginBtn')) { openLogin(); return; }
    if (e.target.closest('#calcOpenBtn')) { if (ui.currentProduct) openPriceCalc(ui.currentProduct); return; }
    const row = e.target.closest('[data-supplier-view]');
    if (row) openSupplierView(row.dataset.supplierView);
  });

  // калькулятор: пересчитываем на каждое изменение — без кнопки «посчитать»
  for (const id of ['calcPrice', 'calcPackQty', 'calcDiscount']) {
    $(id).addEventListener('input', renderCalcResult);
  }
  $('calcUnitSeg').addEventListener('change', renderCalcResult);

  // правила заказа: по ним считается точка заказа и объём закупки
  $('menuOrderRules').addEventListener('click', () => { closeSheet('adminMenuSheet'); openOrderRules(); });
  $('menuDevice').addEventListener('click', () => { closeSheet('adminMenuSheet'); openDeviceSheet(); });
  $('devName').addEventListener('change', () => {
    const v = $('devName').value.trim();
    try { if (v) localStorage.setItem(DEV_NAME_KEY, v); else localStorage.removeItem(DEV_NAME_KEY); } catch (e) { /* */ }
    toast(v ? `Устройство названо: ${v}` : 'Название устройства убрано');
  });
  $('devReset').addEventListener('click', resetDevice);
  $('devAuth').addEventListener('click', (e) => {
    if (e.target.closest('#devLogin')) { closeSheet('deviceSheet'); openLogin(); }
    if (e.target.closest('#devLogout')) { closeSheet('deviceSheet'); $('menuLogout').click(); }
  });
  for (const id of ['orLead', 'orCycle', 'orSafety']) {
    $(id).addEventListener('input', renderOrderRulesExample);
  }
  $('orSave').addEventListener('click', saveOrderRules);

  // разведка цен: «Добавить цену магазина» в карточке товара
  $('menuCompStores').addEventListener('click', () => {
    closeSheet('adminMenuSheet');
    renderCompStores();
    openSheet('compStoresSheet');
  });
  $('compStoresList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-comp-view]');
    if (b) openCompStoreView(b.dataset.compView);
  });
  $('sheetCompetitors').addEventListener('click', (e) => {
    if (e.target.closest('#compAddBtn') && ui.currentProduct) openCompetitorAdd(ui.currentProduct);
  });
  // фильтр цен магазинов внутри карточки: магазин и «когда записано»
  $('sheetCompetitors').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'compFStore') ui.compFilter.store = t.value;
    else if (t.id === 'compFFrom') ui.compFilter.from = t.value;
    else if (t.id === 'compFTo') ui.compFilter.to = t.value;
    else return;
    if (ui.currentProduct) renderCompetitors(ui.currentProduct);
  });
  // выбор/создание магазина в форме разведки
  $('compStoreSearch').addEventListener('input', renderCompStoreList);
  $('compStoreList').addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-comp-store]');
    if (pick) { ui.compChosenId = pick.dataset.compStore; showCompChosen(); return; }
    const make = e.target.closest('[data-comp-new]');
    if (make) {
      make.disabled = true;
      const id = await createCompetitor(make.dataset.compNew);
      if (id) { ui.compChosenId = id; showCompChosen(); }
    }
  });
  $('competitorForm').addEventListener('submit', submitCompetitorPrice);

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
    ui.photoFillTarget = state.products.find((x) => x.id === btn.dataset.fillCam) || null;
    if (ui.photoFillTarget) $('photoFillInput').click();
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
  });

  // Умный импорт: меню админа → одна вкладка, каталог сам распознаёт файлы
  function openImportHub() {
    closeSheet('adminMenuSheet');
    ui.smartEntries = [];
    $('smartList').innerHTML = '';
    $('smartRun').hidden = true;
    $('smartStatus').hidden = true;
    $('smartFiles').value = '';
    openSheet('importHubSheet');
  }
  $('menuImportHub').addEventListener('click', openImportHub);
  $('smartFiles').addEventListener('change', () => { smartPick([...$('smartFiles').files]); });
  $('smartRun').addEventListener('click', smartRun);
  $('smartMissing').addEventListener('click', downloadMissing);

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
    const p = ui.currentProduct;
    if (!p) return;
    const btn = $('btnFindPhoto');
    btn.disabled = true;
    btn.textContent = 'Ищем фото…';
    try {
      const { url, reached } = await findProductPhoto(p);
      if (!url && !reached) {
        toast('Открытая база фото сейчас недоступна — попробуй позже');
      } else if (!url) {
        toast(state.serverless
          ? 'В открытых базах фото этого товара нет'
          : 'В открытых базах фото этого товара нет — сфотографируй его через в карточке');
      } else {
        await attachFoundPhoto(p, url);
        saveCache();
        renderGrid();
        openProduct(p); // перерисуем карточку уже с фото
        // одно фото — публикуем сразу: владелец нажал кнопку и ждёт результата
        if (state.serverless) await svSaveAndPublish('Фото найдено и сохранено');
        else toast('Фото найдено и сохранено');
      }
    } catch (e) {
      toast('Не получилось: ' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Найти фото в интернете';
    }
  });

  // Пароль магазина (только админ): смена выкидывает все устройства сотрудников
  // Смена пароля каталога (владелец). Обязательно с перешифровкой: старый
  // файл ключей остаётся в истории репозитория навсегда, и без нового ключа
  // тот, кто знал прежний пароль, продолжил бы открывать каталог.
  $('menuOwnerPass').addEventListener('click', () => {
    closeSheet('adminMenuSheet');
    $('ownerPassNew').value = ''; $('ownerPassAgain').value = '';
    $('ownerPassError').hidden = true;
    openSheet('ownerPassSheet');
  });
  $('ownerPassForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('ownerPassNew').value.trim();
    const again = $('ownerPassAgain').value.trim();
    const err = $('ownerPassError');
    const btn = $('ownerPassSubmit');
    err.hidden = true;
    if (pw.length < 4) { err.textContent = 'Пароль — минимум 4 символа.'; err.hidden = false; return; }
    if (pw !== again) { err.textContent = 'Пароли не совпали.'; err.hidden = false; return; }
    if (!ghConfigured()) { err.textContent = 'Нужен ключ публикации: меню → «Публикация на GitHub».'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Перешифровываю…';
    try {
      await publishFull(pw, { rotate: true, onProgress: (d, t) => { btn.textContent = `Перешифровываю… ${d} из ${t}`; } });
      ui.secretPw = pw;
      applyServerless(pw);            // запомнить новый пароль на этом устройстве
      closeSheet('ownerPassSheet');
      toast('Пароль каталога сменён');
    } catch (e2) {
      err.textContent = 'Не удалось: ' + (e2.message || e2);
      err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Сменить пароль'; }
  });

  $('menuStaffPass').addEventListener('click', () => {
    closeSheet('adminMenuSheet');
    $('newStaffPass').value = '';
    $('staffPassError').hidden = true;
    if (state.serverless) $('btnLogoutStaff').hidden = true; // серверная кнопка не нужна
    openSheet('staffPassSheet');
  });

  $('staffPassForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('newStaffPass').value.trim();
    const btn = $('staffPassSubmit');
    $('staffPassError').hidden = true;
    // Серверлес: пароль сотрудника задаёт владелец. Сохраняем в его каталог и
    // публикуем отдельный файл сотрудника (закупка/контакты, без «Ходовых»).
    if (state.serverless) {
      if (!pass || pass.length < 4) { $('staffPassError').textContent = 'Пароль сотрудника — минимум 4 символа.'; $('staffPassError').hidden = false; return; }
      if (!ui.secretPw) { $('staffPassError').textContent = 'Задать пароль сотрудника может только владелец.'; $('staffPassError').hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Сохраняем…';
      state.staffPassword = pass;
      try {
        await publishFull(ui.secretPw);
        closeSheet('staffPassSheet');
        toast('Пароль сотрудника сохранён Теперь сотрудник входит этим паролем');
      } catch (err) {
        $('staffPassError').textContent = 'Не удалось опубликовать: ' + (err.message || err) + '. Проверь GitHub-ключ.';
        $('staffPassError').hidden = false;
      } finally { btn.disabled = false; btn.textContent = 'Сохранить'; }
      return;
    }
  });

  // ── Публикация на GitHub: окошко ключа ──
  function renderPublishStatus() {
    const has = ghConfigured();
    $('publishStatus').innerHTML = has
      ? '<span class="pub-ok">Ключ на месте. Витрина публикуется автоматически после правок.</span>'
      : '<span class="pub-warn">Ключ ещё не вставлен — витрина на GitHub не обновляется.</span>';
    $('ghTokenClear').hidden = !ghToken();
    $('ghPublishNow').hidden = !has;
  }
  function openPublishSheet() {
    closeSheet('adminMenuSheet');
    $('ghTokenInput').value = '';
    $('publishError').hidden = true;
    renderPublishStatus();
    openSheet('publishSheet');
  }
  $('menuPublish').addEventListener('click', openPublishSheet);
  // Запасной вход в публикацию БЕЗ входа на сервер (напр. если сервер недоступен):
  // адрес …/catalog/#publish. Публикация всё равно требует GitHub-ключ, поэтому
  // открывать окно безопасно — без ключа ничего не выложится. Витрину берём из
  // сохранённой копии каталога (state.products), сервер не нужен.
  function maybeOpenPublishByHash() { if (location.hash === '#publish' || location.hash === '#gh') openPublishSheet(); }
  window.addEventListener('hashchange', maybeOpenPublishByHash);
  setTimeout(maybeOpenPublishByHash, 400);
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
      toast('Ключ сохранён');
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
      const sha = await publishShowcase({ onProgress: (d, t) => { btn.textContent = `Публикую… ${d} из ${t}`; } });
      toast(sha ? 'Витрина опубликована' : 'Витрина и так свежая — публиковать нечего');
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
    $('loginError').hidden = true;

    // Серверлес-вход по паролю (сервера нет): пароль открывает зашифрованный
    // каталог на GitHub. Нет файла (404) — первая настройка: этот пароль станет
    // паролём каталога, дальше грузим Excel. Пробуем всегда, когда включён
    // бесплатный режим (STATIC_URL) или есть GitHub-ключ.
    if (CFG.STATIC_URL || ghConfigured()) {
      try {
        // Каталог один на всех, а роль определяется тем, ЧЕЙ конвертик с ключом
        // открылся: пароль владельца — полные права, пароль сотрудника — просмотр.
        const role = await unlockAny(password);
        if (role === 'staff') applyStaff(password); else applyServerless(password);
        $('loginPassword').value = ''; $('loginEmail').value = '';
        closeSheet('loginSheet');
        btn.disabled = false; btn.textContent = 'Войти';
        toast(role === 'staff' ? 'Вход сотрудника' : 'Вход выполнен');
        return;
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Войти';
        if (err && err.message === 'NO_SECRET') {
          // каталога на GitHub ещё нет — первая настройка
          if (!ghConfigured()) {
            $('loginError').textContent = 'Первый вход: сначала вставь GitHub-ключ в меню «Публикация на GitHub», потом вернись и задай пароль.';
            $('loginError').hidden = false;
            return;
          }
          applyServerless(password);
          $('loginPassword').value = ''; $('loginEmail').value = '';
          closeSheet('loginSheet');
          toast('Первый вход. Загрузи Excel — соберём каталог');
          openImportHub();
          return;
        }
        $('loginError').textContent = 'Пароль не подошёл. Проверь пароль каталога или пароль сотрудника.';
        $('loginError').hidden = false;
        return;
      }
    }

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

  });

  $('menuLogout').addEventListener('click', async () => {
    closeSheet('adminMenuSheet');
    if (state.serverless) {
      // серверлес: забываем пароль, запомненный вход и данные, перезагружаем витрину
      ui.secretPw = null; clearSvAuth();
      state.serverless = false; state.session = null; state.isAdmin = false; state.canPurchase = false; state.canSales = false; state.role = null;
      toast('Вы вышли из аккаунта');
      location.reload();
      return;
    }
  });

  $('fabAdd').addEventListener('click', () => openForm(null));
  $('menuAddProduct').addEventListener('click', () => { closeSheet('adminMenuSheet'); openForm(null); });
  $('btnEditProduct').addEventListener('click', () => { closeSheet('productSheet'); openForm(ui.currentProduct); });
  $('btnDeleteProduct').addEventListener('click', deleteProduct);
  $('productForm').addEventListener('submit', submitForm);

  // Сканер: для всех — поиск товара; в форме админа — добавляет штрихкод в список
  /* Сканер работает в двух режимах, и телефон помнит выбранный:
     «Открыть товар» — как раньше, «Проверить ценник» — камера остаётся
     включённой и на каждый штрихкод крупно показывает цену. */
  const SCAN_MODE_KEY = 'wm_scan_mode';
  const scanMode = () => { try { return localStorage.getItem(SCAN_MODE_KEY) === 'price' ? 'price' : 'card'; } catch (e) { return 'card'; } };
  const syncScanMode = () => {
    document.querySelectorAll('#scanModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.scanmode === scanMode()));
    const res = $('scanResult'); if (res && scanMode() === 'card') { res.hidden = true; res.innerHTML = ''; }
  };
  const runScan = () => {
    syncScanMode();
    if (scanMode() === 'price') startScan(scanToPrice, { keepOpen: true });
    else startScan(scanToSearch);
  };
  $('scanSearchBtn').addEventListener('click', runScan);
  $('scanModeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scanmode]');
    if (!b) return;
    try { localStorage.setItem(SCAN_MODE_KEY, b.dataset.scanmode); } catch (err) { /* приватный режим */ }
    stopScan();
    closeSheet('scanSheet');
    setTimeout(runScan, 120);          // перезапускаем камеру уже в новом режиме
  });
  // «Открыть товар» из крупной проверки ценника
  $('scanResult').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-scanned]');
    if (!b) return;
    stopScan();
    closeSheet('scanSheet');
    const p = state.products.find((x) => x.id === b.dataset.openScanned);
    if (p) openProduct(p);
  });
  $('btnScan').addEventListener('click', () => startScan((text) => {
    const ta = $('fBarcodes');
    const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.includes(text)) lines.push(text);
    ta.value = lines.join('\n');
    toast('Штрихкод считан');
  }));

  // Поставщики в форме товара: добавить из списка / убрать тапом по ✕
  $('btnAddSupplierToProduct').addEventListener('click', () => {
    const id = $('fSupplier').value;
    if (id && !ui.formSupplierIds.includes(id)) {
      ui.formSupplierIds.push(id);
      renderFormSupplierTags();
    }
    $('fSupplier').value = '';
  });
  $('fSupplierTags').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-untag]');
    if (!btn) return;
    ui.formSupplierIds = ui.formSupplierIds.filter((id) => id !== btn.dataset.untag);
    renderFormSupplierTags();
  });

  // Фото в форме
  $('photoManager').addEventListener('click', (e) => {
    if (e.target.closest('#photoAddBtn')) { $('photoInput').click(); return; }
    const x = e.target.closest('.thumb-x');
    if (x) {
      ui.formPhotos.splice(Number(x.dataset.idx), 1);
      renderPhotoManager();
    }
  });
  $('photoInput').addEventListener('change', async () => {
    const files = [...$('photoInput').files];
    $('photoInput').value = '';
    for (const f of files) {
      const blob = await compressImage(f);
      ui.formPhotos.push({ blob, preview: URL.createObjectURL(blob) });
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

  // Поставщики (управление): строка открывает правку, там же контакты и удаление
  $('suppliersManageList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-sup-edit]');
    if (row) openSupplierEdit(row.dataset.supEdit);
  });
  $('btnAddSupplier').addEventListener('click', addSupplier);
  $('supEditSave').addEventListener('click', saveSupplierEdit);
  $('supEditDelete').addEventListener('click', deleteSupplier);

  // ── Сравнение нескольких товаров ──
  $('btnCompareAdd').addEventListener('click', () => {
    if (!ui.currentProduct) return;
    if (toggleCompare(ui.currentProduct.id)) {
      $('btnCompareAdd').textContent = inCompare(ui.currentProduct.id) ? 'Убрать из сравнения' : 'К сравнению';
      toast(inCompare(ui.currentProduct.id) ? 'Товар добавлен к сравнению' : 'Товар убран из сравнения');
    }
  });
  $('compareOpen').addEventListener('click', openCompare);
  $('compareClear').addEventListener('click', clearCompare);
  $('compareClear2').addEventListener('click', clearCompare);
  $('compareBody').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-cmp-rm]');
    if (rm) removeFromCompare(rm.dataset.cmpRm);
  });

  // ── Заказы поставщикам ──
  $('menuOrders').addEventListener('click', () => { closeSheet('adminMenuSheet'); openOrders(); });
  $('ordAdd').addEventListener('click', () => openOrderForm(null));
  $('ordSave').addEventListener('click', saveOrder);
  $('ordDelete').addEventListener('click', deleteOrder);
  $('ordReceived').addEventListener('click', markReceived);
  $('ordShare').addEventListener('click', shareOrders);
  $('ordersBody').addEventListener('click', (e) => {
    const wk = e.target.closest('[data-ord-week]');
    if (wk) { shiftWeek(Number(wk.dataset.ordWeek)); return; }
    const row = e.target.closest('[data-ord-open]');
    if (row) { openOrderForm(row.dataset.ordOpen); return; }
    const day = e.target.closest('[data-ord-day]');
    if (day) openOrderForm(null, day.dataset.ordDay);
  });

  // Убрать дубли товаров (только админ)
  $('menuDedup').addEventListener('click', () => { closeSheet('adminMenuSheet'); dedupProducts(); });
  $('menuSortCats').addEventListener('click', () => { closeSheet('adminMenuSheet'); sortByInternet(); });

  // Ходовые товары (после входа)
  $('menuTop').addEventListener('click', () => { closeSheet('adminMenuSheet'); openTopSheet(); });
  // выбор периода из выпадающего списка
  $('topChips').addEventListener('change', (e) => {
    const sel = e.target.closest('#topPeriodSel');
    if (!sel) return;
    const [from, to] = sel.value.split('|');
    ui.topPeriod = { from, to };
    loadTopProducts();
  });
  // админ удаляет выбранный отчёт продаж (товары и цены не трогаются)
  $('topDeletePeriod').addEventListener('click', async () => {
    if (!state.isAdmin || !ui.topPeriod) return;
    const label = periodLabel(ui.topPeriod.from, ui.topPeriod.to);
    if (!confirm(`Удалить отчёт продаж за «${label}»?\nТовары, цены и остальное не тронутся — удалится только этот загруженный отчёт продаж.`)) return;
    const btn = $('topDeletePeriod');
    btn.disabled = true;
    try {
      if (state.serverless) {
        state.sales = (state.sales || []).filter((s) => !((s.period_from || '') === ui.topPeriod.from && (s.period_to || '') === ui.topPeriod.to));
        state.popularIds = buildPopularIds();
        await publishFull(ui.secretPw);
        toast('Отчёт продаж удалён');
        await renderTopPeriods();
      }
    } catch (e) {
      toast('Не удалось удалить: ' + (e.message || ''));
    } finally {
      btn.disabled = false;
    }
  });
  // переключатель «По выручке / По количеству»
  $('topModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.dataset.mode === ui.topMode) return;
    ui.topMode = btn.dataset.mode;
    document.querySelectorAll('#topModeSeg button').forEach((b) => b.classList.toggle('active', b === btn));
    loadTopProducts();
  });
  $('topList').addEventListener('click', (e) => {
    const row = e.target.closest('.top-row');
    if (!row) return;
    const p = state.products.find((x) => x.id === row.dataset.id);
    if (p) { closeSheet('topSheet'); openProduct(p); }
  });

  // Поставщики (управление, только админ)
  $('menuSuppliers').addEventListener('click', () => {
    closeSheet('adminMenuSheet');
    renderSuppliersManager();
    openSheet('suppliersManageSheet');
  });

  // Возврат на вкладку — обновляем каталог, если данные старше 5 минут; и продолжаем автопоиск фото
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Date.now() - state.lastFetch > 5 * 60 * 1000) refresh({ silent: true }).then(renderAll);
    if (isOwner()) setTimeout(autoPhotoSearch, 2000);
  });
  window.addEventListener('online', () => { if (isOwner()) setTimeout(autoPhotoSearch, 2000); });
}

/* ── Старт ────────────────────────────────────── */

async function init() {
  watchErrors();       // одна ошибка не должна обрывать работу всего каталога
  applyBrand();
  // Браузеры (и менеджеры паролей) запоминают поля по имени и подставляют в
  // них сохранённые данные — владелец видел в поиске каталога свою почту.
  // Имя, которое меняется при каждом запуске, узнать невозможно.
  try { $('searchInput').name = 'q' + Math.random().toString(36).slice(2, 9); } catch (e) { /* некритично */ }
  deviceId(); // закрепляем анонимный номер устройства (память избранного/просмотров)
  paintIcons();        // <i data-ic="…"> в разметке → рисунки из набора
  initTheme();
  loadFilters();
  loadOrderRules();
  renderRecent();
  bindEvents();
  showSkeleton();

  // офлайн-копия приложения + установка на главный экран телефона
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // проверяем обновление сразу и при каждом возврате к вкладке —
      // иначе у человека может неделями работать старая версия
      const check = () => reg.update().catch(() => { /* нет сети — не страшно */ });
      check();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    }).catch(() => { /* например, локальный запуск с file:// */ });
    // Новая версия перехватила управление → перезагружаем страницу ОДИН раз,
    // чтобы человек сразу работал на свежем коде и ничего не делал руками.
    // ВАЖНО: только если управление БЫЛО и сменилось. При самом первом заходе
    // контроллер появляется впервые — там перезагружать нечего и незачем.
    const hadController = !!navigator.serviceWorker.controller;
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || swReloaded) return;
      swReloaded = true;
      location.reload();
    });
  }

  // Каталог работает БЕЗ сервера: витрина берётся из файла на сайте, полный
  // каталог — из зашифрованного файла по паролю. Настраивать нечего только
  // если не указано, откуда брать витрину.
  if (!CFG.STATIC_URL) {
    $('setupBanner').hidden = false;
    $('loader').hidden = true;
    await loadCache();
    renderAll(); // даже с пустым кэшем — покажется понятное пустое состояние
    return;
  }

  // мгновенно показываем сохранённый каталог, затем тихо обновляем
  if (await loadCache()) renderAll();

  // Запомненный вход без сервера (владелец/сотрудник): не выходим до явного
  // «Выйти», даже после обновления страницы. Роль поднимаем сразу (данные —
  // из кэша), а полный каталог (закупка/продажи) дотягиваем из GitHub в фоне.
  let svRestored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(SV_AUTH_KEY) || 'null');
    if (saved && saved.pw) {
      svRestored = true;
      // Права поднимаем сразу по запомненной роли, но окончательное слово — за
      // каталогом: владелец мог сменить пароль сотрудника, и тогда роль другая.
      if (saved.role === 'staff') applyStaff(saved.pw); else applyServerless(saved.pw);
      unlockAny(saved.pw).then((role) => {
        if (role === 'staff') applyStaff(saved.pw); else applyServerless(saved.pw);
        renderAll();
      }).catch(() => { /* нет связи или пароль сменили — останемся с кэшем */ });
    }
  } catch (e) { /* не вышло восстановить — вход по паролю остаётся доступен */ }

  await safely('обновление каталога', refresh)();
  openFromHash(); // если открыли по ссылке на товар — показываем его
}

// Тестовый доступ — только на localhost (в проде не открываем).
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.WM_PUBLISH = { publishShowcase, publishFull, unlockSecret, unlockStaff, applyServerless, applyStaff, ghCommit, refresh, buildPublicProducts, buildFullSnapshot, unlockAny, ghConfigured, ghSetToken, autoPublish, encryptJSON, decryptJSON, svImportRows, buildIndex, visibleProducts, scoreProduct, buildPopularIds, renderAll, _norm: norm, _translit: translit, _state: () => state,
    _importOrder: () => IMPORT_ORDER, _cat: productCategory,
    _renderStock: renderStock, _orderPlan: orderPlan, _calcOffer: calcOffer, _tidyMemory: tidyMemory, _ui: () => ui };
}

init();

// для автотестов разбора 1С-файлов (не влияет на работу приложения)
