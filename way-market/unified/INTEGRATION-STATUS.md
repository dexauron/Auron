# Текущее обновление 0.18 — 21 октября 2026

Оформление возвратов поставщику и списаний с согласованием и XLSX. Контракт way-market-goods/v1 подготовлен; автоматической отправки в 1С нет. Остатки и деньги не меняются. 215 автоматических проверок и браузерный сценарий прошли. Подробнее: RELEASE-0.18.md и docs/GOODS-DOCUMENTS.md.

Ниже — история предыдущих поставок.

# Текущее обновление 0.17 — 21 октября 2026

Реализован файловый импорт каталога с профилями, предпросмотром, подтверждением, версиями, соответствиями и транзакцией. CSV/JSON и ограниченное подмножество CommerceML. Живое подключение к 1С, проведение и обмен документами не реализованы. 201 автоматическая проверка и браузерный сценарий прошли на отдельной базе. Подробности: RELEASE-0.17.md и docs/1C-INTEGRATION.md.

Ниже сохранены исторические сведения предыдущей поставки.

# Состояние объединения Way Market 0.13

Это карта фактического кода, а не обещание полного завершения. Рабочие оригиналы не менялись. Все исходные модули каталога и Finance находятся в поставке; их наличие не подтверждает работу каждой кнопки в объединённом режиме.

| Область | Что связано с общей системой | Что ещё требуется |
|---|---|---|
| Вход и роли | Общий аккаунт, серверные права, длительный сеанс, общий выход | Проверка на реальных браузерах и устройствах; Telegram-привязка |
| Навигация и стиль | Общая оболочка и система цветов/элементов, светлая/тёмная темы | Визуальная приёмка всех экранов, особенно редких исходных форм |
| Каталог | 19 299 открытых карточек, общие цены/названия, правки, архив, группы | Полный перенос закрытых исходных данных; согласование старых групп с профилями |
| Поставщики | Общие идентификаторы, имена, контакты, архив и версии | Импорт закрытого рабочего справочника из исходной базы |
| Заказы и лимиты | Проверяемый перенос из каталога, резерв бюджета, накладные, расхождения | Автосинхронизация статуса исходной заявки, прямой ролевой поток заявок сотрудников |
| Деньги | Счета, движения, переводы, долги/частичные оплаты, исправления | Миграция рабочей истории; бухгалтерская методика доходов и расходов |
| Касса | Единый приём по сохранённой Excel-форме; навигация и старый URL ведут в неё. Новое Z-закрытие через внешний API запрещено. Дубли исторического Z/кассового притока блокируются по нормализованной смене | Централизованный справочник физических касс, проверка старых Z без кассы и полная приёмка кассиром |
| Календарь | Сроки долгов/назначений/заказов/поставок, фильтры и переходы | Telegram-напоминания и сценарии торгового представителя |
| Текст договорённости | Исходный парсер Telegram предлагает сумму и дату в форме общего долга | Двусторонняя сделка, акцепт, переговоры и споры |
| Сопоставление товаров | Поиск и сопоставление Workspace сохранены; строки переноса заказа проверяются пользователем | Расширение языкового поиска и проверка на рабочих примерах |
| Настройки | Тема, текст, последний модуль по аккаунту и устройству | Перенос всех старых фильтров, избранного, конфигураций и индивидуальных параметров |
| Резервные копии | Общая база и события; проверено зашифрованное восстановление | Увеличение пределов 100 000 строк / 32 МиБ для длительной работы |
| Файлы и офлайн | Исходники функций сохранены; закрытые ответы не кэшируются общим старым кэшем | Чеки, фото, защищённый офлайн, восстановление после потери связи |
| Telegram | 66 исходных файлов целиком; парсер реально подключён к общей форме | Общая авторизация Mini App, локальная машина состояний, отчёты, вложения, очередь уведомлений |

## Модули каталога — полный снимок

В столбце ниже перечислены публичные экспорты файлов. Это инвентаризация исходников. Серверные адаптеры применяются к чтению/сохранению каталога, поставщикам, общему входу и теме. Остальные функции исходных модулей требуют отдельной приёмки на реальных данных.

