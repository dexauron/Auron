// Сканер штрихкода камерой

import { $, state } from './store.js';
import { closeSheet, esc, norm, openSheet, toast } from './core.js';
import { renderActiveFilters, renderGrid, stockLabel } from './render.js';
import { fmtDate, fmtNum, fmtPrice, isTopSeller, parseScaleBarcode, productCategory, updatedText } from './catalog.js';
import { openProduct } from './card.js';

/* ── Сканер штрихкода ─────────────────────────────
 * Android/Chrome — встроенный распознаватель (BarcodeDetector).
 * iPhone/Safari и остальные — библиотека html5-qrcode (грузится один раз при
 * первом сканировании). Кнопка доступна всем: сотрудник сканирует товар на
 * полке и сразу видит его карточку с кодами. */

let scanStopFn = null;

export function stopScan() {
  if (scanStopFn) { scanStopFn(); scanStopFn = null; }
}

/* keepOpen — режим «подряд»: камера не закрывается после каждого товара.
 * Раньше после каждого штрихкода окно захлопывалось, и чтобы проверить пять
 * ценников подряд, сотрудник пять раз открывал камеру заново.
 * Один и тот же код в течение REPEAT_MS не считаем повторно — иначе кадр за
 * кадром распознаётся одно и то же. */
const REPEAT_MS = 2500;
export async function startScan(onResult, { keepOpen = false } = {}) {
  openSheet('scanSheet');
  $('scanFallback').hidden = true;
  let finished = false;
  const recent = new Map();
  const done = (text) => {
    const t = String(text).trim();
    if (keepOpen) {
      const now = Date.now();
      if (now - (recent.get(t) || 0) < REPEAT_MS) return;
      recent.set(t, now);
      for (const [code, at] of recent) if (now - at >= REPEAT_MS) recent.delete(code);
      try { navigator.vibrate && navigator.vibrate(40); } catch (e) { /* необязательно */ }
      onResult(t);
      return;                       // камера продолжает работать
    }
    if (finished) return;
    finished = true;
    closeSheet('scanSheet'); // closeSheet сам остановит камеру
    onResult(t);
  };
  try {
    if ('BarcodeDetector' in window) await scanNative(done);
    else await scanWithLibrary(done);
  } catch (e) {
    if (e && e.code === 'SCANNER_LIBRARY') {
      $('scanContainer').textContent = 'Распознавание сейчас недоступно. Проверь связь и попробуй снова.';
      $('scanFallback').hidden = false;
    } else {
      toast('Камера недоступна. Разреши доступ к камере в настройках браузера');
      closeSheet('scanSheet');
    }
  }
}

/* Несколько упаковок попали в кадр: читаем ближайший к середине рамки код,
 * а не случайный первый из массива распознавателя. */
function centeredCode(codes, video) {
  const valid = codes.filter((x) => x.rawValue);
  const cx = video.videoWidth / 2; const cy = video.videoHeight / 2;
  valid.sort((a, b) => {
    const dist = (x) => {
      const r = x.boundingBox;
      if (!r) return Infinity;
      return (r.x + r.width / 2 - cx) ** 2 + (r.y + r.height / 2 - cy) ** 2;
    };
    return dist(a) - dist(b);
  });
  return valid[0] && valid[0].rawValue;
}

/* Что ловим. Сканер ОДИН: он сам разбирается, штрихкод перед ним или QR —
 * отдельных режимов нет, человек просто наводит камеру (решение владельца).
 * Поэтому к магазинным штрихкодам добавлены qr_code и data_matrix: QR висят
 * на витринах, в накладных и на упаковке, и раньше камера их молча не
 * замечала. Список всё равно сужен: распознавать «всё подряд» медленнее. */
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39',
  'itf', 'codabar', 'qr_code', 'data_matrix'];

/* Камера с отступлением. Раньше просили сразу всё — задняя камера, Full HD,
 * непрерывная фокусировка одной строкой — и если телефон хоть одного не умел,
 * браузер отвечал отказом ЦЕЛИКОМ, а человек видел «камера недоступна», хотя
 * камера работает. Теперь просим по убыванию: лучшее — приемлемое — хоть
 * какое-нибудь. Фокусировку просим только как пожелание (advanced): она не
 * стандартная, и требовать её нельзя. */
