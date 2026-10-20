'use strict';
const $ = (s) => document.querySelector(s);
const el = (tag, cls = '', text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  audio: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  down: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};

const btn = (label, cls, onclick) => { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; };
const dl = (href, name) => {
  const a = el('a', 'btn-dl'); a.href = href; a.download = name;
  a.innerHTML = svg(ICON.down); a.append('Download ' + name.split('.').pop().toUpperCase());
  return a;
};
const size = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
const extOf = (n) => (n.split('.').pop() || '').toLowerCase().replace('jpeg', 'jpg');
const baseOf = (n) => n.replace(/\.[^.]+$/, '');
const clock = (s) => { if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(Math.floor(s % 60)).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), 3200);
}

/* ---------- a card = one conversion ---------- */
class Card {
  constructor({ kind, title, sub, icon }) {
    this.root = el('article', 'glass rounded-2xl p-4 pop');
    this.root.innerHTML = `
      <div class="flex gap-4 items-start">
        <div data-thumb class="w-16 h-16 shrink-0 rounded-xl bg-white/5 grid place-items-center overflow-hidden text-slate-300">${svg(ICON[icon])}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 min-w-0">
            <span data-kind class="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-400/20 text-indigo-200"></span>
            <p data-title class="truncate font-semibold"></p>
          </div>
          <p data-sub class="text-sm text-slate-400 mt-0.5 break-words"></p>
          <div data-prog class="mt-3 hidden h-2 rounded-full bg-white/10 overflow-hidden"><div data-bar class="bar run h-full rounded-full" style="width:0"></div></div>
        </div>
        <button data-x class="p-1 text-slate-500 hover:text-white" aria-label="Remove">${svg(ICON.x)}</button>
      </div>
      <div data-controls class="mt-4 flex flex-wrap gap-2 empty:hidden"></div>
      <div data-actions class="mt-3 flex flex-wrap gap-2 empty:hidden"></div>`;
    this.q = (s) => this.root.querySelector(s);
    this.q('[data-kind]').textContent = kind;
    this.title(title); this.sub(sub);
    this.q('[data-x]').onclick = () => this.root.remove();
    $('#list').prepend(this.root);
  }
  title(t) { this.q('[data-title]').textContent = t; this.q('[data-title]').title = t; }
  sub(t, cls = 'text-slate-400') { const s = this.q('[data-sub]'); s.textContent = t; s.className = `text-sm mt-0.5 break-words ${cls}`; }
  thumb(node) { const t = this.q('[data-thumb]'); t.replaceChildren(node); }
  controls(...n) { this.q('[data-controls]').replaceChildren(...n); }
  actions(...n) { this.q('[data-actions]').replaceChildren(...n); }
  progress(pct, msg) {
    const pr = this.q('[data-prog]');
    pr.classList.remove('hidden');
    pr.setAttribute('role', 'progressbar'); pr.setAttribute('aria-valuemin', 0); pr.setAttribute('aria-valuemax', 100); pr.setAttribute('aria-valuenow', Math.round(pct));
    this.q('[data-bar]').style.width = Math.max(4, Math.min(100, pct)) + '%';
    this.sub(msg, 'text-slate-300');
  }
  done(msg) { this.q('[data-prog]').classList.add('hidden'); this.sub(msg, 'text-teal-300'); }
  fail(msg) { this.q('[data-prog]').classList.add('hidden'); this.sub(msg, 'text-rose-300'); }
}

/* ---------- helpers ---------- */
// Optional backend (only YouTube needs it). Set in config.js; empty = same origin.
const API = (window.OPALINE?.api || '').replace(/\/$/, '');
const tick = () => new Promise((r) => setTimeout(r));
const yt = fetch(`${API}/api/health`).then((r) => (r.ok ? r.json() : {})).then((c) => !!c.ytdlp).catch(() => false);
// the link box only appears when a YouTube backend is connected (see config.js)
let ytOn = false;
yt.then((ok) => { if (ok) { ytOn = true; $('#yt').classList.remove('hidden'); setTab(currentTab()); } });

// follow a backend job over SSE
const follow = (id, onProgress) => new Promise((ok, no) => {
  const es = new EventSource(`${API}/api/jobs/${id}/events`);
  let end = false;
  es.onmessage = (e) => {
    const s = JSON.parse(e.data);
    if (s.status === 'error') { end = true; es.close(); no(new Error(s.error)); }
    else if (s.status === 'done') { end = true; es.close(); ok(s); }
    else onProgress(s.progress, s.message);
  };
  es.onerror = () => { if (!end) { es.close(); no(new Error('Lost connection to the server.')); } };
});