| Файл | Экспорты исходника |
|---|---|
| `admin.js` | openForm, submitForm, deleteProduct, renderGroupsManager, addGroup, renameGroup, deleteGroup, renderFormSupplierTags, renderSupplierList, renderSuppliersManager, openSupplierEdit, saveSupplierEdit, deleteSupplier, addSupplier, daysBetween, periodLabel, renderTopPeriods, loadTopProducts, openTopSheet |
| `app.js` |  |
| `brand.js` | feature, applyBrand |
| `card.js` | updateFavButton, openProduct, shareProduct, openFromHash, openPriceCalc, calcOffer, renderCalcResult, orderRules, loadOrderRules, orderPlan, openOrderRules, renderOrderRulesExample, saveOrderRules, renderStock, priceParts, openSupplierView, copyText |
| `catalog.js` | categoryOf, catIcon, catalogSections, productCategory, fmtPrice, fmtNum, fmtRetail, packText, nameNoPack, updatedText, parseScaleBarcode, isTopSeller, fmtDate, STALE_PRICE_DAYS, priceAgeDays, isFreshPrice, telHref, bigrams, dice, buildIndex, warmSearchIndex, productsWithWords, scoreProduct, todayISO, daysAgoISO, hasPhoto, QUICK, catGroupPredicate, visibleProducts, searchProducts, queryHlTokens |
| `compare.js` | inCompare, compareCount, toggleCompare, clearCompare, renderCompareBar, openCompare, removeFromCompare |
| `competitors.js` | plural, renderCompetitors, renderCompStores, openCompStoreView, openCompetitorAdd, showCompChosen, renderCompStoreList, submitCompetitorPrice |
| `core.js` | esc, cmpRu, cmpStr, moneyText, moneyNum, attachMoneyInput, norm, stripPunct, highlight, translit, toast, expectPop, openSheet, closeSheet, setRowText, logError, savedErrors, watchErrors, safely, addBackButtons, enableSwipeToClose, groupById, supplierById |
| `data.js` | loadCache, saveCache, byName, sortByName, RETAIL_HIST_ROWS, pricesByProduct, priceStamp, pricesOf, tidyMemory |
| `device.js` | DEV_NAME_KEY, watchInstall, applyPowerMode, deviceName, openDeviceSheet, resetDevice, popViews, trackView, trackSearch |
| `guest.js` | openStore, openShelfReport, bindGuest |
| `icons.js` | checkMark, warnMark, ic, paintIcons, CATEGORIES, OTHER_CAT, catCache |
| `imports.js` | svUuid, normCode, checkShowcaseFresh, svSaveAndPublish, svImportRows, refresh, cellStr, parsePriceNum, parseBarcodeUnit, fmtBarcodeUnit, barcodeSortKey, smartPick, downloadMissing, IMPORT_ORDER, smartRun, parseDateCell, stockNum |
| `margin.js` | marginIssues, marginCount, openMargin, bindMargin, staleItems, openStale |
| `mascot.js` | mascotName, mascotOn, wolfSay, buzz, wolfEmpty, greet, bindMascot |
| `news.js` | syncWaitButton, checkNews, bindNews |
| `onec.js` | copyForOnec, downloadForOnec |
| `orders.js` | setOrdersMode, ordersToday, ordersDue, ordersSummary, openOrders, addOrderItem, removeOrderItem, openOrderForm, sendOrderToSupplier, saveOrder, markReceived, deleteOrder, shareOrders, shiftWeek, shiftMonth, showDayWeek |
| `parts.js` | shard, partName, digest, pool |
| `photos.js` | createCompetitor, renderPhotoManager, uncategorized, sortByInternet, findProductPhoto, attachFoundPhoto, isOwner, autoPhotoSearch, dedupProducts, autoDedup, runPhotoSearch, parsePhotoSheet |
| `pricerise.js` | rememberPrice, priceIndexForImport, rememberRetail, riseCount, riseHtml, bindPriceRise |
| `publish.js` | GH_TOKEN_KEY, ghToken, ghSetToken, ghConfigured, ghRepo, ghBranch, ghApi, ghReason, ghCommit, stockState, buildPublicProducts, buildPopularIds, SHOWCASE_V, publishShowcase, autoPublish, encryptJSON, decryptJSON, SV_AUTH_KEY, buildFullSnapshot, publishFull, unlockAny, unlockSecret, unlockStaff, clearSvAuth, applyServerless, applyStaff |
| `render.js` | stockLabel, switchTab, renderCatScreen, renderGrid, showSkeleton, countActiveFilters, renderActiveFilters, removeFilter, renderAll, clearAllFilters, THEME_KEY, loadFilters, addRecentQuery, renderRecent, favorites, isFav, toggleFav, pushRecentProduct, deviceId, renderNewProducts, choosePick, applyTheme, initTheme, toggleTheme, openLightbox, closeLightbox |
| `requests.js` | requestsWaiting, bindRequests |
| `restock.js` | restockCount, inRestock, toggleRestock, removeRestock, clearRestock, renderRestockBadge, openRestock, orderFromRestock, shareRestock, scanToRestock |
| `reviews.js` | ratingOf, ratingText, reviewsHtml, openRate, renderReviewsBadge, bindReviews |
| `scanner.js` | stopScan, startScan, loadScript, findByBarcode, scanToPrice, scanToSearch, bindScanResult |
| `shopping.js` | toggleShop, shopLink, shopFromHash, syncShopButton, scanToShop, bindShopping |
| `store.js` | CFG, CACHE_KEY, SEARCH_THRESHOLD, RELATIVE_CUTOFF, idbGet, idbSet, PAGE_SIZE, ui, state |
| `whatsapp.js` | WA_MAX_LINES, storeWa, waHref, sendWhatsApp, storeSignature |
| `work.js` | openWork, renderWorkBadge, runWorkAction |

