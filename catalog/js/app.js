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

  const PAGE_SIZE = 80; // карточек на экране до кнопки «Показать ещё»

  const state = {
    groups: [],
    suppliers: [],
    products: [],
    query: '',
    groupId: 'all',
    supplierId: null, // null = все поставщики
    session: null,
    lastFetch: 0,
    renderLimit: PAGE_SIZE,
  };

  let sb = null;
  let currentProduct = null;   // товар, открытый в карточке
  let editingProduct = null;   // товар в форме редактирования (null = новый)
  let formPhotos = [];         // [{url}] сохранённые + [{blob, preview}] новые
  let formSupplierIds = [];    // поставщики, выбранные в форме товара

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
  function supplierById(id) { return state.suppliers.find((s) => s.id === id) || null; }

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

  // Поисковый индекс считается один раз при загрузке данных, а не на каждую букву —
  // иначе на 15 000+ товаров поиск будет тормозить на телефоне
  function buildIndex() {
    for (const p of state.products) {
      const name = norm(p.name);
      p._name = name;
      p._nameT = translit(name);
      p._codes = [p.code, p.article, p.department, ...(p.barcodes || [])].map(norm).filter(Boolean);
      const sup = (p.supplier_ids || []).map((id) => supplierById(id)?.name).filter(Boolean).join(' ');
      p._sup = norm(sup);
      p._supT = translit(p._sup);
      p._grp = norm(groupById(p.group_id)?.name || '');
      p._grpT = translit(p._grp);
      p._note = norm(p.note || '');
    }
  }

  // сравнение текста с запросом с учётом транслитерации (рус ↔ англ)
  function matchPre(text, textT, qVars, w) {
    if (!text) return 0;
    let s = 0;
    const tvs = text === textT ? [text] : [text, textT];
    for (const tv of tvs) {
      for (const qv of qVars) {
        if (tv.startsWith(qv)) s = Math.max(s, w[0]);
        else if (tv.includes(' ' + qv)) s = Math.max(s, w[1]);
        else if (tv.includes(qv)) s = Math.max(s, w[2]);
      }
    }
    return s;
  }

  // нечёткое совпадение — прощает опечатки («хатдок» найдёт «хот-дог», «сникерс» — Snickers)
  function fuzzyScore(name, nameT, qVars) {
    let best = 0;
    const nvs = name === nameT ? [name] : [name, nameT];
    for (const nv of nvs) {
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

  function scoreProduct(p, q, qVars) {
    let s = 0;
    for (const c of p._codes) {
      if (c === q) return 120;
      if (c.startsWith(q)) s = Math.max(s, 95);
      else if (c.includes(q)) s = Math.max(s, 70);
    }

    s = Math.max(s, matchPre(p._name, p._nameT, qVars, [100, 90, 80]));
    if (p._sup) s = Math.max(s, matchPre(p._sup, p._supT, qVars, [60, 57, 55]));
    if (p._grp) s = Math.max(s, matchPre(p._grp, p._grpT, qVars, [45, 42, 40]));
    if (p._note) s = Math.max(s, matchPre(p._note, p._note, qVars, [38, 36, 35]));
    if (p.is_weighted && ('весовой'.startsWith(q) || 'весовые'.startsWith(q) || q === 'вес')) {
      s = Math.max(s, 45);
    }

    // нечёткий поиск — только если точного совпадения не нашлось (экономит время на больших каталогах)
    if (s < 60 && q.length >= 3) {
      const fuzzy = fuzzyScore(p._name, p._nameT, qVars);
      if (fuzzy >= 0.4) s = Math.max(s, Math.round(65 * fuzzy));
    }
    return s;
  }

  function visibleProducts() {
    let list = state.products;
    if (state.groupId === 'none') list = list.filter((p) => !p.group_id);
    else if (state.groupId === 'weighted') list = list.filter((p) => p.is_weighted);
    else if (state.groupId !== 'all') list = list.filter((p) => p.group_id === state.groupId);
    if (state.supplierId) list = list.filter((p) => (p.supplier_ids || []).includes(state.supplierId));

    const q = norm(state.query);
    if (!q) return list;
    const qT = translit(q);
    const qVars = q === qT ? [q] : [q, qT];
    return list
      .map((p) => ({ p, s: scoreProduct(p, q, qVars) }))
      .filter((x) => x.s >= SEARCH_THRESHOLD)
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name, 'ru'))
      .map((x) => x.p);
  }

  /* ── Отрисовка ────────────────────────────────── */

  const TOP_GROUPS = 12; // сколько групп показывать чипами, остальные — в «Ещё группы»

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
    // чип поставщика: не выбран — открывает список; выбран — показывает имя
    if (state.suppliers.length) {
      const sup = supplierById(state.supplierId);
      const label = sup ? `🚚 ${sup.name}` : '🚚 Поставщики';
      const cnt = sup
        ? state.products.filter((p) => (p.supplier_ids || []).includes(sup.id)).length
        : state.suppliers.length;
      html += `<button class="chip${sup ? ' active' : ''}" data-supplier-chip>${esc(label)}<span class="chip-count">${cnt}</span></button>`;
    }
    if (weighted > 0) html += chipHtml('weighted', '⚖ Весовые', weighted);

    // групп может быть 200 — чипами показываем самые крупные, остальные в списке «Ещё»
    const sorted = [...state.groups].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
    const top = sorted.slice(0, TOP_GROUPS);
    const selected = groupById(state.groupId);
    if (selected && !top.includes(selected)) top.unshift(selected);
    for (const g of top) html += chipHtml(g.id, g.name, counts[g.id] || 0);
    if (state.groups.length > TOP_GROUPS) {
      html += `<button class="chip" data-groups-more>📁 Ещё группы<span class="chip-count">${state.groups.length - top.length}</span></button>`;
    }
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
    // на больших каталогах рисуем страницами — телефон не потянет 15 000 карточек разом
    const shown = list.slice(0, state.renderLimit);
    let html = shown.map((p) => {
      const photo = (p.photos || [])[0];
      const img = photo
        ? `<img src="${esc(photo)}" alt="" loading="lazy">`
        : '📦';
      const tags = [];
      if (p.code) tags.push(`<span class="tag tag-code">Код ${esc(p.code)}</span>`);
      if (p.is_weighted) tags.push('<span class="tag">⚖ весовой</span>');
      const sup = supplierById((p.supplier_ids || [])[0]);
      if (sup) tags.push(`<span class="tag">🚚 ${esc(sup.name)}</span>`);
      if (p.department) tags.push(`<span class="tag">Отдел ${esc(p.department)}</span>`);
      if (!(p.barcodes || []).length) tags.push('<span class="tag tag-nobarcode">без штрихкода</span>');
      return `<article class="card" data-id="${esc(p.id)}">
        <div class="card-photo">${img}</div>
        <div class="card-body">
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-tags">${tags.join('')}</div>
        </div>
      </article>`;
    }).join('');
    grid.innerHTML = html;
    document.querySelectorAll('.load-more').forEach((b) => b.remove());
    if (list.length > shown.length) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary load-more';
      btn.textContent = `Показать ещё (осталось ${list.length - shown.length})`;
      btn.addEventListener('click', () => {
        state.renderLimit += 200;
        renderGrid();
      });
      grid.after(btn);
    }
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
    const barcodes = p.barcodes || [];
    if (!barcodes.length) badges.push('<span class="tag tag-nobarcode">⚠ Штрихкода нет — пробивать по коду</span>');
    $('sheetBadges').innerHTML = badges.join('');

    const sups = (p.supplier_ids || []).map(supplierById).filter(Boolean);
    $('sheetSupplier').innerHTML = sups.map((s) =>
      `<button class="btn btn-secondary btn-block" data-supplier-all="${esc(s.id)}">🚚 ${esc(s.name)} — все товары поставщика</button>`).join('');

    const rows = [];
    if (p.code) rows.push(fieldRow('Код кассы', p.code, true));
    if (p.article) rows.push(fieldRow('Артикул', p.article, false, true));
    barcodes.forEach((b, i) => rows.push(fieldRow(barcodes.length > 1 ? `Штрихкод ${i + 1}` : 'Штрихкод', b, false, true)));
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
        state.suppliers = c.suppliers || [];
        state.products = c.products;
        buildIndex();
        state.lastFetch = c.ts || 0;
        return true;
      }
    } catch (e) { /* повреждённый кэш игнорируем */ }
    return false;
  }

  function saveCache() {
    try {
      // служебные поля индекса (начинаются с "_") в кэш не пишем — экономим место
      localStorage.setItem(CACHE_KEY, JSON.stringify(
        {
          groups: state.groups, suppliers: state.suppliers,
          products: state.products, ts: Date.now(),
        },
        (key, value) => (key.startsWith('_') ? undefined : value),
      ));
    } catch (e) { /* нет места — не страшно, кэш вспомогательный */ }
  }

  // база отдаёт максимум 1000 строк за раз — большие каталоги забираем страницами
  async function fetchAllRows(table, orderCol) {
    const all = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await sb.from(table).select('*')
        .order(orderCol).order('id').range(from, from + page - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < page) return all;
    }
  }

  async function fetchData() {
    const [g, sup, p] = await Promise.all([
      sb.from('catalog_groups').select('*').order('sort_order').order('name'),
      fetchAllRows('catalog_suppliers', 'name'),
      fetchAllRows('catalog_products', 'name'),
    ]);
    if (g.error) throw g.error;
    state.groups = g.data;
    state.suppliers = sup;
    state.products = p;
    buildIndex();
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
    $('fBarcodes').value = (product?.barcodes || []).join('\n');
    $('fWeighted').checked = !!product?.is_weighted;
    $('fDepartment').value = product?.department || '';
    $('fNote').value = product?.note || '';
    $('fGroup').innerHTML = '<option value="">Без группы</option>' +
      state.groups.map((g) => `<option value="${esc(g.id)}"${g.id === product?.group_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    $('fSupplier').innerHTML = '<option value="">Выбрать поставщика…</option>' +
      state.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    formSupplierIds = [...(product?.supplier_ids || [])];
    renderFormSupplierTags();
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
        supplier_ids: formSupplierIds,
        code: $('fCode').value.trim() || null,
        article: $('fArticle').value.trim() || null,
        barcodes: $('fBarcodes').value.split('\n').map((s) => s.trim()).filter(Boolean),
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

  /* ── Поставщики ───────────────────────────────── */

  // выбранные поставщики в форме товара
  function renderFormSupplierTags() {
    $('fSupplierTags').innerHTML = formSupplierIds.map((id) => {
      const s = supplierById(id);
      if (!s) return '';
      return `<span class="tag">🚚 ${esc(s.name)} <button type="button" data-untag="${esc(id)}">✕</button></span>`;
    }).join('') || '<span class="muted" style="margin:0">Не указаны</span>';
  }

  // список для фильтра (доступен всем; с поиском — поставщиков может быть много)
  function renderSupplierList() {
    const counts = {};
    for (const p of state.products) {
      for (const id of (p.supplier_ids || [])) counts[id] = (counts[id] || 0) + 1;
    }
    const q = norm($('supplierSearch').value);
    const filtered = q
      ? state.suppliers.filter((s) => norm(s.name).includes(q) || translit(norm(s.name)).includes(translit(q)))
      : state.suppliers;
    let html = '';
    if (state.supplierId) {
      html += '<button class="btn btn-secondary btn-block" data-pick-supplier="">← Показать всех</button>';
    }
    html += filtered.slice(0, 100).map((s) => `
      <button class="btn btn-secondary btn-block" data-pick-supplier="${esc(s.id)}">
        🚚 ${esc(s.name)} <span class="chip-count">${counts[s.id] || 0}</span>
      </button>`).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
    if (filtered.length > 100) html += `<p class="muted">Показаны первые 100 из ${filtered.length} — уточни поиск</p>`;
    $('supplierList').innerHTML = html;
  }

  /* ── Все группы (список с поиском) ────────────── */

  function renderGroupsPick() {
    const counts = {};
    for (const p of state.products) {
      if (p.group_id) counts[p.group_id] = (counts[p.group_id] || 0) + 1;
    }
    const q = norm($('groupsPickSearch').value);
    const filtered = q ? state.groups.filter((g) => norm(g.name).includes(q)) : state.groups;
    let html = '';
    if (state.groupId !== 'all') {
      html += '<button class="btn btn-secondary btn-block" data-pick-group="all">← Показать все товары</button>';
    }
    html += filtered.map((g) => `
      <button class="btn btn-secondary btn-block" data-pick-group="${esc(g.id)}">
        📁 ${esc(g.name)} <span class="chip-count">${counts[g.id] || 0}</span>
      </button>`).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
    $('groupsPickList').innerHTML = html;
  }

  // управление (только админ)
  function renderSuppliersManager() {
    $('suppliersManageList').innerHTML = state.suppliers.map((s) => `
      <div class="group-row" data-id="${esc(s.id)}">
        <input class="input supplier-name" value="${esc(s.name)}">
        <button class="group-del" title="Удалить поставщика">🗑</button>
      </div>`).join('') || '<p class="muted">Поставщиков пока нет — добавь первого ниже</p>';
  }

  async function addSupplier() {
    const name = $('newSupplierName').value.trim();
    if (!name) return;
    const { error } = await sb.from('catalog_suppliers').insert({ name });
    if (error) { toast('Ошибка: ' + error.message); return; }
    $('newSupplierName').value = '';
    await refresh({ silent: true });
    renderAll();
    renderSuppliersManager();
    toast('Поставщик добавлен ✓');
  }

  async function renameSupplier(id, name) {
    if (!name.trim()) return;
    const { error } = await sb.from('catalog_suppliers').update({ name: name.trim() }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    await refresh({ silent: true });
    renderAll();
  }

  async function deleteSupplier(id) {
    const s = supplierById(id);
    if (!confirm(`Удалить поставщика «${s?.name}»? Товары останутся — без поставщика.`)) return;
    const { error } = await sb.from('catalog_suppliers').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message); return; }
    if (state.supplierId === id) state.supplierId = null;
    await refresh({ silent: true });
    renderAll();
    renderSuppliersManager();
    toast('Поставщик удалён');
  }

  /* ── Импорт из 1С (Excel) ─────────────────────────
   * Файл 1 — отчёт «Цены поставщиков»: товары, коды, группы, поставщики, ед.изм.
   * Файл 2 (не обязателен) — отчёт «Штрихкоды номенклатуры»: все штрихкоды.
   * Товары объединяются по «Код товара»; существующие обновляются, фото сохраняются. */

  let impParsed = null; // результат разбора файлов, ждёт подтверждения

  function loadXlsxLib() {
    if (window.XLSX) return Promise.resolve();
    return loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  }

  function cellStr(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v));
    return String(v).trim();
  }

  async function readSheet(file) {
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  }

  // ищем строку заголовков и определяем, в какой колонке что лежит
  function detectColumns(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const labels = rows[r].map((v) => cellStr(v).toLowerCase());
      const next = (rows[r + 1] || []).map((v) => cellStr(v).toLowerCase());
      if (!labels.some((l) => l.includes('номенклатура') || l.includes('наименование'))) continue;

      const cols = {};
      const width = Math.max(labels.length, next.length);
      for (let c = 0; c < width; c++) {
        const l = (labels[c] || '') + ' ' + (next[c] || '');
        if (!l.trim()) continue;
        if (l.includes('артикул')) cols.article ??= c;
        else if (l.includes('штрих')) cols.barcode ??= c;
        else if (l.includes('код товара') || l.includes('номенклатура.код')) cols.code = c;
        else if (l.includes('код') && cols.code === undefined) cols.code = c;
        else if (l.includes('контрагент') || l.includes('поставщик')) cols.supplier ??= c;
        else if (l.includes('единиц')) cols.unit ??= c;
        else if (l.includes('групп')) cols.group ??= c;
        else if ((l.includes('номенклатура') || l.includes('наименование')) && cols.name === undefined) cols.name = c;
      }
      if (cols.name === undefined) continue;
      // если следующая строка — подзаголовки («Номенклатура.Код»), данные начинаются через одну
      const hasSubheader = next.some((l) => l.includes('номенклатура.'));
      return { cols, dataStart: r + (hasSubheader ? 2 : 1) };
    }
    return null;
  }

  function parsePriceReport(rows) {
    const det = detectColumns(rows);
    if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура, Код товара…) в файле 1');
    const { cols, dataStart } = det;
    const byKey = new Map();
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const name = cellStr(row[cols.name]);
      if (!name) continue;
      const code = cols.code !== undefined ? cellStr(row[cols.code]) : '';
      const key = code || norm(name);
      let item = byKey.get(key);
      if (!item) {
        item = { name, code: code || null, article: null, group: null, suppliers: new Set(), barcodes: new Set(), weighted: false };
        byKey.set(key, item);
      }
      const art = cols.article !== undefined ? cellStr(row[cols.article]) : '';
      const grp = cols.group !== undefined ? cellStr(row[cols.group]) : '';
      const sup = cols.supplier !== undefined ? cellStr(row[cols.supplier]) : '';
      const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
      const unit = cols.unit !== undefined ? cellStr(row[cols.unit]).toLowerCase() : '';
      if (art && !item.article) item.article = art;
      if (grp && !item.group) item.group = grp;
      if (sup) item.suppliers.add(sup);
      if (bc) item.barcodes.add(bc);
      if (unit === 'кг') item.weighted = true;
    }
    return byKey;
  }

  // второй файл: пары «товар — штрихкод», добавляем штрихкоды к товарам из первого
  function mergeBarcodesReport(rows, byKey) {
    const det = detectColumns(rows);
    if (!det) throw new Error('Не нашёл строку заголовков в файле 2');
    const { cols, dataStart } = det;
    const byName = new Map();
    for (const item of byKey.values()) byName.set(norm(item.name), item);
    let added = 0;
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
      if (!bc) continue;
      const code = cols.code !== undefined ? cellStr(row[cols.code]) : '';
      const name = cellStr(row[cols.name]);
      const item = (code && byKey.get(code)) || byName.get(norm(name));
      if (item && !item.barcodes.has(bc)) { item.barcodes.add(bc); added++; }
    }
    return added;
  }

  function impStatus(msg) {
    const el = $('impStatus');
    el.hidden = false;
    el.textContent = msg;
  }

  async function impParse() {
    const f1 = $('impFile1').files[0];
    if (!f1) { impStatus('Сначала выбери файл 1 — отчёт «Цены поставщиков»'); return; }
    impStatus('Читаем файлы…');
    await loadXlsxLib();
    const byKey = parsePriceReport(await readSheet(f1));
    let extra = 0;
    const f2 = $('impFile2').files[0];
    if (f2) extra = mergeBarcodesReport(await readSheet(f2), byKey);
    const items = [...byKey.values()];
    const groups = new Set(items.map((i) => i.group).filter(Boolean));
    const sups = new Set();
    items.forEach((i) => i.suppliers.forEach((s) => sups.add(s)));
    const withBc = items.filter((i) => i.barcodes.size).length;
    impParsed = items;
    impStatus(`Найдено: ${items.length} товаров, ${groups.size} групп, ${sups.size} поставщиков. `
      + `Со штрихкодами: ${withBc}${extra ? ` (+${extra} штрихкодов из файла 2)` : ''}. `
      + 'Проверь цифры и нажми кнопку ещё раз — начнётся загрузка.');
    $('impRun').textContent = `⬆ Загрузить ${items.length} товаров в каталог`;
  }

  async function getOrCreateByName(table, names, existing) {
    const map = new Map(existing.map((x) => [norm(x.name), x.id]));
    const missing = [...new Set(names.filter((n) => !map.has(norm(n))))];
    for (let i = 0; i < missing.length; i += 500) {
      const chunk = missing.slice(i, i + 500).map((name) => ({ name }));
      const { data, error } = await sb.from(table).insert(chunk).select();
      if (error) throw error;
      data.forEach((x) => map.set(norm(x.name), x.id));
    }
    return map;
  }

  async function impUpload() {
    const items = impParsed;
    const btn = $('impRun');
    btn.disabled = true;
    try {
      impStatus('Создаём группы и поставщиков…');
      const groupMap = await getOrCreateByName('catalog_groups',
        items.map((i) => i.group).filter(Boolean), state.groups);
      const supMap = await getOrCreateByName('catalog_suppliers',
        items.flatMap((i) => [...i.suppliers]), state.suppliers);

      const withCode = [];
      const noCode = [];
      for (const i of items) {
        const rec = {
          name: i.name,
          code: i.code,
          article: i.article,
          group_id: i.group ? groupMap.get(norm(i.group)) : null,
          supplier_ids: [...i.suppliers].map((s) => supMap.get(norm(s))).filter(Boolean),
          barcodes: [...i.barcodes],
          is_weighted: i.weighted,
          updated_at: new Date().toISOString(),
        };
        (i.code ? withCode : noCode).push(rec);
      }

      let done = 0;
      const total = withCode.length + noCode.length;
      for (let i = 0; i < withCode.length; i += 400) {
        const { error } = await sb.from('catalog_products')
          .upsert(withCode.slice(i, i + 400), { onConflict: 'code' });
        if (error) throw error;
        done += Math.min(400, withCode.length - i);
        impStatus(`Загружаем товары… ${done} из ${total}`);
      }
      for (let i = 0; i < noCode.length; i += 400) {
        const { error } = await sb.from('catalog_products').insert(noCode.slice(i, i + 400));
        if (error) throw error;
        done += Math.min(400, noCode.length - i);
        impStatus(`Загружаем товары… ${done} из ${total}`);
      }

      impStatus('Обновляем каталог…');
      await refresh({ silent: true });
      renderAll();
      impStatus(`Готово! Загружено ${total} товаров ✓ Можно закрыть окно.`);
      toast('Импорт завершён ✓');
      impParsed = null;
      btn.textContent = 'Проверить файлы';
    } catch (err) {
      impStatus('Ошибка: ' + (err.message || err) + '. Если база ещё старой версии — выполни setup/ОБНОВЛЕНИЕ-1.sql в SQL Editor и повтори.');
      impParsed = null;
      btn.textContent = 'Проверить файлы';
    } finally {
      btn.disabled = false;
    }
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
    const p = state.products.find((x) => (x.barcodes || []).some((b) => norm(b) === norm(text)));
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
        state.renderLimit = PAGE_SIZE;
        $('searchClear').hidden = !input.value;
        renderGrid();
      }, 150);
    });
    $('searchClear').addEventListener('click', () => {
      input.value = '';
      state.query = '';
      state.renderLimit = PAGE_SIZE;
      $('searchClear').hidden = true;
      renderGrid();
      input.focus();
    });

    // Группы-фильтры + чипы поставщика и «Ещё группы»
    $('groupChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (chip.hasAttribute('data-supplier-chip')) {
        $('supplierSearch').value = '';
        renderSupplierList();
        openSheet('supplierSheet');
        return;
      }
      if (chip.hasAttribute('data-groups-more')) {
        $('groupsPickSearch').value = '';
        renderGroupsPick();
        openSheet('groupsPickSheet');
        return;
      }
      state.groupId = chip.dataset.group;
      state.renderLimit = PAGE_SIZE;
      renderAll();
    });

    // выбор поставщика в списке (+ живой поиск по списку)
    $('supplierList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-supplier]');
      if (!btn) return;
      state.supplierId = btn.dataset.pickSupplier || null;
      state.renderLimit = PAGE_SIZE;
      closeSheet('supplierSheet');
      renderAll();
    });
    $('supplierSearch').addEventListener('input', renderSupplierList);

    // выбор группы в полном списке (+ живой поиск)
    $('groupsPickList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-group]');
      if (!btn) return;
      state.groupId = btn.dataset.pickGroup;
      state.renderLimit = PAGE_SIZE;
      closeSheet('groupsPickSheet');
      renderAll();
    });
    $('groupsPickSearch').addEventListener('input', renderGroupsPick);

    // «все товары поставщика» из карточки товара
    $('sheetSupplier').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-supplier-all]');
      if (!btn) return;
      state.supplierId = btn.dataset.supplierAll;
      state.groupId = 'all';
      state.renderLimit = PAGE_SIZE;
      closeSheet('productSheet');
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

    // Сканер: для всех — поиск товара; в форме админа — добавляет штрихкод в список
    $('scanSearchBtn').addEventListener('click', () => startScan(scanToSearch));
    $('btnScan').addEventListener('click', () => startScan((text) => {
      const ta = $('fBarcodes');
      const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines.includes(text)) lines.push(text);
      ta.value = lines.join('\n');
      toast('Штрихкод считан ✓');
    }));

    // Поставщики в форме товара: добавить из списка / убрать тапом по ✕
    $('btnAddSupplierToProduct').addEventListener('click', () => {
      const id = $('fSupplier').value;
      if (id && !formSupplierIds.includes(id)) {
        formSupplierIds.push(id);
        renderFormSupplierTags();
      }
      $('fSupplier').value = '';
    });
    $('fSupplierTags').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-untag]');
      if (!btn) return;
      formSupplierIds = formSupplierIds.filter((id) => id !== btn.dataset.untag);
      renderFormSupplierTags();
    });

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

    // Импорт из 1С (только админ)
    $('menuImport').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      impParsed = null;
      $('impRun').textContent = 'Проверить файлы';
      $('impStatus').hidden = true;
      openSheet('importSheet');
    });
    $('impFile1').addEventListener('change', () => {
      $('impFile1Name').textContent = $('impFile1').files[0]?.name || '';
      impParsed = null;
      $('impRun').textContent = 'Проверить файлы';
    });
    $('impFile2').addEventListener('change', () => {
      $('impFile2Name').textContent = $('impFile2').files[0]?.name || '';
      impParsed = null;
      $('impRun').textContent = 'Проверить файлы';
    });
    $('impRun').addEventListener('click', async () => {
      const btn = $('impRun');
      if (impParsed) { impUpload(); return; }
      btn.disabled = true;
      try {
        await impParse();
      } catch (err) {
        impStatus('Ошибка чтения: ' + (err.message || err));
      } finally {
        btn.disabled = false;
      }
    });

    // Поставщики (управление, только админ)
    $('menuSuppliers').addEventListener('click', () => {
      closeSheet('adminMenuSheet');
      renderSuppliersManager();
      openSheet('suppliersManageSheet');
    });
    $('btnAddSupplier').addEventListener('click', addSupplier);
    $('newSupplierName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSupplier(); } });
    $('suppliersManageList').addEventListener('change', (e) => {
      const row = e.target.closest('.group-row');
      if (row && e.target.classList.contains('supplier-name')) renameSupplier(row.dataset.id, e.target.value);
    });
    $('suppliersManageList').addEventListener('click', (e) => {
      const del = e.target.closest('.group-del');
      if (del) deleteSupplier(del.closest('.group-row').dataset.id);
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

  // для автотестов разбора 1С-файлов (не влияет на работу приложения)
  window.__catalogTest = { detectColumns, parsePriceReport, mergeBarcodesReport };
})();