/* ---------- formats ---------- */
const set = (s) => new Set(s.split(' '));
const IMG_IN = set('apng avif bmp bw cur dds dib exr gif hdr icb ico j2k jfif jp2 jpe jpf jpg jpx pam pbm pcx pgm pic png pnm ppm psd ras rgb rgba sgi sun svg tga tif tiff vda vst webp xbm xwd'), AUD_IN = set('3ga 8svx aac ac3 adts adx aif aifc aiff amr ape ast au bit caf dfpwm dsf dts eac3 ec3 flac gsm iff m4a m4b mka mmf mp1 mp2 mp3 mpa mpc oga ogg oma opus paf pvf ra rso sds sf snd sox sph spx tak tco thd truehd tta voc w64 wav wave wma wv'), VID_IN = set('264 265 3g2 3gp amv asf avc avi avs bik dav divx dv f4v flc fli flv gxf h264 h265 hevc ismv ivf lxf m1v m2ts m2v m4v mjpeg mjpg mkv mod moflex mov mp4 mpe mpeg mpg mts mve mvi mxf nsv nut ogm ogv qt rm rmvb roq rpl smk thp tod tp trp ts txd vc1 vob webm wmv wtv y4m yuv');
const kindOf = (e) => (IMG_IN.has(e) ? 'image' : VID_IN.has(e) ? 'video' : AUD_IN.has(e) ? 'audio' : null);
const X264 = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];
const IMG_OUT = {
  jpg: ['-c:v', 'mjpeg', '-q:v', '2'], png: ['-c:v', 'png'], webp: ['-c:v', 'libwebp', '-quality', '90'],
  gif: ['-c:v', 'gif'], bmp: ['-c:v', 'bmp'], tiff: ['-c:v', 'tiff'], tga: ['-c:v', 'targa'], ppm: ['-c:v', 'ppm'],
  pgm: ['-c:v', 'pgm', '-pix_fmt', 'gray'], pcx: ['-c:v', 'pcx'], jp2: ['-c:v', 'jpeg2000'], sgi: ['-c:v', 'sgi'],
  pam: ['-c:v', 'pam'], apng: ['-c:v', 'apng'],
  ico: ['-vf', 'scale=w=256:h=256:force_original_aspect_ratio=decrease', '-c:v', 'bmp'],
};
const AUD_OUT = {
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'], wav: ['-c:a', 'pcm_s16le'], flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'], opus: ['-c:a', 'libopus', '-b:a', '128k'], aac: ['-c:a', 'aac', '-b:a', '192k'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'], wma: ['-c:a', 'wmav2', '-b:a', '192k'], aiff: ['-c:a', 'pcm_s16be'],
  ac3: ['-c:a', 'ac3', '-b:a', '192k'], mp2: ['-c:a', 'mp2', '-b:a', '192k'], au: ['-c:a', 'pcm_s16be'],
  mka: ['-c:a', 'libvorbis', '-q:a', '5'],
};
const VID_OUT = {
  mp4: [...X264, '-movflags', '+faststart'], m4v: X264, mkv: X264, mov: X264, ts: X264,
  avi: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '192k'],
  webm: ['-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libvorbis'],
  flv: ['-c:v', 'flv', '-c:a', 'libmp3lame', '-ar', '44100'],
  ogv: ['-c:v', 'libtheora', '-q:v', '6', '-c:a', 'libvorbis'],
  mpg: ['-c:v', 'mpeg2video', '-q:v', '4', '-c:a', 'mp2'],
  wmv: ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'wmv2', '-c:a', 'wmav2'],
  gif: ['-an', '-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0'],
};
const OUT = { image: Object.keys(IMG_OUT), audio: Object.keys(AUD_OUT), video: [...Object.keys(VID_OUT), ...Object.keys(AUD_OUT)] };
const POPULAR = { image: ['webp', 'png', 'jpg', 'gif'], audio: ['mp3', 'wav', 'flac', 'ogg'], video: ['mp3', 'mp4', 'webm', 'gif'] };
const ffArgs = (kind, t) => (kind === 'image' ? IMG_OUT[t] : kind === 'video' && VID_OUT[t] ? VID_OUT[t] : ['-vn', ...AUD_OUT[t]]);
const FF_IMG = set('png jpg bmp tiff tif tga ppm pgm pnm pam pcx sgi gif webp psd exr jp2 dds hdr ico');   // ffmpeg can read these directly

