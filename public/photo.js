'use strict';
/* Photo editor: layers with overlay, crop, copy, order, position, size, colour, texture, opacity.
   Uses helpers from app.js: $, el, btn, baseOf, toast */
window.PhotoEditor = (() => {
  const MAX = 2400, MIN = 8;
  const FORMATS = [['PNG', 'image/png', 'png'], ['JPG', 'image/jpeg', 'jpg'], ['WebP', 'image/webp', 'webp']];
  const TEX = [['None', 'none'], ['Grain', 'grain'], ['Paper', 'paper'], ['Canvas', 'weave'], ['Dots', 'dots']];
  const RATIOS = [['Free', 0], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['3:4', 3 / 4]];
  const DEF = { op: 100, br: 0, ct: 0, sa: 0, hu: 0, wm: 0, tc: '#818cf8', ti: 0, tt: 'none', tx: 0 };
  const KEYS = ['id', 'name', 'x', 'y', 'w', 'h', 'vis', ...Object.keys(DEF)];
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const show = (s, on) => $(s).classList.toggle('hidden', !on);

  const S = { W: 0, H: 0, layers: [], sel: null, fmt: 0, lock: true, crop: null, ratio: 0, name: 'photo', hist: [], hi: -1 };
  const SRC = new Map(); let uid = 0;                          // layer id -> original pixels (never modified)
  const cv = $('#pView'), ctx = cv.getContext('2d'), wrap = $('#pWrap'), selBox = $('#pSel'), cropBox = $('#pCrop');
  const cur = () => S.layers.find((l) => l.id === S.sel);

  /* ---------- pixels: colour + texture are baked into a cached copy ---------- */
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1; };
  const TEXFN = {
    grain: (x, y) => hash(x, y),
    paper: (x, y) => hash(x, y) * 0.45 + hash(x >> 3, y >> 3) * 0.55,
    weave: (x, y) => Math.sin(x * 1.1) * Math.sin(y * 1.1) * 0.6 + hash(x, y) * 0.4,
    dots: (x, y) => (Math.sin(x * 0.7) * Math.sin(y * 0.7) > 0.35 ? -1 : 0.25),
  };
  const plain = (L) => !(L.br || L.ct || L.sa || L.hu || L.wm || L.ti || (L.tt !== 'none' && L.tx));
  function bake(L) {
    if (!L.dirty && L.cv) return L.cv;
    L.dirty = false; const src = SRC.get(L.id);
    if (plain(L)) return (L.cv = src);
    const c = L.cv && L.cv !== src ? L.cv : document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data, W = c.width;
    const bf = 1 + L.br / 100, cf = 1 + L.ct / 100, sf = 1 + L.sa / 100, a = (L.hu * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    const m = [.213 + cs * .787 - sn * .213, .715 - cs * .715 - sn * .715, .072 - cs * .072 + sn * .928,
               .213 - cs * .213 + sn * .143, .715 + cs * .285 + sn * .140, .072 - cs * .072 - sn * .283,
               .213 - cs * .213 - sn * .787, .715 - cs * .715 + sn * .715, .072 + cs * .928 + sn * .072];
    const tr = parseInt(L.tc.slice(1, 3), 16), tg = parseInt(L.tc.slice(3, 5), 16), tb = parseInt(L.tc.slice(5, 7), 16), ti = L.ti / 100;
    const wm = L.wm * 0.6, tf = L.tt !== 'none' && L.tx ? TEXFN[L.tt] : null, tx = (L.tx / 100) * 70;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let r = d[i], gr = d[i + 1], b = d[i + 2];
      if (L.hu) { const R = m[0] * r + m[1] * gr + m[2] * b, G = m[3] * r + m[4] * gr + m[5] * b, B = m[6] * r + m[7] * gr + m[8] * b; r = R; gr = G; b = B; }
      if (L.sa) { const y = .299 * r + .587 * gr + .114 * b; r = y + (r - y) * sf; gr = y + (gr - y) * sf; b = y + (b - y) * sf; }
      r = (r * bf - 128) * cf + 128; gr = (gr * bf - 128) * cf + 128; b = (b * bf - 128) * cf + 128;
      r += wm; b -= wm;
      if (ti) { r += (tr - r) * ti; gr += (tg - gr) * ti; b += (tb - b) * ti; }
      if (tf) { const n = tf(p % W, (p / W) | 0) * tx; r += n; gr += n; b += n; }
      d[i] = r; d[i + 1] = gr; d[i + 2] = b;                   // Uint8ClampedArray clamps for us
    }
    g.putImageData(im, 0, 0); return (L.cv = c);
  }

  /* ---------- drawing ---------- */
  function drawAll(g) { for (const L of S.layers) if (L.vis) { g.globalAlpha = L.op / 100; g.drawImage(bake(L), L.x, L.y, L.w, L.h); } g.globalAlpha = 1; }
  let raf = 0;
  const redraw = () => { raf ||= requestAnimationFrame(() => { raf = 0; paint(); }); };
  function paint() {
    if (!S.W) return;
    if (cv.width !== S.W || cv.height !== S.H) { cv.width = S.W; cv.height = S.H; }
    ctx.clearRect(0, 0, S.W, S.H); drawAll(ctx); place();
  }
  const pct = (r) => ({ left: (r.x / S.W) * 100 + '%', top: (r.y / S.H) * 100 + '%', width: (r.w / S.W) * 100 + '%', height: (r.h / S.H) * 100 + '%' });
  function place() {
    const L = cur(), on = L && L.vis && !S.crop;
    selBox.style.display = on ? 'block' : 'none'; if (on) Object.assign(selBox.style, pct(L));
    cropBox.style.display = S.crop ? 'block' : 'none'; if (S.crop) Object.assign(cropBox.style, pct(S.crop));
  }

  /* ---------- history (stores settings only; pixels are shared) ---------- */
  const snap = () => JSON.stringify({ W: S.W, H: S.H, sel: S.sel, layers: S.layers.map((l) => Object.fromEntries(KEYS.map((k) => [k, l[k]]))) });
  function commit() { S.hist.length = S.hi + 1; S.hist.push(snap()); if (S.hist.length > 40) S.hist.shift(); S.hi = S.hist.length - 1; syncBtns(); }
  function restore(i) {
    if (i < 0 || i >= S.hist.length) return; S.hi = i;
    const o = JSON.parse(S.hist[i]); Object.assign(S, { W: o.W, H: o.H, sel: o.sel, crop: null });
    S.layers = o.layers.map((p) => ({ ...p, dirty: true, cv: null }));
    cropUi(); ui(); sync(); redraw();
  }

  /* ---------- layers ---------- */
  function addLayer(src, name, base) {
    const id = ++uid; SRC.set(id, src);
    let w = src.width, h = src.height;
    if (!base) { const k = Math.min((S.W * 0.4) / w, (S.H * 0.8) / h); w *= k; h *= k; }   // overlays start at 40% of the canvas width
    S.layers.push({ id, name, x: (S.W - w) / 2, y: (S.H - h) / 2, w, h, vis: true, ...DEF, cv: null, dirty: true }); S.sel = id;
  }
  function select(id) { S.sel = id; ui(); sync(); place(); }
  const hit = (p) => { for (let i = S.layers.length - 1; i >= 0; i--) { const L = S.layers[i]; if (L.vis && p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h) return L; } return null; };
  function reorder(to) {
    const L = cur(); if (!L) return; const i = S.layers.indexOf(L), n = S.layers.length;
    const j = to === 'front' ? n - 1 : to === 'back' ? 0 : clamp(i + (to === 'up' ? 1 : -1), 0, n - 1);
    if (i === j) return; S.layers.splice(i, 1); S.layers.splice(j, 0, L); commit(); ui(); redraw();
  }
  function duplicate() {
    const L = cur(); if (!L) return; const id = ++uid; SRC.set(id, SRC.get(L.id));
    S.layers.splice(S.layers.indexOf(L) + 1, 0, { ...L, id, name: L.name + ' copy', x: L.x + 24, y: L.y + 24, cv: null, dirty: true });
    S.sel = id; commit(); ui(); sync(); redraw();
  }
  function remove() {
    const L = cur(); if (!L) return; const i = S.layers.indexOf(L); S.layers.splice(i, 1);
    if (!S.layers.length) return reset();
    S.sel = S.layers[Math.min(i, S.layers.length - 1)].id; commit(); ui(); sync(); redraw();
  }
  function reset() { Object.assign(S, { W: 0, H: 0, layers: [], sel: null, crop: null, hist: [], hi: -1 }); SRC.clear(); show('#photoEditor', false); show('#photoDrop', true); }

  /* ---------- load ---------- */
  async function decode(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { const u = URL.createObjectURL(file), i = new Image(); try { i.src = u; await i.decode(); bmp = i; } finally { URL.revokeObjectURL(u); } }
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, k = Math.min(1, MAX / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.(); return c;
  }
  async function load(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (!list.length) return toast('Choose an image to edit.');
    for (const f of list) {
      let c; try { c = await decode(f); } catch { toast(`${f.name} could not be opened.`); continue; }
      if (!S.W) { Object.assign(S, { W: c.width, H: c.height, name: baseOf(f.name) }); show('#photoDrop', false); show('#photoEditor', true); addLayer(c, f.name, true); }
      else addLayer(c, f.name, false);                           // later images become overlays
    }
    if (!S.W) return; commit(); ui(); sync(); redraw();
  }

  /* ---------- dragging on the canvas ---------- */
  function fit(r, h, dx, dy, ratio, bounded) {
    if (h === 'm') return { x: bounded ? clamp(r.x + dx, 0, S.W - r.w) : r.x + dx, y: bounded ? clamp(r.y + dy, 0, S.H - r.h) : r.y + dy, w: r.w, h: r.h };
    let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    if (h.includes('w')) x0 += dx; if (h.includes('e')) x1 += dx; if (h.includes('n')) y0 += dy; if (h.includes('s')) y1 += dy;
    if (x1 - x0 < MIN) { if (h.includes('w')) x0 = x1 - MIN; else x1 = x0 + MIN; }
    if (y1 - y0 < MIN) { if (h.includes('n')) y0 = y1 - MIN; else y1 = y0 + MIN; }
    if (ratio && h.length === 2) {                               // corner + fixed ratio
      const ax = h.includes('w') ? r.x + r.w : r.x, ay = h.includes('n') ? r.y + r.h : r.y; let w = x1 - x0;
      if (bounded) w = Math.min(w, h.includes('w') ? ax : S.W - ax, (h.includes('n') ? ay : S.H - ay) * ratio);
      w = Math.max(MIN, w); const hh = w / ratio;
      x0 = h.includes('w') ? ax - w : ax; x1 = x0 + w; y0 = h.includes('n') ? ay - hh : ay; y1 = y0 + hh;
    } else if (bounded) { x0 = clamp(x0, 0, x1 - MIN); x1 = clamp(x1, x0 + MIN, S.W); y0 = clamp(y0, 0, y1 - MIN); y1 = clamp(y1, y0 + MIN, S.H); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const toPx = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) * S.W) / r.width, y: ((e.clientY - r.top) * S.H) / r.height }; };
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (!S.W) return; const h = e.target.dataset?.h, p = toPx(e);
    if (S.crop) { if (!cropBox.contains(e.target)) return; drag = { t: 'crop', h: h || 'm', p, r: { ...S.crop } }; }
    else if (h) { const L = cur(); if (!L) return; drag = { t: 'layer', h, p, L, r: { x: L.x, y: L.y, w: L.w, h: L.h } }; }
    else { const L = hit(p); if (!L) return select(null); if (L.id !== S.sel) select(L.id); drag = { t: 'layer', h: 'm', p, L, r: { x: L.x, y: L.y, w: L.w, h: L.h } }; }
    wrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = toPx(e), dx = p.x - drag.p.x, dy = p.y - drag.p.y; drag.moved ||= Math.hypot(dx, dy) > 1;
    if (drag.t === 'crop') S.crop = fit(drag.r, drag.h, dx, dy, S.ratio, true);
    else Object.assign(drag.L, fit(drag.r, drag.h, dx, dy, S.lock ? drag.r.w / drag.r.h : 0, false));
    sync(); redraw();
  });
  const endDrag = () => { if (drag?.moved && drag.t === 'layer') commit(); drag = null; };
  wrap.addEventListener('pointerup', endDrag); wrap.addEventListener('pointercancel', endDrag);

  /* ---------- crop ---------- */
  function cropFit(ratio) {
    S.ratio = ratio; if (!S.crop) return;
    if (ratio) { let w = Math.min(S.W, S.H * ratio), h = w / ratio; S.crop = { x: (S.W - w) / 2, y: (S.H - h) / 2, w, h }; }
    cropUi(); redraw();
  }
  function cropUi() {
    show('#pCropBar', !!S.crop); cropBox.classList.toggle('locked', !!S.ratio);
    $('#pCropBtn').classList.toggle('on', !!S.crop);
    ratioBtns.forEach(([r, b]) => { b.classList.toggle('on', r === S.ratio); b.setAttribute('aria-pressed', r === S.ratio); });
  }
  function cropToggle(on = !S.crop) { S.crop = on && S.W ? { x: 0, y: 0, w: S.W, h: S.H } : null; S.ratio = 0; cropUi(); redraw(); }
  function cropApply() {
    const r = S.crop; if (!r) return; const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
    for (const L of S.layers) { L.x -= x; L.y -= y; }
    S.W = w; S.H = h; S.crop = null; S.ratio = 0; commit(); cropUi(); ui(); sync(); redraw();
  }

  /* ---------- controls ---------- */
  const syncers = [];
  function slider(parent, label, min, max, get, set, { bakes = false, fmt = (v) => Math.round(v) } = {}) {
    const row = el('label', 'flex items-center gap-3 py-1'), r = el('input', 'rng'), v = el('span', 'text-sm tabular-nums text-slate-400 w-12 text-right shrink-0');
    Object.assign(r, { type: 'range', min, max, step: 1 }); r.setAttribute('aria-label', label);
    r.oninput = () => { const L = cur(); if (!L) return; set(L, +r.value); if (bakes) L.dirty = true; sync(); redraw(); };
    r.onchange = commit;
    row.append(el('span', 'text-sm text-slate-300 w-28 shrink-0', label), r, v); parent.append(row);
    syncers.push(() => { const L = cur(); if (!L) return; const x = get(L); r.value = x; v.textContent = fmt(x); });
  }
  function num(parent, label, get, set) {
    const w = el('label', 'flex items-center gap-2 text-sm text-slate-300'), i = el('input', 'w-24 rounded-xl bg-white/5 border border-white/10 px-3 py-2 tabular-nums focus:border-teal-300 focus:outline-none');
    Object.assign(i, { type: 'number', step: 1, inputMode: 'numeric' }); i.setAttribute('aria-label', label);
    i.onchange = () => { const L = cur(); if (!L || i.value === '') return; set(L, +i.value); commit(); sync(); redraw(); };
    w.append(label, i); parent.append(w);
    syncers.push(() => { const L = cur(); if (L && document.activeElement !== i) i.value = Math.round(get(L)); });
  }
  const act = (fn) => () => { const L = cur(); if (!L) return; fn(L); commit(); sync(); redraw(); };
  const group = (id, ...kids) => $(id).append(...kids);

  // Arrange: copy / delete / stacking order
  const actionBtns = [['Copy', duplicate], ['Delete', remove], ['To front', () => reorder('front')], ['Forward', () => reorder('up')], ['Backward', () => reorder('down')], ['To back', () => reorder('back')]].map(([t, f]) => btn(t, 'chip', f));
  group('#pActions', ...actionBtns);

  // Position (relative first: align grid + percentages, then exact pixels)
  const grid = el('div', 'grid grid-cols-3 gap-1 w-[7.5rem] shrink-0');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const b = btn('', 'chip !p-0 h-9 grid place-items-center', act((L) => { L.x = ((S.W - L.w) * c) / 2; L.y = ((S.H - L.h) * r) / 2; }));
    b.setAttribute('aria-label', `Align ${['top', 'middle', 'bottom'][r]} ${['left', 'centre', 'right'][c]}`); b.innerHTML = '<span class="block w-2 h-2 rounded-full bg-current"></span>'; grid.append(b);
  }
  group('#pAlign', grid);
  const rel = $('#pRel');
  slider(rel, 'Across canvas', 0, 100, (L) => ((L.x + L.w / 2) / S.W) * 100, (L, v) => { L.x = (v / 100) * S.W - L.w / 2; }, { fmt: (v) => Math.round(v) + '%' });
  slider(rel, 'Down canvas', 0, 100, (L) => ((L.y + L.h / 2) / S.H) * 100, (L, v) => { L.y = (v / 100) * S.H - L.h / 2; }, { fmt: (v) => Math.round(v) + '%' });
  num($('#pXY'), 'X', (L) => L.x, (L, v) => { L.x = v; }); num($('#pXY'), 'Y', (L) => L.y, (L, v) => { L.y = v; });

  // Size (relative first, then exact pixels, then quick fits)
  slider($('#pRelSize'), 'Size', 5, 200, (L) => (L.w / S.W) * 100, (L, v) => {
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2, w = Math.max(MIN, (S.W * v) / 100); L.h = (L.h * w) / L.w; L.w = w; L.x = cx - w / 2; L.y = cy - L.h / 2;
  }, { fmt: (v) => Math.round(v) + '%' });
  num($('#pWH'), 'W', (L) => L.w, (L, v) => { v = Math.max(MIN, v); if (S.lock) L.h = (L.h * v) / L.w; L.w = v; });
  num($('#pWH'), 'H', (L) => L.h, (L, v) => { v = Math.max(MIN, v); if (S.lock) L.w = (L.w * v) / L.h; L.h = v; });
  $('#pLock').onchange = (e) => { S.lock = e.target.checked; };
  const sizeTo = (mode) => act((L) => {
    const s = SRC.get(L.id), k = mode === 'orig' ? 1 : (mode === 'fit' ? Math.min : Math.max)(S.W / s.width, S.H / s.height);
    L.w = s.width * k; L.h = s.height * k; if (mode !== 'orig') { L.x = (S.W - L.w) / 2; L.y = (S.H - L.h) / 2; }
  });
  group('#pFits', btn('Fit canvas', 'chip', sizeTo('fit')), btn('Fill canvas', 'chip', sizeTo('fill')), btn('Original size', 'chip', sizeTo('orig')));

  // Look: opacity, colour, texture
  const bk = { bakes: true };
  slider($('#pOpacity'), 'Opacity', 0, 100, (L) => L.op, (L, v) => { L.op = v; }, { fmt: (v) => Math.round(v) + '%' });
  for (const [label, key, min] of [['Brightness', 'br', -100], ['Contrast', 'ct', -100], ['Saturation', 'sa', -100], ['Hue', 'hu', -180], ['Warmth', 'wm', -100]])
    slider($('#pColor'), label, min, -min, (L) => L[key], (L, v) => { L[key] = v; }, bk);
  const tint = el('input', 'w-9 h-9 rounded-full bg-transparent cursor-pointer border-0 p-0 shrink-0'); tint.type = 'color'; tint.value = DEF.tc; tint.setAttribute('aria-label', 'Tint colour');
  tint.oninput = () => { const L = cur(); if (!L) return; L.tc = tint.value; if (!L.ti) L.ti = 25; L.dirty = true; sync(); redraw(); }; tint.onchange = commit;
  const tintRow = el('div', 'flex items-center gap-3'); tintRow.append(tint); $('#pColor').append(tintRow);
  slider(tintRow, 'Tint amount', 0, 100, (L) => L.ti, (L, v) => { L.ti = v; }, { bakes: true, fmt: (v) => Math.round(v) + '%' });
  tintRow.firstElementChild.nextElementSibling.classList.add('flex-1');
  const texBtns = TEX.map(([label, id]) => [id, btn(label, 'chip', act((L) => { L.tt = id; if (id !== 'none' && !L.tx) L.tx = 40; L.dirty = true; }))]);
  group('#pTex', ...texBtns.map((t) => t[1]));
  slider($('#pTexAmt'), 'Strength', 0, 100, (L) => L.tx, (L, v) => { L.tx = v; }, { bakes: true, fmt: (v) => Math.round(v) + '%' });
  $('#pResetLook').onclick = act((L) => { Object.assign(L, DEF, { dirty: true }); });

  // Crop bar
  const ratioBtns = RATIOS.map(([label, r]) => { const b = btn(label, 'chip', () => cropFit(r)); $('#pRatios').append(b); return [r, b]; });
  $('#pCropBtn').onclick = () => cropToggle(); $('#pCropApply').onclick = cropApply; $('#pCropCancel').onclick = () => cropToggle(false);

  // Export
  const fmtBtns = FORMATS.map(([label], i) => { const b = btn(label, 'chip', () => { S.fmt = i; paintFmt(); }); $('#pFmt').append(b); return b; });
  function paintFmt() { fmtBtns.forEach((b, i) => { b.classList.toggle('on', i === S.fmt); b.setAttribute('aria-pressed', i === S.fmt); }); $('#pSave').textContent = `Download ${FORMATS[S.fmt][0]}`; }
  paintFmt();
  async function save() {
    if (!S.W) return; const [, mime, ext] = FORMATS[S.fmt];
    const c = document.createElement('canvas'); c.width = S.W; c.height = S.H; const g = c.getContext('2d');
    if (mime === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, S.W, S.H); }          // JPG has no transparency
    drawAll(g);
    const blob = await new Promise((ok) => c.toBlob(ok, mime, 0.95));
    if (!blob) return toast(`This browser cannot save ${ext.toUpperCase()}. Try PNG.`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.name}-edited.${ext}`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  $('#pSave').onclick = save;

  /* ---------- refresh UI from state ---------- */
  function ui() {
    const rows = [...S.layers].reverse().map((L) => {
      const row = el('div', 'flex items-center gap-3 rounded-xl p-2 cursor-pointer border ' + (L.id === S.sel ? 'border-indigo-300/70 bg-indigo-400/15' : 'border-white/10 bg-white/5'));
      row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-pressed', L.id === S.sel);
      const t = document.createElement('canvas'); t.width = t.height = 40; t.className = 'rounded-md checker shrink-0';
      const s = SRC.get(L.id), k = Math.min(40 / s.width, 40 / s.height); t.getContext('2d').drawImage(s, (40 - s.width * k) / 2, (40 - s.height * k) / 2, s.width * k, s.height * k);
      const eye = btn(L.vis ? 'Hide' : 'Show', 'chip !py-1 !px-2.5 text-xs', (e) => { e.stopPropagation(); L.vis = !L.vis; commit(); ui(); redraw(); });
      row.append(t, el('span', 'truncate text-sm flex-1 min-w-0' + (L.vis ? '' : ' opacity-50'), L.name), eye);
      row.onclick = () => select(L.id); row.onkeydown = (e) => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(L.id); } };
      return row;
    });
    $('#pLayers').replaceChildren(...rows);
    for (const id of ['#pActionsCard', '#pPosCard', '#pSizeCard', '#pLookCard']) show(id, !!cur());
    syncBtns();
  }
  function syncBtns() {
    $('#pUndo').disabled = S.hi <= 0; $('#pRedo').disabled = S.hi >= S.hist.length - 1;
    const i = S.layers.indexOf(cur()), n = S.layers.length;
    actionBtns[2].disabled = actionBtns[3].disabled = i === n - 1; actionBtns[4].disabled = actionBtns[5].disabled = i === 0;
  }
  function sync() {
    const L = cur(); if (!L) return place();
    syncers.forEach((f) => f()); tint.value = L.tc; $('#pLock').checked = S.lock;
    texBtns.forEach(([id, b]) => { b.classList.toggle('on', L.tt === id); b.setAttribute('aria-pressed', L.tt === id); });
    syncBtns();
  }

  /* ---------- wiring ---------- */
  $('#pUndo').onclick = () => restore(S.hi - 1); $('#pRedo').onclick = () => restore(S.hi + 1);
  $('#pFile').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) load(f); };
  $('#pAdd').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) load(f); };
  $('#pChange').onclick = () => { if (S.hi > 0 && !confirm('Start over? Your edits will be lost.')) return; reset(); };
  addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'photo' || !S.W || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); restore(e.shiftKey ? S.hi + 1 : S.hi - 1); }
    else if (mod && k === 'y') { e.preventDefault(); restore(S.hi + 1); }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
    else if (e.key === 'Escape' && S.crop) cropToggle(false);
    else if (e.key === 'Enter' && S.crop) cropApply();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && cur() && !S.crop) { e.preventDefault(); remove(); }
    else if (e.key.startsWith('Arrow') && cur() && !S.crop) {
      e.preventDefault(); const L = cur(), s = e.shiftKey ? 10 : 1;
      L.x += e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0; L.y += e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      sync(); redraw(); clearTimeout(restore.t); restore.t = setTimeout(commit, 400);
    }
  });

  return { load };
})();
