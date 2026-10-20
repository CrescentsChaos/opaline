'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
let FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
if (!process.env.FFMPEG_PATH) { try { FFMPEG = require('ffmpeg-static') || FFMPEG; } catch {} }
const TMP = path.join(os.tmpdir(), 'opaline');
const TTL = 20 * 60 * 1000;                       // finished/idle jobs are deleted after 20 min
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_JOBS || 3);

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const caps = { ytdlp: false };
execFile(YTDLP, ['--version'], (err) => {
  caps.ytdlp = !err;
  if (err) console.warn('yt-dlp not found: YouTube downloads are disabled (see README).');
});

/* ---------- jobs (long-running work with live progress over SSE) ---------- */
const jobs = new Map();
const active = () => [...jobs.values()].filter((j) => j.status === 'uploading' || j.status === 'running').length;
const snap = (j) => `data: ${JSON.stringify({ status: j.status, progress: j.progress, message: j.message, error: j.error, filename: j.filename })}\n\n`;
const finished = (j) => j.status === 'done' || j.status === 'error';

function newJob() {
  if (active() >= MAX_ACTIVE) return null;
  const id = crypto.randomUUID();
  const dir = path.join(TMP, id);
  fs.mkdirSync(dir);
  const job = { id, dir, status: 'uploading', progress: 0, message: '', clients: new Set(), updated: Date.now() };
  jobs.set(id, job);
  return job;
}
function update(job, patch) {
  Object.assign(job, patch, { updated: Date.now() });
  for (const res of job.clients) { res.write(snap(job)); if (finished(job)) res.end(); }
  if (finished(job)) job.clients.clear();
}
const busy = (res) => res.status(429).json({ error: 'The server is busy. Try again in a moment.' });
const safeName = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updated < TTL) continue;
    job.proc?.kill('SIGKILL');
    fs.rm(job.dir, { recursive: true, force: true }, () => {});
    jobs.delete(id);
  }
}, 60 * 1000).unref();

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

// Let the GitHub Pages site call this API: set ALLOWED_ORIGIN=https://<user>.github.io (or * for any origin)
const ORIGIN = process.env.ALLOWED_ORIGIN;
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGIN && (ORIGIN === '*' || o === ORIGIN)) res.set({ 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', Vary: 'Origin' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json(caps));

/* ---------- 3. YouTube (yt-dlp) ---------- */
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
function parseYouTube(raw) {
  try {
    const u = new URL(String(raw).trim());
    return ['http:', 'https:'].includes(u.protocol) && YT_HOSTS.has(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch { return null; }
}
const ytError = (s = '') =>
  /Private video|members-only/i.test(s) ? 'This video is private or members-only.'
  : /unavailable|not available|removed/i.test(s) ? 'This video is unavailable.'
  : /Sign in|confirm you.re not a bot|age/i.test(s) ? 'YouTube is asking for sign-in for this video. Try another one, or update yt-dlp.'
  : 'Could not read this video. Check the link, or update yt-dlp.';
const NO_YTDLP = 'YouTube downloads need yt-dlp installed on the server (see README).';

app.get('/api/youtube/info', (req, res) => {
  if (!caps.ytdlp) return res.status(501).json({ error: NO_YTDLP });
  const url = parseYouTube(req.query.url);
  if (!url) return res.status(400).json({ error: 'That is not a valid YouTube link.' });
  execFile(YTDLP, ['--no-playlist', '--no-warnings', '-J', '--', url], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (err, out, stderr) => {
    if (err) return res.status(422).json({ error: ytError(stderr) });
    try {
      const j = JSON.parse(out);
      if (j.is_live) return res.status(422).json({ error: 'Live streams cannot be downloaded.' });
      res.json({ title: j.title, channel: j.uploader || j.channel, duration: j.duration, thumbnail: j.thumbnail });
    } catch { res.status(500).json({ error: 'Could not read video details.' }); }
  });
});

app.post('/api/youtube', (req, res) => {
  if (!caps.ytdlp) return res.status(501).json({ error: NO_YTDLP });
  const url = parseYouTube(req.body?.url);
  const fmt = ['mp3', 'mp4'].includes(req.body?.format) ? req.body.format : null;
  if (!url || !fmt) return res.status(400).json({ error: 'Send a YouTube link and choose MP4 or MP3.' });
  const job = newJob();
  if (!job) return busy(res);

  const args = ['--no-playlist', '--no-warnings', '--newline', '--no-mtime', '--windows-filenames', '--retries', '3', '--socket-timeout', '20',
    ...(path.isAbsolute(FFMPEG) ? ['--ffmpeg-location', FFMPEG] : []),
    ...(fmt === 'mp3'
      ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
      : ['-f', 'bv*+ba/b', '-S', 'res,ext:mp4:m4a', '--merge-output-format', 'mp4']),
    '-o', path.join(job.dir, '%(title).100s.%(ext)s'), '--', url];

  update(job, { status: 'running', message: 'Starting…' });
  res.json({ jobId: job.id });

  const p = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = p;
  let last = 0, stream = 0, err = '';
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
    if (m) {
      const pct = +m[1];
      if (pct < last - 30) stream++;           // a second stream (audio) started
      last = pct;
      const overall = fmt === 'mp4' ? (stream === 0 ? pct * 0.8 : 80 + pct * 0.2) : pct;
      const rate = /at\s+(\S+)\s+ETA\s+(\S+)/.exec(line);
      update(job, {
        progress: Math.max(job.progress, Math.min(92, Math.round(overall * 0.92))),
        message: (fmt === 'mp4' ? (stream === 0 ? 'Downloading video' : 'Downloading audio') : 'Downloading') + (rate ? ` (${rate[1]}, ${rate[2]} left)…` : '…'),
      });
    } else if (/\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line)) {
      update(job, { progress: Math.max(job.progress, 95), message: fmt === 'mp4' ? 'Merging…' : 'Converting to MP3…' });
    }
  });
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  p.on('error', () => update(job, { status: 'error', error: NO_YTDLP }));
  p.on('close', (code) => {
    if (job.status === 'error') return;
    const file = code === 0 && fs.readdirSync(job.dir).find((f) => /\.(mp4|mp3)$/i.test(f));
    if (!file) return update(job, { status: 'error', error: ytError(err) });
    update(job, { status: 'done', progress: 100, message: 'Ready', file: path.join(job.dir, file), filename: file });
  });
});

/* ---------- job progress + download ---------- */
app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(snap(job));
  if (finished(job)) return res.end();
  job.clients.add(res);
  res.on('close', () => job.clients.delete(res));
});

app.get('/api/jobs/:id/download', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'File not found or expired.' });
  res.download(job.file, job.filename);
});

/* ---------- errors ---------- */
app.use((err, req, res, next) => res.status(err.status || 400).json({ error: err.message }));

const server = app.listen(PORT, () => console.log(`Opaline running at http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { fs.rmSync(TMP, { recursive: true, force: true }); server.close(); process.exit(0); });
