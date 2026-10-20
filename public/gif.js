'use strict';
/* Video to GIF editor. Uses helpers from app.js: $, el, btn, dl, size, baseOf, extOf, toast, ffJob, resetFF, X264, tick */
window.GifEditor = (() => {
  const RATIOS = [['Free', null], ['Square', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4]];
  const WIDTHS = [320, 480, 640, 800], FPS = [8, 12, 15, 20], SPEEDS = [0.5, 1, 1.5, 2];
  const MIN_LEN = 0.2, MIN_BOX = 0.06;

  const st = {
    file: null, blob: null, url: null, dur: 0, vw: 0, vh: 0,
    start: 0, end: 0, box: { x: 0, y: 0, w: 1, h: 1 }, ratio: null,
    width: 480, fps: 12, speed: 1, loop: true, busy: false, token: 0, resultUrl: null,
  };

  const v = $('#gv'), stage = $('#stage'), cropEl = $('#crop'), strip = $('#strip');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const stamp = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0'); return `${m}:${s}`; };
  const show = (sel, on) => $(sel).classList.toggle('hidden', !on);

  /* ---------- option chips ---------- */
  function chipRow(host, items, label, get, set) {
    const row = $(host); row.replaceChildren();
    const btns = items.map(([text, val]) => {
      const b = btn(text, 'chip', () => { set(val); paint(); update(); });
      row.append(b); return [val, b];
    });
    const paint = () => btns.forEach(([val, b]) => { const on = val === get(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    paint(); row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
    return paint;
  }
  const paintRatios = chipRow('#ratios', RATIOS, 'Crop shape', () => st.ratio, (r) => { st.ratio = r; if (r) fitRatio(r); drawCrop(); });
  chipRow('#optW', WIDTHS.map((w) => [`${w} px`, w]), 'Width', () => st.width, (w) => (st.width = w));
  chipRow('#optF', FPS.map((f) => [`${f} fps`, f]), 'Frame rate', () => st.fps, (f) => (st.fps = f));
  chipRow('#optS', SPEEDS.map((s) => [`${s}×`, s]), 'Speed', () => st.speed, (s) => (st.speed = s));
  $('#optL').onchange = (e) => (st.loop = e.target.checked);

  const resetCropBtn = btn('Reset crop', 'chip', () => { st.ratio = null; st.box = { x: 0, y: 0, w: 1, h: 1 }; paintRatios(); drawCrop(); });
  $('#ratios').append(resetCropBtn);

  /* ---------- loading ---------- */
  function cleanup() {
    if (st.url) URL.revokeObjectURL(st.url);
    if (st.resultUrl) URL.revokeObjectURL(st.resultUrl);
    st.url = st.resultUrl = null;
  }

  async function load(file) {
    const token = ++st.token;
    cleanup(); v.pause(); showResult(false); showError('');
    Object.assign(st, { file, blob: file, dur: 0, start: 0, end: 0, box: { x: 0, y: 0, w: 1, h: 1 }, ratio: null });
    paintRatios();
    $('#gName').textContent = file.name; $('#gName').title = file.name;
    show('#gifDrop', false); show('#gifEditor', true); show('#prep', false);
    try {
      await attach(file);
    } catch {
      // the browser cannot play this format: convert to MP4 once, then edit that
      try { await transcode(file, token); }
      catch (e) { if (token === st.token) { toast(e.message || 'This video could not be opened.'); reset(); } return; }
    }
    if (token !== st.token) return;
    ready(token);
  }

  function attach(blob) {
    return new Promise((ok, no) => {
      if (st.url) URL.revokeObjectURL(st.url);
      st.url = URL.createObjectURL(blob);
      const done = () => { v.onloadedmetadata = v.onerror = null; };
      v.onloadedmetadata = () => { done(); if (!v.videoWidth || !isFinite(v.duration)) return no(new Error('no video')); ok(); };
      v.onerror = () => { done(); no(new Error('unsupported')); };
      v.src = st.url; v.load();
    });
  }

  async function transcode(file, token) {
    show('#prep', true);
    const set = (p, m) => { $('#prepBar').style.width = Math.max(4, Math.min(100, p)) + '%'; $('#prepMsg').textContent = m; };
    set(4, 'Loading converter (first time only)…');
    const ext = (extOf(file.name).replace(/[^a-z0-9]/g, '') || 'bin');
    const out = await ffJob(async (ff) => {
      const onProg = ({ progress }) => set(15 + clamp(progress || 0, 0, 1) * 80, 'Preparing video…');
      try {
        set(12, 'Preparing video…');
        await ff.writeFile(`pre.${ext}`, new Uint8Array(await file.arrayBuffer()));
        ff.on('progress', onProg);
        const code = await ff.exec(['-i', `pre.${ext}`, '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'pre.mp4']);
        if (code !== 0) throw Object.assign(new Error('This video could not be opened. It may be corrupt or use an unsupported codec.'), { soft: true });
        return new Blob([await ff.readFile('pre.mp4')], { type: 'video/mp4' });
      } catch (e) {
        if (e.soft) throw e;
        resetFF(); throw new Error('The converter ran out of memory or stopped. Try a smaller video.');
      } finally { ff.off('progress', onProg); for (const f of [`pre.${ext}`, 'pre.mp4']) ff.deleteFile(f).catch(() => {}); }
    });
    if (token !== st.token) return;
    st.blob = out;
    await attach(out);
    show('#prep', false);
  }

  function ready(token) {
    st.dur = v.duration; st.vw = v.videoWidth; st.vh = v.videoHeight;
    st.start = 0; st.end = st.dur;
    $('#gDur').textContent = stamp(st.dur);
    v.currentTime = 0;
    drawCrop(); drawTrim(); update();
    thumbnails(token);
  }

  function reset() {
    ++st.token; cleanup(); v.pause(); v.removeAttribute('src'); v.load(); st.file = st.blob = null;
    show('#gifEditor', false); show('#gifDrop', true);
  }

  /* ---------- thumbnails for the timeline ---------- */
  async function thumbnails(token) {
    const c = $('#thumbs'), g = c.getContext('2d');
    const N = 14, tv = document.createElement('video');
    tv.muted = true; tv.preload = 'auto'; tv.src = st.url;
    try {
      await new Promise((ok, no) => { tv.onloadeddata = ok; tv.onerror = no; });
      const tw = c.width / N, th = c.height;
      for (let i = 0; i < N; i++) {
        if (token !== st.token) return;
        await new Promise((ok) => { tv.onseeked = ok; setTimeout(ok, 1500); tv.currentTime = Math.min(st.dur - 0.05, (i + 0.5) * st.dur / N); });
        const s = Math.max(tw / tv.videoWidth, th / tv.videoHeight), w = tv.videoWidth * s, h = tv.videoHeight * s;
        g.drawImage(tv, i * tw + (tw - w) / 2, (th - h) / 2, w, h);
      }
    } catch { /* the strip still works without thumbnails */ }
    finally { tv.removeAttribute('src'); tv.load(); }
  }

  /* ---------- crop ---------- */
  function fitRatio(r) {
    const k = st.vw / (r * st.vh);                // box height = width * k (normalised)
    const w = k <= 1 ? 1 : 1 / k, h = k <= 1 ? k : 1;
    st.box = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }
  function cropPx() {
    const x = clamp(Math.round(st.box.x * st.vw), 0, st.vw - 2), y = clamp(Math.round(st.box.y * st.vh), 0, st.vh - 2);
    const w = clamp(Math.round(st.box.w * st.vw), 2, st.vw - x), h = clamp(Math.round(st.box.h * st.vh), 2, st.vh - y);
    return { x, y, w, h, full: x === 0 && y === 0 && w === st.vw && h === st.vh };
  }
  function drawCrop() {
    const b = st.box, s = cropEl.style;
    s.left = b.x * 100 + '%'; s.top = b.y * 100 + '%'; s.width = b.w * 100 + '%'; s.height = b.h * 100 + '%';
    cropEl.classList.toggle('locked', !!st.ratio);
    resetCropBtn.hidden = !st.vw || (cropPx().full && !st.ratio);
    update();
  }

  let drag = null;
  cropEl.addEventListener('pointerdown', (e) => {
    const h = e.target.dataset?.h || 'move', r = stage.getBoundingClientRect();
    drag = { h, sx: e.clientX, sy: e.clientY, r, b: { ...st.box } };
    cropEl.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cropEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { h, r, b } = drag, dx = (e.clientX - drag.sx) / r.width, dy = (e.clientY - drag.sy) / r.height;
    if (h === 'move') {
      st.box = { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) };
    } else if (st.ratio) {
      // corner resize with a locked shape: the opposite corner stays put
      const k = st.vw / (st.ratio * st.vh), west = h.includes('w'), north = h.includes('n');
      const ax = west ? b.x + b.w : b.x, ay = north ? b.y + b.h : b.y;
      const px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
      const maxW = west ? ax : 1 - ax, maxH = north ? ay : 1 - ay;
      let w = Math.min(Math.abs(px - ax), maxW), hh = w * k;
      if (hh > maxH) { hh = maxH; w = hh / k; }
      w = Math.max(w, MIN_BOX); hh = w * k;
      st.box = { x: west ? ax - w : ax, y: north ? ay - hh : ay, w, h: hh };
    } else {
      let l = b.x, t = b.y, rt = b.x + b.w, bt = b.y + b.h;
      if (h.includes('w')) l = clamp(b.x + dx, 0, rt - MIN_BOX);
      if (h.includes('e')) rt = clamp(rt + dx, l + MIN_BOX, 1);
      if (h.includes('n')) t = clamp(b.y + dy, 0, bt - MIN_BOX);
      if (h.includes('s')) bt = clamp(bt + dy, t + MIN_BOX, 1);
      st.box = { x: l, y: t, w: rt - l, h: bt - t };
    }
    drawCrop();
  });
  const endDrag = () => { drag = null; };
  cropEl.addEventListener('pointerup', endDrag); cropEl.addEventListener('pointercancel', endDrag);

  /* ---------- trim timeline ---------- */
  const pct = (t) => (st.dur ? (t / st.dur) * 100 : 0);
  function drawTrim() {
    const s = pct(st.start), e = pct(st.end);
    $('#gripS').style.left = s + '%'; $('#gripE').style.left = e + '%';
    $('#dimL').style.width = s + '%'; $('#dimR').style.width = 100 - e + '%';
    Object.assign($('#sel').style, { left: s + '%', width: e - s + '%' });
    $('#gripS').setAttribute('aria-valuenow', st.start.toFixed(1)); $('#gripE').setAttribute('aria-valuenow', st.end.toFixed(1));
    $('#tS').textContent = stamp(st.start); $('#tE').textContent = stamp(st.end);
    $('#tLen').textContent = (st.end - st.start).toFixed(1) + ' s';
    update();
  }
  function drawHead() {
    $('#playhead').style.left = pct(v.currentTime) + '%';
    $('#gNow').textContent = stamp(v.currentTime);
  }
  const timeAt = (e) => { const r = strip.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * st.dur; };
  const seek = (t) => { v.currentTime = clamp(t, 0, st.dur); drawHead(); };

  let grip = null;
  for (const [id, which] of [['#gripS', 's'], ['#gripE', 'e']]) {
    const g = $(id);
    g.addEventListener('pointerdown', (e) => { grip = which; v.pause(); g.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    g.addEventListener('pointermove', (e) => { if (grip === which) moveGrip(which, timeAt(e)); });
    g.addEventListener('pointerup', () => { grip = null; }); g.addEventListener('pointercancel', () => { grip = null; });
    g.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]; if (!d) return;
      e.preventDefault(); moveGrip(which, (which === 's' ? st.start : st.end) + d * (e.shiftKey ? 1 : 0.1));
    });
  }
  function moveGrip(which, t) {
    if (which === 's') { st.start = clamp(t, 0, st.end - MIN_LEN); seek(st.start); }
    else { st.end = clamp(t, st.start + MIN_LEN, st.dur); seek(Math.max(st.start, st.end - 0.05)); }
    drawTrim();
  }
  strip.addEventListener('pointerdown', (e) => {                    // click or drag on the strip to scrub
    if (e.target.classList.contains('grip')) return;
    v.pause(); seek(timeAt(e)); strip.setPointerCapture(e.pointerId); strip._scrub = true;
  });
  strip.addEventListener('pointermove', (e) => { if (strip._scrub) seek(timeAt(e)); });
  strip.addEventListener('pointerup', () => { strip._scrub = false; });
  $('#setS').onclick = () => { moveGrip('s', Math.min(v.currentTime, st.end - MIN_LEN)); };
  $('#setE').onclick = () => { const t = Math.max(v.currentTime, st.start + MIN_LEN); st.end = clamp(t, st.start + MIN_LEN, st.dur); drawTrim(); };

  /* ---------- playback (loops inside the trimmed range) ---------- */
  const PLAY = '<path d="M8 5v14l11-7z"/>', PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
  function toggle() {
    if (!st.dur) return;
    if (v.paused) { if (v.currentTime < st.start || v.currentTime >= st.end - 0.05) v.currentTime = st.start; v.play().catch(() => {}); }
    else v.pause();
  }
  $('#gPlay').onclick = toggle;
  v.addEventListener('click', toggle);
  v.addEventListener('play', () => { $('#gPlayIcon').innerHTML = PAUSE; $('#gPlay').setAttribute('aria-label', 'Pause'); loop(); });
  v.addEventListener('pause', () => { $('#gPlayIcon').innerHTML = PLAY; $('#gPlay').setAttribute('aria-label', 'Play'); });
  function loop() {
    if (v.paused) return;
    if (v.currentTime >= st.end) v.currentTime = st.start;
    drawHead(); requestAnimationFrame(loop);
  }
  v.addEventListener('seeked', drawHead);
  addEventListener('resize', drawCrop);

  /* ---------- output summary ---------- */
  function outSize() {
    const c = cropPx(), w = Math.min(st.width, c.w);
    return { w, h: Math.max(2, Math.round((c.h * w) / c.w)) };
  }
  function update() {
    if (!st.dur) return;
    const c = cropPx(), o = outSize(), len = st.end - st.start, frames = Math.max(1, Math.round((len / st.speed) * st.fps));
    $('#gCropInfo').textContent = c.full ? `${st.vw} × ${st.vh} px` : `Crop ${c.w} × ${c.h} px`;
    const big = frames > 250;
    $('#gEst').textContent = `${o.w} × ${o.h} px, ${frames} frames, ${(len / st.speed).toFixed(1)} s${big ? '. Long clips make large files: try a lower frame rate or a shorter range.' : ''}`;
    $('#gEst').className = `mt-4 text-sm ${big ? 'text-amber-300' : 'text-slate-400'}`;
  }

  /* ---------- create the GIF ---------- */
  function showError(m) { $('#gErr').textContent = m; show('#gErr', !!m); }
  function showResult(on) { show('#gResult', on); }
  function busy(on, pctNow = 4, msg = '') {
    st.busy = on; $('#gMake').disabled = on; $('#gMake').classList.toggle('opacity-60', on);
    show('#gCancel', on); show('#gProg', on);
    $('#gBar').style.width = Math.max(4, Math.min(100, pctNow)) + '%'; $('#gMsg').textContent = msg;
  }

  async function make() {
    if (st.busy || !st.blob) return;
    v.pause(); showError(''); showResult(false);
    const c = cropPx(), o = outSize(), len = st.end - st.start;
    const vf = [
      c.full ? null : `crop=${c.w}:${c.h}:${c.x}:${c.y}`,
      st.speed !== 1 ? `setpts=PTS/${st.speed}` : null,
      `fps=${st.fps}`,
      `scale=${o.w}:-1:flags=lanczos`,
      'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    ].filter(Boolean).join(',');
    const ext = st.blob === st.file ? (extOf(st.file.name).replace(/[^a-z0-9]/g, '') || 'mp4') : 'mp4';
    const inName = `src.${ext}`, token = st.token;
    busy(true, 4, 'Loading converter (first time only, about 30 MB)…');
    try {
      const out = await ffJob(async (ff) => {
        const onProg = ({ progress }) => st.busy && busy(true, 20 + clamp(progress || 0, 0, 1) * 75, 'Creating GIF…');
        try {
          busy(true, 15, 'Creating GIF…');
          await ff.writeFile(inName, new Uint8Array(await st.blob.arrayBuffer()));
          ff.on('progress', onProg);
          const code = await ff.exec(['-ss', st.start.toFixed(3), '-t', len.toFixed(3), '-i', inName, '-an', '-vf', vf, '-loop', st.loop ? '0' : '-1', 'out.gif']);
          if (code !== 0) throw Object.assign(new Error('The GIF could not be created from this video. Try a different range or another file.'), { soft: true });
          return new Blob([await ff.readFile('out.gif')], { type: 'image/gif' });
        } catch (e) {
          if (e.soft) throw e;
          resetFF(); throw new Error(st.cancelled ? 'Cancelled.' : 'The converter ran out of memory or stopped. Try a shorter clip, a smaller width or a lower frame rate.');
        } finally { ff.off('progress', onProg); for (const f of [inName, 'out.gif']) ff.deleteFile(f).catch(() => {}); }
      });
      if (token !== st.token) return;
      if (st.resultUrl) URL.revokeObjectURL(st.resultUrl);
      st.resultUrl = URL.createObjectURL(out);
      $('#gImg').src = st.resultUrl;
      $('#gInfo').textContent = `${o.w} × ${o.h} px, ${size(out.size)}, ${(len / st.speed).toFixed(1)} s`;
      $('#gDl').replaceChildren(dl(st.resultUrl, `${baseOf(st.file.name)}.gif`));
      showResult(true);
      $('#gResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (!st.cancelled) showError(e.message);
    } finally { st.cancelled = false; busy(false); }
  }
  $('#gMake').onclick = make;
  $('#gCancel').onclick = () => { st.cancelled = true; resetFF(); busy(false); };

  /* ---------- wiring ---------- */
  $('#gifFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) load(f); };
  $('#gChange').onclick = reset;
  addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'gif' || !st.dur || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName) || e.target.getAttribute?.('role') === 'slider') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  });

  return { load };
})();
