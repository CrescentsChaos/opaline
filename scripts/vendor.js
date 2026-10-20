'use strict';
// Copies ffmpeg.wasm from node_modules into public/vendor/ffmpeg so it is served from your own origin.
// GitHub Pages does this in the workflow; run `npm install && npm run vendor` for local use.
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'public', 'vendor', 'ffmpeg');
const dir = (pkg) => { try { return path.dirname(require.resolve(`${pkg}/package.json`)); } catch { return null; } };
const ff = dir('@ffmpeg/ffmpeg'), core = dir('@ffmpeg/core');
if (!ff || !core) { console.log('ffmpeg.wasm packages not installed; skipping (run npm install first).'); process.exit(0); }
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(ff, 'dist', 'umd'), out, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) fs.copyFileSync(path.join(core, 'dist', 'umd', f), path.join(out, f));
console.log('ffmpeg.wasm copied to public/vendor/ffmpeg');