async function openCamera() {
  const tries = [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 },
      advanced: [{ focusMode: 'continuous' }] },
    { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    { facingMode: 'environment' },
    true,
  ];
  let last = null;
  for (const video of tries) {
    try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
    catch (e) { last = e; }
  }
  throw last || new Error('camera');
}

async function scanNative(done) {
  const box = $('scanContainer');
  box.innerHTML = '';
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  box.appendChild(video);
  // просим камеру повыше разрешением и с постоянной фокусировкой — резче мелкие
  // и некачественные штрихкоды
  const stream = await openCamera();
  const track = stream.getVideoTracks()[0];
  let active = true;
  scanStopFn = () => {
    active = false;
    /* Гасим подсветку. applyConstraints возвращает ОБЕЩАНИЕ: обычный try/catch
       ловит только мгновенные ошибки, а отказ приходит позже — и прилетал в
       приложение как «что-то пошло не так» после КАЖДОГО скана, на всех
       телефонах, где камера не умеет этой настройки. Ловим и отказ тоже. */
    try {
      const off = track && track.applyConstraints({ advanced: [{ torch: false }] });
      if (off && typeof off.catch === 'function') off.catch(() => { /* камера не умеет — не беда */ });
    } catch (e) { /* не умеет вовсе */ }
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
      const code = centeredCode(codes, video);
      if (code) { done(code); if (!active) return; }
      /* Инверсия — приём для редкого случая (светлый код на тёмном фоне), а
         стоит она целого кадра: копия картинки и проход по всем точкам. Раньше
         её делали на каждом втором кадре, и обычные штрихкоды из-за этого
         ловились вдвое реже. Теперь каждый четвёртый. */
      if (video.videoWidth && (frame++ % 4 === 0)) {
        const w = Math.min(960, video.videoWidth); const h = Math.round(video.videoHeight * (w / video.videoWidth));
        canvas.width = w; canvas.height = h;
        cx.drawImage(video, 0, 0, w, h);
        const img = cx.getImageData(0, 0, w, h);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
        cx.putImageData(img, 0, 0);
        const inv = await detector.detect(canvas);
        const inverted = centeredCode(inv, video);
        if (inverted) { done(inverted); if (!active) return; }
      }
    } catch (e) { /* кадр не считался — пробуем дальше */ }
    /* Следующий кадр — сразу, как браузер его нарисует. Раньше ждали 160 мс
       между попытками: это шесть кадров в секунду, и ценник приходилось
       держать перед камерой неподвижно по несколько секунд. */
    if (active) requestAnimationFrame(tick);
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
  btn.textContent = 'Подсветка';
  btn.onclick = async () => {
    on = !on;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.textContent = on ? 'Выключить подсветку' : 'Подсветка'; }
    catch (e) { toast('Подсветка недоступна на этом телефоне'); }
  };
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      s.onload = s.onerror = null;
      if (error) { s.remove(); rej(error); } else res();
    };
    const timer = setTimeout(() => finish(new Error('script timeout')), 10000);
    s.onload = () => finish();
    s.onerror = () => finish(new Error('script load failed'));
    document.head.appendChild(s);
  });
}

async function scanWithLibrary(done) {
  if (!window.Html5Qrcode) {
    toast('Включаем сканер…');
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js');
      if (!window.Html5Qrcode) throw new Error('library missing');
    } catch (cause) {
      const error = new Error('scanner library unavailable');
      error.code = 'SCANNER_LIBRARY';
      throw error;
    }
  }
  $('scanContainer').innerHTML = '';
  // магазинные штрихкоды И QR: сканер один, режимов не делим
  let formats;
  try {
    const F = window.Html5QrcodeSupportedFormats;
    formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.CODABAR,
      F.QR_CODE, F.DATA_MATRIX].filter((x) => x != null);
  } catch (e) { formats = undefined; }
  const scanner = new window.Html5Qrcode('scanContainer', formats ? { formatsToSupport: formats } : undefined);
  scanStopFn = () => { scanner.stop().then(() => scanner.clear()).catch(() => {}); $('scanTorch').hidden = true; };
  /* Окно наведения. Было 260x170 — узкая горизонтальная щель: длинный
     штрихкод в неё ещё попадал, а квадратный QR уже нет, и попасть в неё с
     вытянутой руки трудно. Берём большой квадрат по ширине кадра: он ловит
     и то, и другое, и целиться проще. */
  const qrbox = (w, h) => { const side = Math.round(Math.min(w, h) * 0.8); return { width: side, height: side }; };
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 15, qrbox },
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

