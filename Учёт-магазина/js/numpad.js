/* ============================================================================
   Числовые поля: калькулятор, разделение разрядов и понятные даты.

   Зачем: владелец считает на бумажке «3 ящика по 1 250 плюс 400» и переносит
   результат в программу. Теперь считать можно прямо в поле — и видеть, что
   72500 это «72 500 ₽», а 2026-09-04 — «пятница, 4 сентября».

   — в любом числовом поле можно написать «1250*3+400» и нажать «=»;
   — под полем сразу видно сумму прописью и с пробелами: 72 500 ₽;
   — кнопка 🧮 открывает полноценный калькулятор с крупными кнопками;
   — рядом с датой подписан день недели и «сегодня / вчера / 3 дня назад».
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMNum = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- Счётчик выражений ----------------------------------------------------
     Считаем сами, без eval: разбираем строку в число по правилам школьной
     арифметики. Так в программу не может попасть чужой код.
     ---------------------------------------------------------------------- */
  var MAX = 1e12;

  // Разбор строки «1 250,5*3 + 400 - 10%» в число. null — если это не выражение.
  function calc(expr) {
    var src = String(expr == null ? '' : expr)
      .replace(/\s/g, '')
      .replace(/,/g, '.')
      .replace(/[×хХ*]/g, '*')
      .replace(/[÷:]/g, '/')
      .replace(/[–—−]/g, '-');
    if (!src) return null;
    if (!/^[\d.+\-*/()%]+$/.test(src)) return null;
    var pos = 0;

    function peek() { return src.charAt(pos); }
    function eat(ch) { if (peek() === ch) { pos++; return true; } return false; }

    function number() {
      var start = pos;
      while (/[\d.]/.test(peek())) pos++;
      if (start === pos) return NaN;
      var n = parseFloat(src.slice(start, pos));
      return isFinite(n) ? n : NaN;
    }
    function factor() {
      if (eat('-')) { var v = factor(); return isNaN(v) ? NaN : -v; }
      if (eat('+')) return factor();
      if (eat('(')) {
        var inner = expression();
        if (!eat(')')) return NaN;
        return inner;
      }
      return number();
    }
    // Кассирский процент: «200*15%» = 15% от 200, «1000-5%» = минус 5% от 1000.
    // Признак процента отдаём наверх, там решают, от чего его считать.
    var wasPercent = false;
    function unit() {
      var v = factor();
      wasPercent = false;
      while (eat('%')) { v = v / 100; wasPercent = true; }
      return v;
    }
    function term() {
      var v = unit();
      for (;;) {
        if (eat('*')) {
          var r = unit();
          if (isNaN(r)) return NaN;
          v = v * r;
        } else if (eat('/')) {
          var d = unit();
          if (isNaN(d) || d === 0) return NaN;
          v = v / d;
        } else return v;
      }
    }
    function expression() {
      var v = term();
      for (;;) {
        if (eat('+')) {
          var a = term(); if (isNaN(a)) return NaN;
          v += wasPercent ? v * a : a;      // «1000+5%» = 1050
        } else if (eat('-')) {
          var b = term(); if (isNaN(b)) return NaN;
          v -= wasPercent ? v * b : b;      // «1000-5%» = 950
        } else return v;
      }
    }
    var out = expression();
    if (pos !== src.length || isNaN(out) || !isFinite(out)) return null;
    if (Math.abs(out) > MAX) return null;
    return Math.round(out * 100) / 100;
  }

  // Это выражение, а не просто число?
  function isExpr(v) {
    return /[+\-*/()%×хХ÷:]/.test(String(v || '').replace(/^-/, ''));
  }

  /* --- Разделение разрядов --------------------------------------------------- */
  // Разряды разделяем неразрывным пробелом: «1 234 567» не переносится
  // на другую строку посреди суммы
  var NBSP = '\u00A0';
  function group(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var neg = v < 0; v = Math.abs(v);
    var whole = Math.floor(v);
    var cents = Math.round((v - whole) * 100);
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    if (cents) s += ',' + (cents < 10 ? '0' : '') + cents;
    return (neg ? '−' : '') + s;
  }
  function money(n) { return group(n) + ' ₽'; }

  // Сумма словами — чтобы не ошибиться на ноль: «семьдесят две тысячи пятьсот»
  var ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
    'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var ONES_F = ['', 'одна', 'две'];
  var TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  function trio(n, female) {
    var out = [];
    if (n >= 100) { out.push(HUNDREDS[Math.floor(n / 100)]); n %= 100; }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; }
    if (n > 0) out.push(female && n < 3 ? ONES_F[n] : ONES[n]);
    return out.filter(Boolean).join(' ');
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function words(n) {
    var v = Math.floor(Math.abs(Number(n) || 0));
    if (!v) return 'ноль';
    var parts = [];
    var mlrd = Math.floor(v / 1e9), mln = Math.floor(v % 1e9 / 1e6);
    var thou = Math.floor(v % 1e6 / 1000), rest = v % 1000;
    if (mlrd) parts.push(trio(mlrd) + ' ' + plural(mlrd, 'миллиард', 'миллиарда', 'миллиардов'));
    if (mln) parts.push(trio(mln) + ' ' + plural(mln, 'миллион', 'миллиона', 'миллионов'));
    if (thou) parts.push(trio(thou, true) + ' ' + plural(thou, 'тысяча', 'тысячи', 'тысяч'));
    if (rest) parts.push(trio(rest));
    return (Number(n) < 0 ? 'минус ' : '') + parts.join(' ');
  }

  /* --- Даты по-человечески --------------------------------------------------- */
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
    'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WEEK = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  function today() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(a, b) {
    var d1 = new Date(a), d2 = new Date(b);
    if (isNaN(d1) || isNaN(d2)) return null;
    return Math.round((d2 - d1) / 86400000);
  }
  // «пятница, 4 сентября 2026 · сегодня»
  function dateFull(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    var head = WEEK[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
    var diff = daysBetween(today(), iso);
    var near = diff === 0 ? 'сегодня' : (diff === 1 ? 'завтра' : (diff === -1 ? 'вчера'
      : (diff === -2 ? 'позавчера'
        : (diff < 0 ? Math.abs(diff) + ' ' + plural(Math.abs(diff), 'день', 'дня', 'дней') + ' назад'
          : 'через ' + diff + ' ' + plural(diff, 'день', 'дня', 'дней')))));
    return head + ' · ' + near;
  }

  /* --- Раскладка калькулятора ------------------------------------------------ */
  var KEYS = [
    ['7', '8', '9', '÷'],
    ['4', '5', '6', '×'],
    ['1', '2', '3', '−'],
    ['0', ',', '=', '+']
  ];
  // Быстрые суммы под калькулятором — то, что чаще всего добавляют руками
  var QUICK = [100, 500, 1000, 5000, 10000];

  return {
    calc: calc, isExpr: isExpr, group: group, money: money, words: words,
    dateFull: dateFull, daysBetween: daysBetween, plural: plural,
    KEYS: KEYS, QUICK: QUICK, MAX: MAX
  };
});
