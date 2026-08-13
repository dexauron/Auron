// Сканер штрихкода камерой

import { $, state } from './store.js';
import { closeSheet, norm, openSheet, toast } from './core.js';
import { renderActiveFilters, renderGrid } from './render.js';
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

export async function startScan(onResult) {
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
export function scanToSearch(text) {
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