## Finance

Полные исходники `finance/` сохранены. В общем режиме финансовые записи меняет отдельный адаптер: он проверяет текущий аккаунт, отправляет идемпотентную команду и работает с общими счетами/обязательствами. Записи старой офлайн-очереди не проигрываются. Загрузка чека возвращает сообщение об отсутствии подключения — успешное сохранение файла не имитируется.

## Telegram

Исходный коммит указан в `PRESERVED-SOURCES.json`, папка `reference/telegram-original/`. В ней сохранены React-экраны записей, календаря, профиля, новой сделки и карточки сделки; API сделок, платежей, истории, профилей, отчётов и вложений; SQL-миграции машины состояний; функции бота и рассылки. Чистый разбор суммы/даты реально используется сервером `unified-agreement.mjs`. Остальной Telegram-сервис в этом локальном запуске не поднимается. Повторная реализация его подтверждений и прав в SQLite ещё не выполнена.

## Проверка

Автоматические проверки подтверждают серверные связи, права, суммы, атомарность, конфликты, повторные команды, исходный API Finance, парсер и резервное восстановление. Они не подтверждают визуальное качество в браузере, камеру, iPhone/Windows или промышленное развёртывание.


Дополнение 0.12: результаты аудита и границы проверок находятся в `AUDIT-2026-10-20.md`. Добавлены серверный поиск товаров для форм закупок и исправления сохранения/версий/дат/копеек. Оставшиеся интеграционные ограничения таблицы выше сохраняются.

## Дополнение 0.13

Приоритетом приёма смены закреплён Excel-лист пользователя. Расчёты листа сохранены побайтово. Finance использует общие финансовые записи, не отдельную форму приёма смены. Проверено 165 автоматических сценария; отдельно выполнена ограниченная браузерная проверка основных экранов.

Серверная очередь команд Finance сохраняет исходную команду и результат для аккаунта/устройства. Перезагрузка вкладки и сервера не создаёт новый запрос на деньги; восстановление требует явного действия пользователя. До разбора прежней команды новая операция этого устройства не отправляется. В исходном приложении финансовые файлы не изменены. Это не полноценный офлайн и не автоматическая синхронизация старой истории.

Исправление 0.13.1 меняет только запуск и диагностику. Путь базы, кассовый Excel-лист и прикладные модули сохранены. Фактический сбой на пользовательском Windows требует текста ошибки; проверка среды Linux не заменяет эту проверку.

Исправление 0.13.2: устранён 401 в графе JavaScript до входа; первый запуск и повторный вход не требуют предварительно открытой сессии. В браузере проверено отображение регистрации на новой базе. Защищённые вспомогательные модули остаются закрыты до входа. При сбое загрузки вместо пустой страницы показывается сообщение. Текущий набор: 176 успешных автоматических проверок.
