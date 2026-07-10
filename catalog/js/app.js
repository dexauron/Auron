/* Way Market · Каталог товаров
 * Отдельное приложение с отдельной базой (Supabase). Не связано с Auron Finance.
 * Сотрудники: просмотр и поиск без входа. Владелец: вход → полное редактирование. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CFG = window.CATALOG_CONFIG || {};
  const CACHE_KEY = 'wm_catalog_cache_v1';
  const BUCKET = 'product-photos';
  const SEARCH_THRESHOLD = 25;

  const state = {
    groups: [],
    products: [],
    query: '',
    groupId: 'all',
    session: null,
    lastFetch: 0,
  };

  let sb = null;
  let currentProduct = null;   // товар, открытый в карточке
  let editingProduct = null;   // товар в форме редактирования (null = новый)
  let formPhotos = [];         // [{url}] сохранённые + [{blob, preview}] новые

  /* ── Утилиты ──────────────────────────────────── */

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();

  // Транслитерация: «сникерс» найдёт Snickers, snickers найдёт «Сникерс»
  const TR = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
    т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'u', я: 'a',
  };
  const translit = (s) => s.replace(/[а-я]/g, (ch) => TR[ch] ?? ch);
  // варианты строки для сравнения: как есть + в латинице
  const variants = (s) => {
    const t = translit(s);
    return t === s ? [s] : [s, t];
  };

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet(id) {
    $(id).hidden = true;
    if (![...document.querySelectorAll('.sheet-backdrop')].some((s) => !s.hidden)) {
      document.body.style.overflow = '';
    }
    if (id === 'scanSheet') stopScan();
  }

  function groupById(id) { return state.groups.find((g) => g.id === id) || null; }

  /* ── Умный поиск ──────────────────────────────── */

  function bigrams(s) {
    const set = [];
    const str = ` ${s} `;
    for (let i = 0; i < str.length - 1; i++) set.push(str.slice(i, i + 2));
    return set;
  }

  function dice(a, b) {
    if (!a.length || !b.length) return 0;
    const bCopy = [...b];
    let hits = 0;
    for (const g of a) {
      const i = bCopy.indexOf(g);
      if (i !== -1) { hits++; bCopy.splice(i, 1); }
    }
    return (2 * hits) / (a.length + b.length);
  }

  // сравнение текста с запросом с учётом транслитерации (рус ↔ англ)
  function matchText(text, qVars, weights) {
    let s = 0;
    for (const tv of variants(text)) {
      const words = tv.split(/\s+/).filter(Boolean);
      for (const qv of qVars) {
        if (tv.startsWith(qv)) s = Math.max(s, weights[0]);
        else if (words.some((w) => w.startsWith(qv))) s = Math.max(s, weights[1]);
        else if (tv.includes(qv)) s = Math.max(s, weights[2]);
      }
    }
    return s;
  }

  // нечёткое совпадение — прощает опечатки («хатдок» найдёт «хот-дог», «сникерс» — Snickers)
  function fuzzyScore(name, qVars) {
    let best = 0;
    for (const nv of variants(name)) {
      const clean = nv.replace(/[^a-zа-я0-9 ]/g, '');
      const words = clean.split(/\s+/).filter(Boolean);
      for (const qv of qVars) {
        const qWords = qv.replace(/[^a-zа-я0-9 ]/g, '').split(/\s+/).filter((w) => w.length >= 3);
        if (!qWords.length) continue;
        let total = 0;
        for (const qw of qWords) {
          const qb = bigrams(qw);
          let b = dice(qb, bigrams(clean.replace(/\s+/g, '')));
          for (const w of words) b = Math.max(b, dice(qb, bigrams(w)));
          total += b;
        }
        best = Math.max(best, total / qWords.length);
      }
    }
    return best;
  }

  function scoreProduct(p, q) {
    if (!q) return 1;
    const qVars = variants(q);
    const codes = [p.code, p.article, p.barcode, p.department].map(norm).filter(Boolean);
    let s = 0;

    for (const c of codes) {
      if (c === q) return 120;
      if (c.startsWith(q)) s = Math.max(s, 95);
      else if (c.includes(q)) s = Math.max(s, 70);
    }

    s = Math.max(s, matchText(norm(p.name), qVars, [100, 90, 80]));

    const gName = norm(groupById(p.group_id)?.name);
    if (gName) s = Math.max(s, matchText(gName, qVars, [45, 42, 40]));
    if (p.note) s = Math.max(s, matchText(norm(p.note), qVars, [38, 36, 35]));
    if (p.is_weighted && ('весовой'.startsWith(q) || 'весовые'.startsWith(q) || q === 'вес')) {
      s = Math.max(s, 45);
    }

    const fuzzy = fuzzyScore(norm(p.name), qVars);
    if (fuzzy >= 0.4) s = Math.max(s, Math.round(65 * fuzzy));
    return s;
  }

  function visibleProducts() {
    let list = state.products;
    if (state.groupId === 'none') list = list.filter((p) => !p.group_id);
    else if (state.groupId === 'weighted') list = list.filter((p) => p.is_weighted);
    else if (state.groupId !== 'all') list = list.filter((p) => p.group_id === state.groupId);

    const q = norm(state.query);
    if (!q) return list;
    return list
      .map((p) => ({ p, s: scoreProduct(p, q) }))
      .filter((x) => x.s >= SEARCH_THRESHOLD)
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name, 'ru'))
      .map((x) => x.p);
  }

  /* ── Отрисовка ────────────────────────────────── */

  function renderChips() {
    const counts = {};
    let noGroup = 0;
    let weighted = 0;
    for (const p of state.products) {
      if (p.group_id) counts[p.group_id] = (counts[p.group_id] || 0) + 1;
      else noGroup++;
      if (p.is_weighted) weighted++;
    }
    let html = chipHtml('all', 'Все', state.products.length);
    if (weighted > 0) html += chipHtml('weighted', '⚖ Весовые', weighted);
    for (const g of state.groups) html += chipHtml(g.id, g.name, counts[g.id] || 0);
    if (noGroup > 0) html += chipHtml('none', 'Без группы', noGroup);
    $('groupChips').innerHTML = html;
  }

  function chipHtml(id, name, count) {
    const active = state.groupId === id ? ' active' : '';
    return `<button class="chip${active}" data-group="${esc(id)}">${esc(name)}<span class="chip-count">${count}</span></button>`;
  }

  function renderGrid() {
    const list = visibleProducts();
    const grid = $('productGrid');
    $('loader').hidden = true;

    if (!list.length) {
      grid.innerHTML = '';
      const empty = $('emptyState');
      empty.hidden = false;
      if (!state.products.length) {
        empty.querySelector('.empty-icon').textContent = '📦';
        empty.querySelector('.empty-title').textContent = 'Каталог пока пустой';
        empty.querySelector('.empty-text').textContent = state.session
          ? 'Нажми ＋ внизу, чтобы добавить первый товар'
          : 'Администратор скоро его заполнит';
      } else {
        empty.querySelector('.empty-icon').textContent = '🔍';
        empty.querySelector('.empty-title').textContent = 'Ничего не нашлось';
        empty.querySelector('.empty-text').textContent = 'Попробуй написать по-другому или выбери группу';
      }
      return;
    }

    $('emptyState').hidden = true;
    grid.innerHTML = list.map((p) => {
      const photo = (p.photos || [])[0];
      const img = photo
        ? `<img src="${esc(photo)}" alt="" loading="lazy">`
        : '📦';
      const tags = [];
      if (p.code) tags.push(`<span class="tag tag-code">Код ${esc(p.code)}</span>`);
      if (p.is_weighted) tags.push('<span class="tag">⚖ весовой</span>');
      if (p.department) tags.push(`<span class="tag">Отдел ${esc(p.department)}</span>`);
      if (!p.barcode) tags.push('<span class="tag tag-nobarcode">без штрихкода</span>');
      return `<article class="card" data-id="${esc(p.id)}">
        <div class="card-photo">${img}</div>
        <div class="card-body">
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-tags">${tags.join('')}</div>
        </div>
      </article>`;
    }).join('');
  }

  function renderAll() { renderChips(); renderGrid(); }

  /* ── Карточка товара ──────────────────────────── */

  function openProduct(p) {
    currentProduct = p;
    $('sheetName').textContent = p.name;

    const photos = p.photos || [];
    $('sheetPhotos').innerHTML = photos.length
      ? photos.map((u) => `<img src="${esc(u)}" alt="">`).join('')
      : '<div class="photo-placeholder">📦</div>';
    $('sheetDots').innerHTML = photos.length > 1
      ? photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')
      : '';
    $('sheetPhotos').scrollLeft = 0;

    const badges = [];
    const g = groupById(p.group_id);
    if (g) badges.push(`<span class="tag">${esc(g.name)}</span>`);
    if (p.is_weighted) badges.push('<span class="tag">⚖ Весовой товар</span>');
    if (!p.barcode) badges.push('<span class="tag tag-nobarcode">⚠ Штрихкода нет — пробивать по коду</span>');
    $('sheetBadges').innerHTML = badges.join('');

    const rows = [];
    if (p.code) rows.push(fieldRow('Код кассы', p.code, true));
    if (p.article) rows.push(fieldRow('Артикул', p.article, false, true));
    if (p.barcode) rows.push(fieldRow('Штрихкод', p.barcode, false, true));
    if (p.department) rows.push(fieldRow('Отдел', p.department));
    if (p.note) rows.push(`<div class="field-row"><span class="field-key">Примечание</span><span class="field-val" style="font-weight:400;font-size:14px">${esc(p.note)}</span></div>`);
    if (!rows.length) rows.push('<div class="field-row"><span class="field-key">Коды не указаны</span></div>');
    $('sheetFields').innerHTML = rows.join('');

    $('sheetAdminActions').hidden = !state.session;
    openSheet('productSheet');
  }

  function fieldRow(key, val, main = false, copy = false) {
    const cls = main ? ' field-main' : '';
    const copyBtn = (copy || main)
      ? `<button class="copy-btn" data-copy="${esc(val)}">⧉</button>`
      : '';
    return `<div class="field-row${cls}"><span class="field-key">${esc(key)}</span><span class="field-val">${esc(val)}</span>${copyBtn}</div>`;
  }

  /* ── Данные ───────────────────────────────────── */

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c && Array.isArray(c.products)) {
        state.groups = c.groups || [];
        state.products = c.products;
        state.lastFetch = c.ts || 0;
        return true;
      }
    } catch (e) { /* повреждённый кэш игнорируем */ }
    return false;
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        groups: state.groups, products: state.products, ts: Date.now(),
      }));
    } catch (e) { /* нет места — не страшно, кэш вспомогательный */ }
  }

  async function fetchData() {
    const [g, p] = await Promise.all([
      sb.from('catalog_groups').select('*').order('sort_order').order('name'),
      sb.from('catalog_products').select('*').order('name'),
    ]);
    if (g.error) throw g.error;
    if (p.error) throw p.error;
    state.groups = g.data;
    state.products = p.data;
    state.lastFetch = Date.now();
    saveCache();
    $('offlineBanner').hidden = true;
  }

  async function refresh({ silent = false } = {}) {
    try {
      await fetchData();
      renderAll();
    } catch (e) {
      if (!silent) {
        const banner = $('offlineBanner');
        if (state.products.length) {
          const mins = Math.max(1, Math.round((Date.now() - state.lastFetch) / 60000));
          banner.textContent = `📶 Нет связи с базой. Показан каталог, сохранённый ${mins < 60 ? mins + ' мин' : Math.round(mins / 60) + ' ч'} назад`;
        } else {
          banner.textContent = '📶 Нет связи с базой данных. Проверь интернет и обнови страницу';
        }
        banner.hidden = false;
        $('loader').hidden = true;
        renderAll();
      }
    }
  }

  /* ── Админ: вход/выход ────────────────────────── */

  function setAdmin(session) {
    state.session = session;
    $('fabAdd').hidden = !session;
    $('adminBtn').classList.toggle('is-admin', !!session);
    if (!$('productSheet').hidden) $('sheetAdminActions').hidden = !session;
    renderGrid();
  }

  /* ── Админ: фото в форме ──────────────────────── */

  function renderPhotoManager() {
    const html = formPhotos.map((ph, i) => `
      <div class="photo-thumb">
        <img src="${esc(ph.url || ph.preview)}" alt="">
        <button type="button" class="thumb-x" data-idx="${i}">✕</button>
      </div>`).join('');
    $('photoManager').innerHTML = html + '<button type="button" class="photo-add" id="photoAddBtn">📷</button>';
  }

  async function compressImage(file, maxSide = 1280, quality = 0.82) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      return blob || file;
    } catch (e) {
      return file; // формат не поддержан — грузим как есть
    }
  }

  async function uploadPhoto(blob) {
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg', cacheControl: '31536000',
    });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function removePhotosFromStorage(urls) {
    const paths = urls
      .map((u) => { const m = u.split(`/${BUCKET}/`)[1]; return m ? decodeURIComponent(m) : null; })
      .filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
  }

  /* ── Админ: форма товара ──────────────────────── */

  function openForm(product) {
    editingProduct = product;
    $('formTitle').textContent = product ? 'Изменить товар' : 'Новый товар';
    $('fName').value = product?.name || '';
    $('fCode').value = product?.code || '';
    $('fArticle').value = product?.article || '';
    $('fBarcode').value = product?.barcode || '';
    $('fWeighted').checked = !!product?.is_weighted;
    $('fDepartment').value = product?.department || '';
    $('fNote').value = product?.note || '';
    $('fGroup').innerHTML = '<option value="">Без группы</option>' +
      state.groups.map((g) => `<option value="${esc(g.id)}"${g.id === product?.group_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    formPhotos = (product?.photos || []).map((url) => ({ url }));
    renderPhotoManager();
    $('formError').hidden = true;
    openSheet('formSheet');
  }

  async function submitForm(e) {
    e.preventDefault();
    const btn = $('formSubmit');
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    $('formError').hidden = true;
    try {
      // загружаем новые фото
      const photoUrls = [];
      for (const ph of formPhotos) {
        if (ph.url) photoUrls.push(ph.url);
        else photoUrls.push(await uploadPhoto(ph.blob));
      }
      const record = {
        name: $('fName').value.trim(),
        group_id: $('fGroup').value || null,
        code: $('fCode').value.trim() || null,
        article: $('fArticle').value.trim() || null,
        barcode: $('fBarcode').value.trim() || null,
        is_weighted: $('fWeighted').checked,
        department: $('fDepartment').value.trim() || null,
        note: $('fNote').value.trim() || null,
        photos: photoUrls,
        updated_at: new Date().toISOString(),
      };
      if (editingProduct) {
        const removed = (editingProduct.photos || []).filter((u) => !photoUrls.includes(u));
        const { error } = await sb.from('catalog_products').update(record).eq('id', editingProduct.id);
        if (error) throw error;
        await removePhotosFromStorage(removed);
        toast('Товар обновлён ✓');
      } else {
        const { error } = await sb.from('catalog_products').insert(record);
        if (error) throw error;
        toast('Товар добавлен ✓');
      }
      closeSheet('formSheet');
      closeSheet('productSheet');
      await refresh({ silent: true });
      renderAll();
    } catch (err) {
      $('formError').textContent = 'Не удалось сохранить: ' + (err.message || err);
      $('formError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  }

  async function deleteProduct() {
    if (!currentProduct) return;
    if (!confirm(`Удалить «${currentProduct.name}» из каталога?`)) return;
    try {
      const { error } = await sb.from('catalog_products').delete().eq('id', currentProduct.id);
      if (error) throw error;
      await removePhotosFromStorage(currentProduct.photos || []);
      toast('Товар удалён');
      closeSheet('productSheet');
      await refresh({ silent: true });
      renderAll();
    } catch (err) {
      toast('Ошибка удаления: ' + (err.message || err));
    }
  }

  /* ── Админ: группы ────────────────────────────── */

  function renderGroupsManager() {
    $('groupsList').innerHTML = state.groups.map((g) => `
      <div class="group-row" data-id="${esc(g.id)}">
        <input class="input group-name" value="${esc(g.name)}">
        <button class="group-del" title="Удалить группу">🗑</button>
      </div>`).join('') || '<p class="muted">Групп пока нет — добавь первую ниже</p>';
  }

  async function addGroup() {
    const name = $('newGroupName').value.trim();
    if (!name) return;
    const maxSort = Math.max(0, ...state.groups.map((g) => g.sort_order || 0));
    const { error } = await sb.from('catalog_groups').insert({ name, sort_order: maxSort + 1 });
    if (error) { toast('Ошибка: ' + error.message); return; }
    $('newGroupName').value = '';
    await refresh({ silent: true });
    renderAll();
    renderGroupsManager();
    toast('Группа добавлена ✓');
  }

  async function renameGroup(id, name) {
    if (!name.trim()) return;
    const { error } = await sb.from('catalog_groups').update({ name: name.trim() }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    await refresh({ silent: true });
    renderAll();
  }

  async function deleteGroup(id) {
    const g = groupById(id);
    if (!confirm(`Удалить группу «${g?.name}»? Товары останутся — без группы.`)) return;
    const { error } = await sb.from('catalog_groups').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    if (state.groupId === id) state.groupId = 'all';
    await refresh({ silent: true });
    renderAll();
    renderGroupsManager();
    toast('Группа удалена');
  }

  /* ── Сканер штрихкода ─────────────────────────────
   * Android/Chrome — встроенный распознаватель (BarcodeDetector).
   * iPhone/Safari и остальные — библиотека html5-qrcode (грузится один раз при
   * первом сканировании). Кнопка доступна всем: сотрудник сканирует товар на
   * полке и сразу видит его карточку с кодами. */

  let scanStopFn = null;

  function stopScan() {
    if (scanStopFn) { scanStopFn(); scanStopFn = null; }
  }

  async function startScan(onResult) {
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

  async function scanNative(done) {
    const box = $('scanContainer');
    box.innerHTML = '';
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    box.appendChild(video);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false,
    });
    let active = true;
    scanStopFn = () => {
      active = false;
      stream.getTracks().forEach((t) => t.stop());
      box.innerHTML = '';
    };
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const tick = async () => {
      if (!active) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) { done(codes[0].rawValue); return; }
      } catch (e) { /* кадр не считался — пробуем дальше */ }
      setTimeout(tick, 250);
    };
    tick();
  }

  function loadScript(src) {
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
    const scanner = new window.Html5Qrcode('scanContainer');
    scanStopFn = () => { scanner.stop().then(() => scanner.clear()).catch(() => {}); };
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10 },
      (text) => done(text),
    );
  }

  // сотрудник отсканировал штрихкод → ищем товар
  function scanToSearch(text) {
    const input = $('searchInput');
    input.value = text;
    state.query = text;
    $('searchClear').hidden = false;
    renderGrid();
    const p = state.products.find((x) => norm(x.barcode) === norm(text));
    if (p) openProduct(p);
    else toast('Товар с таким штрихкодом в каталоге не найден');
  }

  /* ── События ──────────────────────────────────── */

  function bindEvents() {
    // Поиск
    const input = $('searchInput');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.query = input.value;
        $('searchClear').hidden = !input.value;
        renderGrid();
      }, 120);
    });
    $('searchClear').addEventListener('click', () => {
      input.value = '';
      state.query = '';
      $('searchClear').hidden = true;
      renderGrid();
      input.focus();
    });

    // Группы-фильтры
    $('groupChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.groupId = chip.dataset.group;
      renderAll();
    });

    // Открытие карточки
    $('productGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const p = state.products.find((x) => x.id === card.dataset.id);
      if (p) openProduct(p);
    });

    // Точки под фото
    $('sheetPhotos').addEventListener('scroll', () => {
      const strip = $('sheetPhotos');
      const i = Math.round(strip.scrollLeft / strip.clientWidth);
      [...$('sheetDots').children].forEach((d, j) => d.classList.toggle('active', i === j));
    }, { passive: true });

    // Копирование кодов
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Скопировано: ' + btn.dataset.copy);
      } catch (err) {
        toast('Не удалось скопировать');
      }
    });

    // Закрытие шторок: крестики, кнопки, тап по фону
    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => closeSheet(b.dataset.close)));
    $('sheetClose').addEventListener('click', () => closeSheet('productSheet'));
    document.querySelectorAll('.sheet-backdrop').forEach((bd) =>
      bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(bd.id); }));

    // Админ
    $('adminBtn').addEventListener('click', () => {
      if (state.session) {
        $('adminEmail').textContent = state.session.user?.email || '';
        openSheet('adminMenuSheet');
      } else {
        $('loginError').hidden = true;
        openSheet('loginSheet');
      }
    });

    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('loginSubmit');
      btn.disabled = true;
      btn.textContent = 'Входим…';
      const { error } = await sb.auth.signInWithPassword({
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value,
      });
      btn.disabled = false;
      btn.textContent = 'Войти';
      if (error) {
        $('loginError').textContent = 'Неверный email или пароль';
        $('loginError').hidden = false;
        return;
      }
      $('loginPassword').value = '';
      closeSheet('loginSheet');
      toast('Вход выполнен ✓');
    });

    $('menuLogout').addEventListener('click', async () => {
      await sb.auth.signOut();
      closeSheet('adminMenuSheet');
      toast('Вы вышли из аккаунта');
    });

    $('fabAdd').addEventListener('click', () => openForm(null));
    $('menuAddProduct').addEventListener('click', () => { closeSheet('adminMenuSheet'); openForm(null); });
    $('btnEditProduct').addEventListener('click', () => { closeSheet('productSheet'); openForm(currentProduct); });
    $('btnDeleteProduct').addEventListener('click', deleteProduct);
    $('productForm').addEventListener('submit', submitForm);

    // Сканер: для всех — поиск товара; в форме админа — заполнение штрихкода
    $('scanSearchBtn').addEventListener('click', () => startScan(scanToSearch));
    $('btnScan').addEventListener('click', () => startScan((text) => {
      $('fBarcode').value = text;
      toast('Штрихкод считан ✓');
    }));

    // Фото в форме
    $('photoManager').addEventListener('click', (e) => {
      if (e.target.closest('#photoAddBtn')) { $('photoInput').click(); return; }
      const x = e.target.closest('.thumb-x');
      if (x) {
        formPhotos.splice(Number(x.dataset.idx), 1);
        renderPhotoManager();
      }
    });
    $('photoInput').addEventListener('change', async () => {
      const files = [...$('photoInput').files];
      $('photoInput').value = '';
      for (const f of files) {
        const blob = await compressImage(f);
        formPhotos.push({ blob, preview: URL.createObjectURL(blob) });
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

    // Возврат на вкладку — обновляем каталог, если данные старше 5 минут
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && sb && Date.now() - state.lastFetch > 5 * 60 * 1000) {
        refresh({ silent: true }).then(renderAll);
      }
    });
  }

  /* ── Старт ────────────────────────────────────── */

  async function init() {
    bindEvents();

    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      $('setupBanner').hidden = false;
      $('loader').hidden = true;
      if (loadCache()) renderAll();
      return;
    }

    if (!window.supabase) {
      // библиотека базы не загрузилась (нет интернета) — показываем сохранённый каталог
      $('loader').hidden = true;
      const banner = $('offlineBanner');
      banner.textContent = '📶 Нет связи. Показан сохранённый каталог';
      banner.hidden = false;
      if (loadCache()) renderAll();
      return;
    }

    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

    // мгновенно показываем кэш, затем обновляем из базы
    if (loadCache()) renderAll();

    sb.auth.getSession().then(({ data }) => setAdmin(data.session));
    sb.auth.onAuthStateChange((_e, session) => setAdmin(session));

    await refresh();
  }

  init();
})();