/* ---------- images: the browser's canvas is the fast path ---------- */
const NATIVE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
async function decodeImage(file) {
  try {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { return await createImageBitmap(file); }
  } catch {                                           // e.g. SVG: let an <img> decode it
    const url = URL.createObjectURL(file), img = new Image();
    try { img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
  }
}
async function canvasConvert(file, t) {
  const src = await decodeImage(file);
  const w = src.naturalWidth || src.width || 1024, h = src.naturalHeight || src.height || 1024;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (t === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }   // JPG has no transparency
  ctx.drawImage(src, 0, 0, w, h); src.close?.();
  const blob = await new Promise((r) => c.toBlob(r, NATIVE[t], 0.92));
  return blob && blob.type === NATIVE[t] ? blob : null;                  // null: this browser cannot encode it
}

/* ---------- ffmpeg.wasm for everything else (loaded on first use) ---------- */
let ffP, ffChain = Promise.resolve();
const loadScript = (src) => new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok;
  s.onerror = () => no(new Error('Could not load the converter engine. Reload and try again.'));
  document.head.append(s);
});
function getFFmpeg() {
  ffP ??= (async () => {
    await loadScript('vendor/ffmpeg/ffmpeg.js');
    const NS = window.FFmpegWASM || window.FFmpegWrapper;      // the UMD build exposes FFmpegWASM
    if (!NS?.FFmpeg) throw new Error('The converter engine did not load correctly. Reload and try again.');
    const ff = new NS.FFmpeg();
    await ff.load({
      coreURL: new URL('vendor/ffmpeg/ffmpeg-core.js', location.href).href,
      wasmURL: new URL('vendor/ffmpeg/ffmpeg-core.wasm', location.href).href,
    });
    return ff;
  })().catch((e) => { ffP = null; throw e; });
  return ffP;
}
// run any job on the shared ffmpeg instance (one at a time)
function ffJob(fn) {
  const job = ffChain.then(async () => fn(await getFFmpeg()));
  ffChain = job.catch(() => {});
  return job;
}
// stop whatever ffmpeg is doing and start fresh next time
function resetFF() {
  const p = ffP; ffP = null;
  p?.then((ff) => { try { ff.terminate(); } catch {} }).catch(() => {});
}
function ffConvert(blob, inExt, kind, t, on) {
  const job = ffChain.then(async () => {                 // one conversion at a time
    on(4, 'Loading converter (first time only, about 30 MB)…');
    const ff = await getFFmpeg();
    const inName = `in.${inExt.replace(/[^a-z0-9]/g, '') || 'bin'}`, outName = `out.${t}`;
    const onProg = ({ progress }) => on(25 + Math.max(0, Math.min(1, progress || 0)) * 70, 'Converting…');
    try {
      on(25, 'Converting…');
      await ff.writeFile(inName, new Uint8Array(await blob.arrayBuffer()));
      ff.on('progress', onProg);
      const code = await ff.exec(['-i', inName, ...ffArgs(kind, t), outName]);
      if (code !== 0) throw Object.assign(new Error(`This file could not be converted to ${t.toUpperCase()}. It may be corrupt, or that combination is not supported.`), { soft: true });
      return new Blob([await ff.readFile(outName)]);
    } catch (e) {
      if (e.soft) throw e;
      try { ff.terminate(); } catch {}
      ffP = null;
      throw new Error('The converter ran out of memory or stopped. Try a smaller file.');
    } finally {
      ff.off('progress', onProg);
      for (const f of [inName, outName]) ff.deleteFile(f).catch(() => {});
    }
  });
  ffChain = job.catch(() => {});
  return job;
}

/* ---------- audio: the browser decodes and lamejs encodes MP3 (fast path) ---------- */
async function toMp3(file, onProgress) {
  if (!window.lamejs) throw new Error('The MP3 encoder did not load.');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let audio;
  try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); } finally { ctx.close(); }
  const ch = Math.min(audio.numberOfChannels, 2);
  const enc = new lamejs.Mp3Encoder(ch, audio.sampleRate, 192);
  const pcm = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
  const left = audio.getChannelData(0), right = ch > 1 ? audio.getChannelData(1) : null;
  const step = 1152 * 20, out = [];
  for (let i = 0, n = 0; i < audio.length; i += step, n++) {
    const l = pcm(left.subarray(i, i + step));
    const buf = right ? enc.encodeBuffer(l, pcm(right.subarray(i, i + step))) : enc.encodeBuffer(l);
    if (buf.length) out.push(buf);
    if (n % 10 === 0) { onProgress(i / audio.length); await tick(); }
  }
  const end = enc.flush();
  if (end.length) out.push(end);
  return new Blob(out, { type: 'audio/mpeg' });
}

