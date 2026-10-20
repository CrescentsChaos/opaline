'use strict';
/* Background remover. Uses helpers from app.js: $, btn, baseOf, toast, tick */
window.BgEditor = (() => {
  // The cutout model runs in the browser via @imgly/background-removal (loaded on first use).
  const LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
  const MAX_SIDE = 2400;                        // working resolution (keeps memory sane)
  const MODELS = { standard: 'isnet_fp16', best: 'isnet' };
  const COLORS = ['#ffffff', '#000000', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
  const FORMATS = [['PNG', 'image/png', 'png'], ['JPG', 'image/jpeg', 'jpg'], ['WebP', 'image/webp', 'webp']];

  const st = { quality: 'standard', file: null, w: 0, h: 0, bg: null, tool: null, size: 36, fmt: 0, trim: false, token: 0, busy: false, ready: false, compare: false, undo: [] };
  const orig = document.createElement('canvas'), cut = document.createElement('canvas');
  const view = $('#bView'), vctx = view.getContext('2d'), ring = $('#bRing');
  const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /* ---------- engine ---------- */
  let libP;
  const engine = () => (libP ??= import(LIB).catch(() => { libP = null; throw new Error('Could not load the background remover. Check your connection and try again.'); }));

  /* ---------- load + process ---------- */
  async function decode(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      const url = URL.createObjectURL(file), img = new Image();
      try { img.src = url; await img.decode(); bmp = img; } finally { URL.revokeObjectURL(url); }
    }
    const nw = bmp.width || bmp.naturalWidth, nh = bmp.height || bmp.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(nw, nh));
    st.w = orig.width = cut.width = Math.max(1, Math.round(nw * k)); st.h = orig.height = cut.height = Math.max(1, Math.round(nh * k));
    const c = orig.getContext('2d'); c.clearRect(0, 0, st.w, st.h); c.drawImage(bmp, 0, 0, st.w, st.h); bmp.close?.();
  }

  async function load(file) {
    const token = ++st.token;
    Object.assign(st, { file, ready: false, undo: [], tool: null, compare: false });
    showError(''); paintTools(); syncUi();
    $('#bName').textContent = file.name; $('#bName').title = file.name;
    show('#bgDrop', false); show('#bgEditor', true);
    try { await decode(file); } catch { toast('This image could not be opened.'); return reset(); }
    if (token !== st.token) return;
    view.width = st.w; view.height = st.h;
    vctx.clearRect(0, 0, st.w, st.h); vctx.drawImage(orig, 0, 0);       // show the photo while the model works
    process(token);
  }

  function reset() { ++st.token; st.file = null; st.ready = false; show('#bgEditor', false); show('#bgDrop', true); }

  async function process(token) {
    busy(true, 4, 'Preparing…', '');
    try {
      const { removeBackground } = await engine();
      const input = await new Promise((r) => orig.toBlob(r, 'image/png'));
      let phase = '';
      const out = await removeBackground(input, {
        model: MODELS[st.quality],
        output: { format: 'image/png', quality: 1 },
        progress: (key, cur, total) => {
          if (token !== st.token) return;
          if (String(key).startsWith('fetch')) {
            phase = 'fetch';
            busy(true, 4 + (total ? (cur / total) * 56 : 0), 'Downloading the model…', 'First time only. It is saved by your browser for next time.');
          } else if (phase !== 'compute') { phase = 'compute'; busy(true, 70, 'Removing background…', ''); }
        },
      });
      if (token !== st.token) return;
      const bmp = await createImageBitmap(out);
      const c = cut.getContext('2d'); c.clearRect(0, 0, st.w, st.h); c.drawImage(bmp, 0, 0, st.w, st.h); bmp.close?.();
      st.ready = true; render(); syncUi();
    } catch (e) {
      if (token !== st.token) return;
      showError(e.message || 'The background could not be removed from this image.');
    } finally { if (token === st.token) busy(false); }
  }

  /* ---------- drawing ---------- */
  function render() {
    vctx.clearRect(0, 0, st.w, st.h);
    if (st.bg && !st.compare) { vctx.fillStyle = st.bg; vctx.fillRect(0, 0, st.w, st.h); }
    vctx.drawImage(st.compare || !st.ready ? orig : cut, 0, 0);
  }

  /* ---------- UI state ---------- */
  function busy(on, pct = 4, msg = '', note = '') {
    st.busy = on; show('#bBusy', on);
    $('#bBar').style.width = clamp(pct, 4, 100) + '%'; $('#bMsg').textContent = msg; $('#bNote').textContent = note;
    syncUi();
  }
  function showError(m) { $('#bErr').textContent = m; show('#bErr', !!m); }
  function syncUi() {
    const ok = st.ready && !st.busy;
    $('#bSave').disabled = !ok; $('#bCompare').disabled = !ok; $('#bUndo').disabled = !ok || !st.undo.length;
    for (const b of $('#bTools').children) b.disabled = !ok;
    view.style.cursor = ok && st.tool ? 'none' : 'default';
    $('#bSave').textContent = `Download ${FORMATS[st.fmt][0]}`;
  }

  /* quality: re-runs the cutout with the larger model */
  const qBtns = [['Standard', 'standard'], ['Best', 'best']].map(([label, id]) => {
    const b = btn(label, 'chip', () => {
      if (st.quality === id || st.busy) return;
      st.quality = id; paintQ();
      if (st.file) { st.undo = []; st.ready = false; showError(''); render(); process(++st.token); }
    });
    $('#bQ').append(b); return [id, b];
  });
  function paintQ() { qBtns.forEach(([id, b]) => { b.classList.toggle('on', st.quality === id); b.setAttribute('aria-pressed', st.quality === id); }); }
  paintQ();

  /* tools */
  const TOOLS = [['Erase', 'erase'], ['Restore', 'restore']];
  const toolBtns = TOOLS.map(([label, id]) => { const b = btn(label, 'chip', () => { st.tool = st.tool === id ? null : id; paintTools(); syncUi(); }); $('#bTools').append(b); return [id, b]; });
  function paintTools() { toolBtns.forEach(([id, b]) => { b.classList.toggle('on', st.tool === id); b.setAttribute('aria-pressed', st.tool === id); }); ring.style.display = 'none'; }
  $('#bSize').oninput = (e) => { st.size = +e.target.value; };

  /* swatches */
  const swatches = [];
  function addSwatch(color, label) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch' + (color ? '' : ' checker'); b.setAttribute('aria-label', label);
    if (color) b.style.background = color;
    b.onclick = () => { st.bg = color; paintSwatches(); if (st.ready) render(); };
    $('#bSwatches').append(b); swatches.push([color, b]);
  }
  addSwatch(null, 'Transparent'); COLORS.forEach((c) => addSwatch(c, c));
  const pick = document.createElement('input'); pick.type = 'color'; pick.value = '#818cf8'; pick.setAttribute('aria-label', 'Custom colour');
  pick.className = 'w-9 h-9 rounded-full bg-transparent cursor-pointer border-0 p-0'; pick.oninput = () => { st.bg = pick.value; paintSwatches(); if (st.ready) render(); };
  $('#bSwatches').append(pick);
  function paintSwatches() { swatches.forEach(([c, b]) => { const on = c === st.bg; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); }
  paintSwatches();

  /* formats */
  const fmtBtns = FORMATS.map(([label], i) => { const b = btn(label, 'chip', () => { st.fmt = i; paintFmt(); syncUi(); }); $('#bFmt').append(b); return b; });
  function paintFmt() { fmtBtns.forEach((b, i) => { b.classList.toggle('on', i === st.fmt); b.setAttribute('aria-pressed', i === st.fmt); }); }
  paintFmt();
  $('#bTrim').onchange = (e) => { st.trim = e.target.checked; };

  /* ---------- brush ---------- */
  let stroke = null;
  const toImg = (e) => { const r = view.getBoundingClientRect(); return { x: ((e.clientX - r.left) * st.w) / r.width, y: ((e.clientY - r.top) * st.h) / r.height, k: st.w / r.width, r }; };
  function moveRing(e) {
    if (!st.tool || !st.ready) { ring.style.display = 'none'; return; }
    const w = $('#bWrap').getBoundingClientRect();
    Object.assign(ring.style, { display: 'block', width: st.size + 'px', height: st.size + 'px', left: e.clientX - w.left + 'px', top: e.clientY - w.top + 'px' });
  }
  function snapshot() {
    const c = document.createElement('canvas'); c.width = st.w; c.height = st.h; c.getContext('2d').drawImage(cut, 0, 0);
    st.undo.push(c); if (st.undo.length > 5) st.undo.shift();
  }
  function seg(a, b, width) {
    const c = cut.getContext('2d');
    if (st.tool === 'erase') {
      c.save(); c.globalCompositeOperation = 'destination-out'; c.lineCap = c.lineJoin = 'round'; c.lineWidth = width; c.strokeStyle = '#000';
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.restore();
    } else {                                            // restore: copy the original pixels under the stroke
      const pad = Math.ceil(width / 2) + 2;
      const x0 = clamp(Math.floor(Math.min(a.x, b.x) - pad), 0, st.w), y0 = clamp(Math.floor(Math.min(a.y, b.y) - pad), 0, st.h);
      const x1 = clamp(Math.ceil(Math.max(a.x, b.x) + pad), 0, st.w), y1 = clamp(Math.ceil(Math.max(a.y, b.y) + pad), 0, st.h);
      const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
      const t = document.createElement('canvas'); t.width = w; t.height = h; const g = t.getContext('2d');
      g.lineCap = g.lineJoin = 'round'; g.lineWidth = width; g.strokeStyle = '#000';
      g.beginPath(); g.moveTo(a.x - x0, a.y - y0); g.lineTo(b.x - x0, b.y - y0); g.stroke();
      g.globalCompositeOperation = 'source-in'; g.drawImage(orig, x0, y0, w, h, 0, 0, w, h);
      c.drawImage(t, x0, y0);
    }
  }
  view.addEventListener('pointerdown', (e) => {
    if (!st.tool || !st.ready || st.busy) return;
    snapshot(); syncUi();
    const p = toImg(e); stroke = { last: p }; view.setPointerCapture(e.pointerId); e.preventDefault();
    seg(p, p, st.size * p.k); render(); moveRing(e);
  });
  view.addEventListener('pointermove', (e) => {
    moveRing(e);
    if (!stroke) return;
    const p = toImg(e); seg(stroke.last, p, st.size * p.k); stroke.last = p; render();
  });
  const end = () => { stroke = null; };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  view.addEventListener('pointerleave', () => { if (!stroke) ring.style.display = 'none'; });

  $('#bUndo').onclick = () => {
    const c = st.undo.pop(); if (!c) return;
    const g = cut.getContext('2d'); g.clearRect(0, 0, st.w, st.h); g.drawImage(c, 0, 0); render(); syncUi();
  };
  addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'bg' || !st.ready) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#bUndo').click(); }
  });

  /* compare: hold the button */
  const cmp = $('#bCompare');
  const setCompare = (on) => { if (st.compare === on) return; st.compare = on; if (st.ready) render(); };
  cmp.addEventListener('pointerdown', (e) => { e.preventDefault(); setCompare(true); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) cmp.addEventListener(ev, () => setCompare(false));
  cmp.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setCompare(true); } });
  cmp.addEventListener('keyup', () => setCompare(false));

  /* ---------- export ---------- */
  function alphaBounds() {
    const { data } = cut.getContext('2d').getImageData(0, 0, st.w, st.h);
    let x0 = st.w, y0 = st.h, x1 = -1, y1 = -1;
    for (let y = 0; y < st.h; y++) for (let x = 0, i = y * st.w * 4 + 3; x < st.w; x++, i += 4) if (data[i] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? { x: 0, y: 0, w: st.w, h: st.h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  async function save() {
    if (!st.ready || st.busy) return;
    const [, mime, ext] = FORMATS[st.fmt], r = st.trim ? alphaBounds() : { x: 0, y: 0, w: st.w, h: st.h };
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const g = c.getContext('2d');
    const fill = st.bg || (mime === 'image/jpeg' ? '#ffffff' : null);       // JPG has no transparency
    if (fill) { g.fillStyle = fill; g.fillRect(0, 0, r.w, r.h); }
    g.drawImage(cut, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const blob = await new Promise((ok) => c.toBlob(ok, mime, 0.95));
    if (!blob) return toast(`This browser cannot save ${ext.toUpperCase()}. Try PNG.`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${baseOf(st.file.name)}-no-bg.${ext}`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  $('#bSave').onclick = save;

  /* ---------- wiring ---------- */
  $('#bgFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) load(f); };
  $('#bChange').onclick = reset;

  return { load };
})();