/* ── Ценник покупателя ──────────────────────────────────────────────────────
 * Человек в зале навёл камеру на упаковку — и хочет узнать ровно то, что
 * написано (или должно быть написано) на ценнике: сколько стоит, есть ли
 * товар, когда его привезли, что это вообще такое. Раньше это была узкая
 * проверка для сотрудника: название, цена, код. Владелец решил иначе —
 * ценник теперь для ПОКУПАТЕЛЯ и показывает всё, что ему интересно, а
 * сотруднику он не нужен: у того в карточке товара и так есть всё.
 *
 * Карточку поверх камеры не открываем: ценник остаётся под видоискателем,
 * и следующий товар сканируется сразу, без лишних нажатий. */
/* Найти товар по штрихкоду. Сначала как обычно — по напечатанному на
 * упаковке коду. Не нашли — пробуем прочитать этикетку магазинных весов:
 * там внутри лежит код товара и вес. Догадку принимаем, только если код
 * действительно нашёлся в каталоге: иначе обычный штрихкод, начинающийся с
 * двойки, мог бы притвориться весовым. */
/* ── Что вообще поймала камера ───────────────────────────────────────────
 * Сканер один на штрихкоды и QR, значит в руках может оказаться что угодно:
 * цифры с упаковки, ссылка на наш же каталог, чужая ссылка, просто текст.
 * Разбираем ТУТ, один раз, чтобы остальной код про это не думал. */