/* ---------- one entry point: pick the best engine ---------- */
async function convert(file, kind, src, t, on) {
  if (kind === 'image') {
    if (NATIVE[t]) { const b = await canvasConvert(file, t).catch(() => null); if (b) return b; }
    else if (!FF_IMG.has(src)) {                           // AVIF, SVG and friends: decode in the browser, hand ffmpeg a PNG
      const png = await canvasConvert(file, 'png').catch(() => null);
      if (png) return ffConvert(png, 'png', kind, t, on);
    }
  } else if (t === 'mp3') {
    try { on(10, 'Reading audio…'); return await toMp3(file, (p) => on(10 + p * 90, 'Encoding MP3…')); } catch {}
  }
  return ffConvert(file, src, kind, t, on);
}

function addFile(file, kind) {
  const src = extOf(file.name);
  const first = kind === 'image' ? (src === 'webp' ? 'png' : 'webp') : kind === 'video' ? 'mp3' : null;   // instant defaults
  const card = new Card({
    kind: { image: 'Image', audio: 'Audio', video: 'Video' }[kind], title: file.name,
    sub: `${src.toUpperCase()}, ${size(file.size)}${first ? '' : '. Choose a format to convert to.'}`, icon: kind,
  });
  if (kind === 'image') { const img = el('img', 'w-full h-full object-cover'); img.alt = ''; img.onload = () => card.thumb(img); img.src = URL.createObjectURL(file); }

  const targets = OUT[kind].filter((t) => t !== src);
  const chips = POPULAR[kind].filter((t) => targets.includes(t)).map((t) => [t, btn(`Convert to ${t.toUpperCase()}`, 'chip', () => run(t))]);
  const sel = el('select', 'chip');
  sel.setAttribute('aria-label', 'Convert to another format'); sel.style.colorScheme = 'dark';
  sel.append(new Option('More formats…', ''));
  for (const t of targets) sel.append(new Option(t.toUpperCase(), t));
  sel.onchange = () => sel.value && run(sel.value);
  card.controls(...chips.map((c) => c[1]), sel, ...(kind === 'video' ? [btn('Edit as GIF…', 'chip', () => openGifEditor(file))] : kind === 'image' ? [btn('Edit photo', 'chip', () => openPhotoEditor([file])), btn('Remove background', 'chip', () => openBgEditor(file))] : []));

  let url;
  const run = async (t) => {
    const chip = chips.some(([f]) => f === t);
    chips.forEach(([f, b]) => b.classList.toggle('on', f === t));
    sel.value = chip ? '' : t;
    card.actions(); card.progress(8, 'Preparing…');
    try {
      await tick();
      const blob = await convert(file, kind, src, t, (p, m) => card.progress(p, m));
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      const diff = Math.round((1 - blob.size / file.size) * 100);
      card.done(`${t.toUpperCase()}, ${size(blob.size)}${kind === 'image' ? (diff >= 0 ? `, ${diff}% smaller` : `, ${-diff}% larger`) : ''}`);
      card.actions(dl(url, `${baseOf(file.name)}.${t}`));
    } catch (e) { card.fail(e.message); }
  };
  if (first) run(first);
}

