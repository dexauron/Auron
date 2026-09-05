/* ============================================================================
   Меню «⋮» у строки, буфер копирования записи и отмена последнего действия.
   Три мелочи, без которых править записи неудобно.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMEntry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function txt(v) { return v == null ? '' : String(v).trim(); }

  // Какие пункты показывать в меню строки
  function rowMenu(opts) {
    opts = opts || {};
    var acts = [];
    if (opts.more) acts.push('more');
    if (opts.form) { acts.push('edit'); acts.push('repeat'); }
    acts.push('copy');
    if (opts.extra) acts = acts.concat(opts.extra);
    acts.push('del');
    return acts;
  }

  /* --- Буфер: копировать запись и вставить в другую форму -------------------- */
  var CLIP = null;
  function copy(rec, from) {
    if (!rec) return null;
    var v = {};
    Object.keys(rec).forEach(function (k) {
      if (k === 'id' || k === 'key' || k.charAt(0) === '_') return;
      if (rec[k] === '' || rec[k] == null) return;
      v[k] = rec[k];
    });
    CLIP = { from: from || '', values: v, at: new Date().toISOString() };
    return CLIP;
  }
  function clip() { return CLIP; }
  function clearClip() { CLIP = null; }

  /* --- Отмена: последняя правка, которую ещё не отменяли --------------------- */
  function lastUndoable(log) {
    var rows = (log || []).slice().reverse();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].undone) return rows[i];
    }
    return null;
  }

  return { rowMenu: rowMenu, copy: copy, clip: clip, clearClip: clearClip,
    lastUndoable: lastUndoable, txt: txt };
});