function readScan(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { kind: 'empty', raw, value: '' };
  // только цифры (возможно с пробелами/дефисами) — обычный штрихкод
  if (/^[\d\s-]+$/.test(raw)) return { kind: 'code', raw, value: raw.replace(/\D/g, '') };
  // ссылка: наш каталог кладёт товар в ?p=… или #p=…
  if (/^(https?:)?\/\//i.test(raw) || /^[\w.-]+\.[a-z]{2,}\//i.test(raw)) {
    const mine = /[?#&]p=([^&#\s]+)/.exec(raw);
    if (mine) return { kind: 'product', raw, value: decodeURIComponent(mine[1]) };
    // чужая ссылка: иногда внутри лежит сам штрихкод (…/product/4600000000011)
    const digits = (raw.match(/\d{8,14}/g) || []).sort((a, b) => b.length - a.length)[0];
    if (digits) return { kind: 'code', raw, value: digits };
    return { kind: 'link', raw, value: raw };
  }
  // длинная цифровая часть внутри текста — тоже считаем кодом
  const inside = (raw.match(/\d{8,14}/g) || []).sort((a, b) => b.length - a.length)[0];
  if (inside) return { kind: 'code', raw, value: inside };
  return { kind: 'text', raw, value: raw };
}

/* Указатель «штрихкод → товар». Раньше каждый скан обходил весь каталог и у
 * каждого товара — все его штрихкоды: на 16 тысячах товаров это заметная
 * пауза ровно в тот момент, когда человек держит камеру у полки.
 * Собирается один раз на каталог и сам сбрасывается после новой выгрузки. */
let bcIndex = null; let bcGen = -1;
function barcodeIndex() {
  if (bcIndex && bcGen === state.dataGen) return bcIndex;
  const m = new Map();
  const put = (k, p) => { if (k && !m.has(k)) m.set(k, p); };
  for (const p of state.products) {
    for (const b of (p.barcodes || [])) for (const k of bcKeys(b)) put(k, p);
    if (p.code != null && String(p.code).trim()) put('c:' + String(p.code).trim(), p);
  }
  bcIndex = m; bcGen = state.dataGen;
  return m;
}

/* Один штрихкод — несколько написаний. Это и была главная причина, по которой
 * «товар не найден» при живом товаре:
 *   • 1С отдаёт UPC-A в 12 цифр, камера читает его же как EAN-13 с нулём
 *     впереди (и наоборот);
 *   • в выгрузке попадаются пробелы, дефисы и ведущие нули;
 *   • EAN-8 иногда записан как 13 цифр с нулями слева.
 * Поэтому у каждого штрихкода несколько ключей, и совпадение по любому
 * считается попаданием. */
function bcKeys(b) {
  const d = String(b == null ? '' : b).replace(/\D/g, '');
  if (!d) return [];
  const keys = new Set([d]);
  keys.add(d.replace(/^0+/, '') || d);          // без ведущих нулей
  if (d.length === 12) keys.add('0' + d);       // UPC-A -> EAN-13
  if (d.length === 13 && d[0] === '0') keys.add(d.slice(1));  // EAN-13 -> UPC-A
  return [...keys].filter(Boolean);
}

export function findByBarcode(text) {
  const r = readScan(text);
  if (r.kind === 'empty') return null;
  const idx = barcodeIndex();

  // ссылка на наш каталог — товар назван прямо
  if (r.kind === 'product') {
    const p = state.products.find((x) => String(x.id) === r.value);
    if (p) return { p, grams: 0 };
  }
  if (r.kind === 'code') {
    for (const k of bcKeys(r.value)) { const p = idx.get(k); if (p) return { p, grams: 0 }; }
    // этикетка магазинных весов: внутри код товара и вес этой упаковки
    const sc = parseScaleBarcode(r.value);
    if (sc) { const p = idx.get('c:' + sc.code); if (p) return { p, grams: sc.grams }; }
    // не штрихкод — может быть просто код товара с ценника
    const p = idx.get('c:' + r.value) || idx.get('c:' + String(Number(r.value)));
    if (p) return { p, grams: 0 };
  }
  // последняя попытка: вдруг это точный код товара, записанный не цифрами
  const byCode = state.products.find((x) => x.code != null && norm(x.code) === norm(r.value));
  return byCode ? { p: byCode, grams: 0 } : null;
}

/* Сумма к оплате — с копейками, как на этикетке весов: «181,50 ₽», а не
 * «181,5 ₽». Это то самое число, которое человек увидит на кассе, и оно
 * должно совпадать до копейки. У ровных сумм копейки не дописываем. */
const fmtMoney = (n) => Number(n).toLocaleString('ru-RU',
  { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' ₽';

export function scanToPrice(text) {
  const box = $('scanResult');
  if (!box) return;
  const found = findByBarcode(text);
  const p = found && found.p;
  const grams = found ? found.grams : 0;
  box.hidden = false;
  if (!p) {
    const r = readScan(text);
    // ссылку целиком не показываем — она не помещается и ничего не говорит
    const shown = r.kind === 'link' ? 'ссылка' : (r.value || r.raw);
    box.innerHTML = `<div class="scan-result-miss">Такого товара у нас нет</div>
      <div class="scan-result-code">${esc(String(shown).slice(0, 40))}</div>`;
    return;
  }
  const has = (v) => v != null && v !== '';
  const price = has(p.retail_price) ? fmtPrice(p.retail_price) : 'цена не указана';
  // «за кг» / «за шт» — покупателю важно, с чем он сравнивает цену
  const per = p.is_weighted ? 'за кг' : (p.unit ? 'за ' + p.unit : '');
  const st = stockLabel(p);
  const cat = productCategory(p);
  /* Этикетка с весов: в ней записан вес именно этой упаковки, значит можно
     сразу сказать, сколько человек заплатит на кассе. Ради этого весовую
     этикетку и разбираем — иначе он видит только цену за килограмм. */
  const kg = grams / 1000;
  const sum = grams && Number(p.retail_price) > 0 ? Number(p.retail_price) * kg : 0;
  const rows = [
    grams ? ['Вес этой упаковки', fmtNum(kg) + ' кг'] : null,
    p.arrival_at ? ['Поступил', fmtDate(p.arrival_at)] : null,
    cat ? ['Раздел', cat] : null,
    p.code ? ['Код товара', p.code] : null,
  ].filter(Boolean);
  box.innerHTML = `<div class="pt">
    <div class="pt-name">${esc(p.name)}</div>
    <div class="pt-price">${esc(price)}${per ? `<span class="pt-per">${esc(per)}</span>` : ''}</div>
    ${sum ? `<div class="pt-sum">К оплате <b>${esc(fmtMoney(sum))}</b>
      <span class="pt-sum-sub">за ${esc(fmtNum(kg))} кг по этикетке</span></div>` : ''}
    ${st ? `<div class="tag ${st.cls} pt-stock">${st.txt}</div>` : ''}
    ${isTopSeller(p) ? '<div class="tag tag-hit pt-stock">Часто берут</div>' : ''}
    ${updatedText() ? `<div class="pt-when">Обновлено ${esc(updatedText())}</div>` : ''}
    ${has(p.description) ? `<div class="pt-desc">${esc(p.description)}</div>` : ''}
    <div class="pt-rows">${rows.map(([k, v]) => `<div class="pt-row">
      <span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <button class="btn btn-primary btn-block" data-shop-scanned="${esc(p.id)}">В список покупок</button>
    ${state.session ? '' : `<button class="btn btn-secondary btn-block" data-shelf-scanned="${esc(p.id)}">Цена на ценнике другая</button>`}
    <button class="btn btn-secondary btn-block" data-open-scanned="${esc(p.id)}">Открыть товар</button>
  </div>`;
}

export function scanToSearch(text) {
  const found = findByBarcode(text);
  /* Весовая этикетка у сотрудника: он сверяет, что весы напечатали, — ему
     нужны вес и сумма, а не карточка товара. Поэтому показываем ценник и
     не закрываем камеру: этикеток обычно проверяют несколько подряд.
     Решение владельца: у сотрудника ценника нет, кроме этого случая. */
  if (found && found.grams) { scanToPrice(text); return; }
  // обычный штрихкод — открываем карточку и камеру закрываем: держать её
  // включённой под карточкой незачем, да и телефон греется
  if (found) {
    closeSheet('scanSheet');
    openProduct(found.p);
    return;
  }
  /* Не нашли. Что положить в поиск — зависит от того, ЧТО поймала камера.
     Раньше туда уходило всё подряд, и после QR в строке поиска оказывалась
     ссылка целиком: искать по ней бессмысленно, а человек видел пустую
     выдачу и думал, что сломался поиск. */
  const r = readScan(text);
  const result = $('scanResult');
  if (result) {
    const shown = r.kind === 'link' ? 'ссылка' : (r.value || r.raw);
    result.hidden = false;
    result.innerHTML = `<div class="scan-result-miss">Товар не найден</div>
      <div class="scan-result-code">${esc(String(shown).slice(0, 40))}</div>
      <div class="scan-result-hint">Проверь код или найди товар по названию в поиске.</div>`;
  }
  const put = (q) => {
    const input = $('searchInput');
    input.value = q;
    state.query = q;
    $('searchClear').hidden = !q;
    renderActiveFilters();
    renderGrid();
  };
  if (r.kind === 'link') { toast('Это ссылка, а не товар магазина'); return; }
  if (r.kind === 'text') { put(r.value); toast('Ищем по надписи с кода'); return; }
  put(r.value);
  toast('Товар с таким кодом в каталоге не найден');
}

/* Действия на ценнике: положить в список, сообщить о неверном ценнике,
 * открыть карточку. Обработчик живёт здесь, рядом с самим ценником: app.js
 * уже дорос до предела, который держит проверка «модули».
 * Зависимости приходят доводами, а не импортами: список покупок и связь с
 * магазином про сканер ничего не знают, и знать им незачем. */
export function bindScanResult(openProductFn, toggleShopFn, openShelfFn) {
  $('scanResult').addEventListener('click', (e) => {
    // «В список покупок» — камеру не закрываем: человек идёт по залу дальше
    const add = e.target.closest('[data-shop-scanned]');
    if (add) {
      const p = state.products.find((x) => x.id === add.dataset.shopScanned);
      if (!p) return;
      const added = toggleShopFn(p);
      add.textContent = added ? 'Убрать из списка покупок' : 'В список покупок';
      toast(added ? 'Записал в список покупок' : 'Убрано из списка');
      return;
    }
    // «цена на ценнике другая» — тоже у полки, камеру оставляем включённой
    const shelf = e.target.closest('[data-shelf-scanned]');
    if (shelf) {
      const p = state.products.find((x) => x.id === shelf.dataset.shelfScanned);
      if (p) openShelfFn(p);
      return;
    }
    const b = e.target.closest('[data-open-scanned]');
    if (!b) return;
    stopScan();
    closeSheet('scanSheet');
    const p = state.products.find((x) => x.id === b.dataset.openScanned);
    if (p) openProductFn(p);
  });
}
