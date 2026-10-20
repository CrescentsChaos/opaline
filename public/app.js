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
yt.then((ok) => { if (!ok) $('#warn').classList.remove('hidden'); });

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

/* ---------- flow 1: images (converted in the browser, nothing uploaded) ---------- */
const FMT = { jpg: 'JPG', png: 'PNG', webp: 'WebP' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
async function convertImage(file, fmt) {
  let bmp;
  try {
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { bmp = await createImageBitmap(file); }
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (fmt === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }   // JPG has no transparency
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, MIME[fmt], 0.92));
    if (!blob) throw new Error();
    if (blob.type !== MIME[fmt]) return Promise.reject(new Error(`This browser cannot save ${FMT[fmt]}. Pick another format or use Chrome, Edge or Firefox.`));
    return blob;
  } catch (e) {
    throw e.message ? e : new Error('This image could not be read, or it is too large for the browser.');
  }
}
function addImage(file) {
  const src = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type] || extOf(file.name);
  const card = new Card({ kind: 'Image', title: file.name, sub: `${FMT[src] || ''} ${size(file.size)}`.trim(), icon: 'image' });
  const img = el('img', 'w-full h-full object-cover'); img.alt = ''; img.src = URL.createObjectURL(file);
  card.thumb(img);

  let url;
  const chips = Object.keys(FMT).filter((f) => f !== src).map((f) => [f, btn(`Convert to ${FMT[f]}`, 'chip', () => run(f))]);
  const run = async (fmt) => {
    chips.forEach(([f, b]) => b.classList.toggle('on', f === fmt));
    card.actions(); card.progress(40, 'Converting…');
    try {
      await tick();
      const blob = await convertImage(file, fmt);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      const diff = Math.round((1 - blob.size / file.size) * 100);
      card.done(`${FMT[fmt]}, ${size(blob.size)}, ${diff >= 0 ? diff + '% smaller' : -diff + '% larger'}`);
      card.actions(dl(url, `${baseOf(file.name)}.${fmt}`));
    } catch (e) { card.fail(e.message); }
  };
  card.controls(...chips.map((c) => c[1]));
  run(src === 'webp' ? 'png' : 'webp');            // sensible default, starts instantly
}

/* ---------- flow 2: video to MP3 (decoded and encoded in the browser) ---------- */
async function toMp3(file, onProgress) {
  if (!window.lamejs) throw new Error('The MP3 encoder did not load. Check your connection and reload.');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let audio;
  try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error('This browser could not read audio from the file. It may have no audio track, use an unsupported format, or be too large for browser memory.'); }
  finally { ctx.close(); }

  const ch = Math.min(audio.numberOfChannels, 2);
  const enc = new lamejs.Mp3Encoder(ch, audio.sampleRate, 192);
  const pcm = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
  const left = audio.getChannelData(0), right = ch > 1 ? audio.getChannelData(1) : null;
  const step = 1152 * 20, out = [];
  for (let i = 0, n = 0; i < audio.length; i += step, n++) {
    const l = pcm(left.subarray(i, i + step));
    const buf = right ? enc.encodeBuffer(l, pcm(right.subarray(i, i + step))) : enc.encodeBuffer(l);
    if (buf.length) out.push(buf);
    if (n % 10 === 0) { onProgress(i / audio.length); await tick(); }   // keep the page responsive
  }
  const end = enc.flush();
  if (end.length) out.push(end);
  return new Blob(out, { type: 'audio/mpeg' });
}
async function addVideo(file) {
  const card = new Card({ kind: 'Video to MP3', title: file.name, sub: size(file.size), icon: 'audio' });
  try {
    card.progress(5, 'Reading audio…'); await tick();
    const blob = await toMp3(file, (p) => card.progress(10 + p * 90, 'Encoding MP3…'));
    card.done(`MP3, ${size(blob.size)}`);
    card.actions(dl(URL.createObjectURL(blob), `${baseOf(file.name)}.mp3`));
  } catch (e) { card.fail(e.message); }
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
  for (const f of files) {
    const e = extOf(f.name);
    if (/^image\/(jpeg|png|webp)$/.test(f.type) || ['jpg', 'png', 'webp'].includes(e)) addImage(f);
    else if (['mp4', 'm4v', 'mov', 'webm', 'mkv'].includes(e) || f.type.startsWith('video/')) addVideo(f);
    else toast(`${f.name} is not supported. Use JPG, PNG, WebP or MP4.`);
  }
}
function handleText(text) {
  const raw = (text.match(/(?:https?:\/\/)?(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\/\S+/i) || [])[0];
  if (!raw) return toast('Paste a YouTube link, or drop an image or MP4.');
  addYouTube(/^https?:/i.test(raw) ? raw : 'https://' + raw);
}

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