/* ---------- flow 3: YouTube ---------- */
async function addYouTube(url) {
  if (!(await yt)) return toast('YouTube needs a connected backend. See the README.');
  const card = new Card({ kind: 'YouTube', title: url, sub: 'Fetching video details…', icon: 'video' });
  try {
    const r = await fetch(API + '/api/youtube/info?url=' + encodeURIComponent(url));
    const info = await r.json();
    if (!r.ok) throw new Error(info.error);
    card.title(info.title);
    card.sub([info.channel, clock(info.duration)].filter(Boolean).join(', ') + '. Choose a format.');
    if (info.thumbnail) { const i = el('img', 'w-full h-full object-cover'); i.alt = ''; i.referrerPolicy = 'no-referrer'; i.src = info.thumbnail; card.thumb(i); }

    const go = async (fmt) => {
      card.actions(); card.progress(0, 'Starting…');
      try {
        const res = await fetch(API + '/api/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, format: fmt }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        const s = await follow(j.jobId, (p, m) => card.progress(p, m));
        card.done(`${fmt.toUpperCase()} ready`);
        card.actions(dl(`${API}/api/jobs/${j.jobId}/download`, s.filename));
      } catch (e) { card.fail(e.message); }
    };
    card.controls(btn('Download video (MP4)', 'chip', () => go('mp4')), btn('Download audio (MP3)', 'chip', () => go('mp3')));
  } catch (e) { card.fail(e.message); }
}

/* ---------- auto-detect + input handling ---------- */
function handleFiles(files) {
  if (currentTab() === 'gif') {
    const v = [...files].find((f) => kindOf(extOf(f.name)) === 'video');
    return v ? openGifEditor(v) : toast('Choose a video file to make a GIF.');
  }
  if (currentTab() === 'photo') return window.PhotoEditor.load(files);
  if (currentTab() === 'bg') {
    const im = [...files].find((f) => kindOf(extOf(f.name)) === 'image' || f.type.startsWith('image/'));
    return im ? openBgEditor(im) : toast('Choose an image to remove its background.');
  }
  for (const f of files) {
    const k = kindOf(extOf(f.name));
    if (k) addFile(f, k); else toast(`.${extOf(f.name) || 'unknown'} files are not supported yet.`);
  }
}
function handleText(text) {
  const raw = (text.match(/(?:https?:\/\/)?(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\/\S+/i) || [])[0];
  if (!raw) return toast('Drop a file to convert it.');
  addYouTube(/^https?:/i.test(raw) ? raw : 'https://' + raw);
}

/* ---------- tabs: Convert files | Video to GIF ---------- */
const COPY = {
  convert: ['Drop it. Convert it. Download.', 'Convert between 164+ file types: images, audio and video. Nothing leaves your browser.', 'Drop to convert', 'Images and videos are converted in your browser and never uploaded.'],
  gif: ['Turn any video into a GIF.', 'Trim the clip, crop the frame and download. Nothing leaves your browser.', 'Drop a video to edit', 'Videos are edited in your browser and never uploaded.'],
  photo: ['Edit your photo.', 'Add overlay images, crop, resize, recolour and texture them, then download. Nothing leaves your browser.', 'Drop images to edit', 'Images are edited in your browser and never uploaded.'],
  bg: ['Remove any background.', 'Upload a photo and get a clean cutout, then fix the edges with the brush. Nothing leaves your browser.', 'Drop an image', 'Images are processed in your browser and never uploaded.'],
};
const currentTab = () => document.body.dataset.tab || 'convert';
function setTab(name) {
  document.body.dataset.tab = name;
  for (const b of document.querySelectorAll('[data-tab-btn]')) {
    const on = b.dataset.tabBtn === name;
    b.setAttribute('aria-selected', on); b.classList.toggle('on', on);
  }
  for (const [k, id] of [['convert', '#convertPane'], ['photo', '#photoPane'], ['bg', '#bgPane'], ['gif', '#gifPane']]) $(id).classList.toggle('hidden', k !== name);
  const [head, lede, drop, foot] = COPY[name];
  $('#headline').textContent = head; $('#ledeText').textContent = lede;
  $('#ytNote').classList.toggle('hidden', !(ytOn && name === 'convert'));
  $('#overlayText').textContent = drop; $('#footnote').textContent = foot;
}
for (const b of document.querySelectorAll('[data-tab-btn]')) b.onclick = () => setTab(b.dataset.tabBtn);
function openPhotoEditor(files) { setTab('photo'); window.PhotoEditor.load(files); scrollTo({ top: 0, behavior: 'smooth' }); }
function openBgEditor(file) { setTab('bg'); window.BgEditor.load(file); scrollTo({ top: 0, behavior: 'smooth' }); }
function openGifEditor(file) { setTab('gif'); window.GifEditor.load(file); scrollTo({ top: 0, behavior: 'smooth' }); }
setTab('convert');

$('#file').onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
$('#linkForm').onsubmit = (e) => { e.preventDefault(); const v = $('#link').value; $('#link').value = ''; if (v.trim()) handleText(v); };

// paste anywhere: image from clipboard or a link
document.addEventListener('paste', (e) => {
  const cd = e.clipboardData; if (!cd) return;
  if (cd.files.length) { e.preventDefault(); handleFiles(cd.files); }
  else { const t = cd.getData('text'); if (t.trim()) { e.preventDefault(); $('#link').value = ''; handleText(t); } }
});

// drop anywhere
let depth = 0;
const overlay = $('#overlay');
addEventListener('dragenter', (e) => { e.preventDefault(); depth++; overlay.classList.remove('hidden'); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; overlay.classList.add('hidden'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); depth = 0; overlay.classList.add('hidden');
  const dt = e.dataTransfer;
  if (dt.files.length) handleFiles(dt.files);
  else handleText(dt.getData('text/uri-list') || dt.getData('text/plain') || '');
});

