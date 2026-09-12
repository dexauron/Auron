// Разбор кода без запуска: ловит то, что глазами не видно и что не падает,
// пока человек не дойдёт до нужной кнопки.
//
// Именно так нашлись две настоящие поломки: вызов несуществующего помощника
// в списке новинок и вызов несуществующей функции на экране «Дозаполнить
// фото». Обе тихо ждали своего часа. Теперь такие вещи ловит проверка.
const path = require('path');
const fs = require('fs');
const { runner } = require('./helpers');

// Браузерные и рабочие имена, которые есть всегда — их не считаем «неизвестными»
const GLOBALS = ['window', 'document', 'navigator', 'location', 'localStorage', 'history', 'console',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'performance', 'indexedDB', 'crypto', 'caches', 'self',
  'Blob', 'File', 'FileReader', 'FormData', 'Image', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'atob', 'btoa', 'alert', 'confirm', 'prompt', 'Worker', 'Intl', 'PerformanceObserver', 'Event',
  'CustomEvent', 'DataTransfer', 'Response', 'Request', 'Headers', 'AbortController', 'matchMedia',
  'innerHeight', 'innerWidth', 'scrollTo', 'scrollBy', 'getComputedStyle', 'importScripts', 'postMessage',
  'structuredClone', 'createImageBitmap', 'CompressionStream', 'DecompressionStream', 'CSS', 'OffscreenCanvas',
  'MediaRecorder', 'ImageData', 'DOMParser', 'XMLHttpRequest', 'ResizeObserver', 'IntersectionObserver',
  'MutationObserver', 'queueMicrotask', 'BarcodeDetector', 'devicePixelRatio', 'open', 'close', 'name'];

(async () => {
  const { chk, done } = runner('РАЗБОР КОДА');
  const root = path.join(__dirname, '..');
  const files = [
    ...fs.readdirSync(path.join(root, 'js', 'modules')).filter((f) => f.endsWith('.js')).map((f) => `js/modules/${f}`),
    'js/config.js', 'js/xlsx-worker.js', 'sw.js',
  ];

  let eslint;
  try {
    // eslint стоит в системе; NODE_PATH тот же, что и для playwright
    const { ESLint } = require('eslint');
    eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: {
        languageOptions: {
          ecmaVersion: 2023,
          sourceType: 'module',
          globals: Object.fromEntries(GLOBALS.map((g) => [g, 'readonly'])),
        },
        rules: {
          'no-undef': 'error',              // вызов того, чего нет — главная цель
          'no-const-assign': 'error',
          'no-dupe-keys': 'error',
          'no-dupe-args': 'error',
          'no-duplicate-case': 'error',
          'no-unreachable': 'error',
          'no-func-assign': 'error',
          'no-obj-calls': 'error',
          'no-self-compare': 'error',
          'no-unsafe-negation': 'error',
          'use-isnan': 'error',
          'valid-typeof': 'error',
          'no-cond-assign': 'error',
          'no-sparse-arrays': 'error',
        },
      },
    });
  } catch (e) {
    console.log('OK: разбор кода пропущен — анализатор не установлен (' + (e.message || e).slice(0, 60) + ')');
    await done({ close: () => {} });
    return;
  }

  const results = await eslint.lintFiles(files.map((f) => path.join(root, f)));
  const problems = [];
  for (const r of results) {
    for (const m of r.messages) {
      if (m.severity !== 2) continue;
      problems.push(`${path.relative(root, r.filePath)}:${m.line} — ${m.message}`);
    }
  }
  chk(!problems.length, `в коде нет обращений к несуществующему и явных ошибок${
    problems.length ? ':\n    ' + problems.slice(0, 12).join('\n    ') : ` (проверено файлов: ${files.length})`}`);

  await done({ close: () => {} });
})();
