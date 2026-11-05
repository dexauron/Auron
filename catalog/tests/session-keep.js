// Вход держится, пока человек сам не выйдет.
/* Слова владельца 30.10.2026: «Вход оставь только пароль. И что постоянно с
 * аккаунта не выкидывало, пока сам пользователь не выйдет».
 *
 * До этого к паролю возвращал почти любой сбой: GitHub ответил 404 на файле
 * ключей, кусок каталога не докачался, база устройства не успела открыться при
 * запуске, пропал указатель в localStorage. Для человека это выглядело как
 * «каталог опять меня выкинул», причём чаще всего у полки, где интернет и так
 * плохой.
 *
 * Набор закрепляет новое правило. Вход снимается РОВНО в двух случаях: человек
 * вышел сам или владелец сменил пароль (конвертик роли в keys.json стал другим
 * или исчез). Всё остальное открывает свою зашифрованную копию и молча
 * дочитывает каталог, когда появится связь.
 *
 * Проверки идут на настоящем Web Crypto в изолированном контексте — тот же
 * стенд, что у security-node: сети нет, данных магазина нет. */
const { harness } = require('./fixtures/publish-harness.cjs');

(async () => {
  let bad = 0, total = 0;
  const check = (ok, label) => { total++; console.log((ok ? 'OK: ' : 'FAIL: ') + label); if (!ok) bad++; };

  const h = harness();
  const OWNER = 'fixture-owner-password';
  // первая настройка: публикуем каталог и запоминаем вход на устройстве
  h.api.applyServerless(OWNER);
  await h.api.publishFull(OWNER);
  await h.api.unlockSecret(OWNER);
  h.api.applyServerless(OWNER);
  await h.api.rememberSession();

  const forget = () => { h.state.isAdmin = false; h.state.session = null; h.state.sessionWarning = ''; };
  const keysFile = 'data/keys.json';
  const intact = h.files.get(keysFile);

  // ── 1. Обычный перезапуск ───────────────────────────────────────────────────
  forget();
  check(await h.api.restoreSession() === true && h.state.isAdmin === true,
    'обычный перезапуск: вход возвращается без пароля');

  // ── 2. Пропал указатель в localStorage, ключ на устройстве цел ──────────────
  /* Указатель — вторичный: роль и ключ лежат в базе устройства. В приватном
     окне localStorage может не читаться вовсе, и это не повод требовать пароль
     (подменить роль указателем всё равно нельзя — проверяет security-node). */
  forget();
  h.local.delete('wm_sv_auth');
  check(await h.api.restoreSession() === true && h.state.isAdmin === true,
    'потерянный указатель в localStorage не выбрасывает из аккаунта');
  await h.api.rememberSession();

  // ── 3. База устройства не успела открыться при запуске ──────────────────────
  forget();
  const realGet = h.ctx.idbGet;
  let first = true;
  h.ctx.idbGet = async (k) => {
    if (first && k === 'wm_auth_device_v2') { first = false; throw new Error('fixture storage busy'); }
    return realGet(k);
  };
  check(await h.api.restoreSession() === true && h.state.isAdmin === true,
    'разовая заминка базы устройства не выбрасывает: вторая попытка входит');
  h.ctx.idbGet = realGet;

  // ── 4. Нет связи ────────────────────────────────────────────────────────────
  forget();
  h.ctx.networkDown = true;
  check(await h.api.restoreSession() === true && h.state.products[0].code === '001' && h.state.sessionWarning,
    'без интернета открывается своя копия и человек остаётся в аккаунте');
  check(h.state.catalogNeedsRefresh === true, 'при этом помечено, что данные надо дочитать');
  h.ctx.networkDown = false;

  // ── 5. Связь появилась — доберём каталог сами, без пароля и перезагрузки ────
  const verdict = await h.api.recheckAccess();
  check(verdict === 'ok' && !h.state.catalogNeedsRefresh && !h.state.sessionWarning,
    `появилась связь — каталог дочитан сам, предупреждение снято (${verdict})`);
  check(h.state.isAdmin === true, 'права при этом остались прежними');

  // ── 6. Файла ключей нет (прерванная публикация, 404 у GitHub) ───────────────
  forget();
  h.files.delete(keysFile);
  check(await h.api.restoreSession() === true && h.state.isAdmin === true,
    'пропавший файл ключей не выбрасывает из аккаунта');
  h.files.set(keysFile, intact);
  await h.api.restoreSession();
  await h.api.rememberSession();

  // ── 7. Владелец сменил пароль — вход снимается ──────────────────────────────
  /* Единственная причина, кроме собственного выхода. Иначе отзыв доступа
     ничего не значил бы: уволенный сотрудник ходил бы в закупочные цены. */
  forget();
  const changed = JSON.parse(intact);
  changed.owner.data = 'AAAA' + changed.owner.data.slice(4);
  h.files.set(keysFile, JSON.stringify(changed));
  check(await h.api.restoreSession() === false && !h.state.isAdmin,
    'смена пароля снимает вход, а не считается сбоем сети');
  check(!h.local.has('wm_sv_auth') && !h.disk.has('wm_auth_device_v2') && !h.disk.has('wm_private_device_v2'),
    'при отзыве ключ и закрытая копия стираются с устройства');

  // ── 8. Отзыв догоняет и того, кто вошёл из копии без связи ──────────────────
  h.files.set(keysFile, intact);
  await h.api.unlockSecret(OWNER); h.api.applyServerless(OWNER); await h.api.rememberSession();
  forget();
  h.ctx.networkDown = true;
  await h.api.restoreSession();
  h.ctx.networkDown = false;
  h.files.set(keysFile, JSON.stringify(changed));
  const late = await h.api.recheckAccess();
  check(late === 'revoked' && !h.disk.has('wm_auth_device_v2'),
    `смену пароля замечает и фоновая проверка (${late})`);

  // ── 9. Человек вышел сам ────────────────────────────────────────────────────
  h.files.set(keysFile, intact);
  await h.api.unlockSecret(OWNER); h.api.applyServerless(OWNER); await h.api.rememberSession();
  await h.api.clearSvAuth();
  forget();
  check(await h.api.restoreSession() === false,
    'после собственного выхода каталог не впускает обратно молча');

  // ── 10. Проверка не лезет под руки человеку ─────────────────────────────────
  /* Если человек держит открытое окно, печатает или ждёт подтверждения разбора
     1С, подменять каталог нельзя: он нажмёт «Применить» — и слияние пойдёт не с
     тем, что он видел. Такая отложенная проверка обязана отличаться от «нет
     связи»: иначе наблюдатель повесит на экран надпись про сохранённую копию
     при живом интернете. */
  h.files.set(keysFile, intact);
  await h.api.unlockSecret(OWNER); h.api.applyServerless(OWNER); await h.api.rememberSession();
  const busy = await h.api.recheckAccess(true, false);
  check(busy === 'busy', `отложенная из-за занятости проверка так и называется (${busy})`);

  // ── 11. Две проверки сразу — одна работа ────────────────────────────────────
  /* Наблюдателей двое (запуск и возврат в каталог). Совпали — второй ждёт
     первую, а не качает и расшифровывает каталог во второй раз. */
  let reads = 0;
  const realFetch = h.ctx.fetch;
  h.ctx.fetch = (url, opts) => { if (String(url).includes('keys.json')) reads++; return realFetch(url, opts); };
  const pair = await Promise.all([h.api.recheckAccess(true), h.api.recheckAccess(true)]);
  check(reads === 1 && pair[0] === pair[1], `две одновременные проверки сделали одну работу (запросов ключей: ${reads})`);
  h.ctx.fetch = realFetch;

  // ── 12. Публикация сразу после запуска не гонит перезагружать страницу ──────
  /* Запуск поднимает вход из копии, описи ещё нет. Раньше первая же попытка
     опубликовать отвечала «открой каталог заново при стабильном интернете» —
     при живом интернете и рабочем входе. Теперь публикация сама дочитывает
     каталог и выполняется. */
  forget();
  await h.api.restoreFast();
  let published = true, why = '';
  try { await h.api.publishFull(null); } catch (e) { published = false; why = e.message; }
  check(published, `публикация сразу после запуска проходит сама (${why})`);

  // ── 13. Сотрудник: тот же быстрый запуск, но без прав владельца ─────────────
  /* Быстрый запуск поднимает роль из копии на устройстве, и легко ошибиться,
     отдав сотруднику права владельца. Проверяем прямо: его копия открывается,
     заявок он не видит (они владельца), правка каталога ему запрещена. */
  const STAFF = 'fixture-staff-password';      // пароль сотрудника из стенда
  h.files.set(keysFile, intact);
  await h.api.unlockSecret(OWNER); h.api.applyServerless(OWNER);
  await h.api.unlockStaff(STAFF); h.api.applyStaff(null); await h.api.rememberSession();
  forget();
  const asStaff = await h.api.restoreFast();
  check(asStaff === true && h.state.role === 'staff' && h.state.isAdmin === false,
    `сотрудник тоже входит мгновенно и без прав владельца (роль ${h.state.role}, владелец: ${h.state.isAdmin})`);
  check((h.state.requests || []).length === 0, 'заявки владельца сотруднику не достались');
  let staffBlocked = false;
  try { await h.api.publishFull(null); } catch (e) { staffBlocked = e.message === 'FORBIDDEN'; }
  check(staffBlocked, 'сотрудник не может опубликовать каталог');

  // ── 14. Просьба к браузеру не вытирать вход ─────────────────────────────────
  /* Главная причина «выкинуло само» — браузер убирает данные редко посещаемых
     сайтов (Safari примерно через неделю). Поэтому просим постоянное хранилище.
     В старом браузере такого нет совсем: просьба обязана тихо вернуть false, а
     не падать посреди входа. */
  check(await h.api.keepStorage() === false,
    'там, где постоянного хранилища нет, просьба тихо отказывает и не ломает вход');

  console.log(`\nПРОВЕРОК: ${total}; ОШИБОК: ${bad}`);
  console.log(bad ? '=== ВХОД: ЕСТЬ ПРОБЛЕМЫ ===' : '=== ВХОД ДЕРЖИТСЯ, ПОКА САМ НЕ ВЫЙДЕШЬ: ОК ===');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
