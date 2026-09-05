/* ============================================================================
   Быстрый ввод: сканер штрихкодов, шаблоны, горячие клавиши.

   Всё это про одно: чтобы записать было быстрее, чем не записать.
   — сканер штрихкодов работает как клавиатура: ловим быструю «печать»,
     заканчивающуюся Enter, и подставляем товар;
   — частые записи сохраняются шаблоном и вставляются одной кнопкой;
   — Ctrl+S сохраняет форму, Ctrl+Enter — сохраняет и открывает следующую.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMInput = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }

  /* --- Сканер штрихкодов -----------------------------------------------------
     Сканер прикидывается клавиатурой: «печатает» код за доли секунды и жмёт
     Enter. Человек так быстро не набирает — по скорости и отличаем.
     ---------------------------------------------------------------------- */
  function scanner(onCode, opts) {
    opts = opts || {};
    var minLen = opts.minLen || 6;          // короче — это не штрихкод
    var maxGap = opts.maxGap || 60;         // мс между символами у сканера
    var buf = '', last = 0;
    return function (e) {
      var now = Date.now();
      if (now - last > maxGap) buf = '';
      last = now;
      if (e.key === 'Enter') {
        var code = buf; buf = '';
        if (code.length >= minLen && /^[0-9A-Za-z\-]+$/.test(code)) {
          onCode(code, e);
          return true;                      // это был сканер, событие наше
        }
        return false;
      }
      if (e.key && e.key.length === 1) buf += e.key;
      return false;
    };
  }

  // Найти товар по штрихкоду или коду в остатках и прайсах
  function findByCode(code, stock, prices) {
    var c = String(code || '').replace(/^0+/, '');
    function same(v) { return String(v || '').replace(/^0+/, '') === c; }
    var i;
    for (i = 0; i < (stock || []).length; i++) {
      if (same(stock[i].barcode) || same(stock[i].article) || same(stock[i].code)) return stock[i];
    }
    for (i = 0; i < (prices || []).length; i++) {
      if (same(prices[i].barcode) || same(prices[i].article)) return prices[i];
    }
    return null;
  }

  /* --- Шаблоны частых записей ------------------------------------------------ */
  function templateFrom(form, values, name) {
    var v = {};
    Object.keys(values || {}).forEach(function (k) {
      if (k === 'date') return;             // дата всегда сегодняшняя
      if (values[k] !== '' && values[k] != null) v[k] = values[k];
    });
    return { id: 'tpl' + Date.now().toString(36), form: form, name: name || '', values: v,
      used: 0, at: new Date().toISOString() };
  }
  function templatesFor(list, form) {
    return (list || []).filter(function (t) { return t.form === form; })
      .sort(function (a, b) { return (b.used || 0) - (a.used || 0); });
  }
  // Имя шаблона по умолчанию: «Аренда · 168 000 ₽»
  function templateName(values) {
    var what = values.category || values.supplier || values.employee || values.name || 'Запись';
    var sum = num(values.amount != null ? values.amount : values.sum);
    return sum ? what + ' · ' + sum : what;
  }

  return {
    scanner: scanner, findByCode: findByCode,
    templateFrom: templateFrom, templatesFor: templatesFor, templateName: templateName
  };
});
