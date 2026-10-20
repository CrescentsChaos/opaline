# Opaline

Drop a file, pick a format, download. Everything runs in your browser; nothing is uploaded.

- **Inputs:** about 164 file extensions (images, audio, video).
- **Outputs:** about 39 formats, such as JPG, PNG, WebP, GIF, BMP, TIFF, ICO, MP3, WAV, FLAC, OGG, OPUS, AAC, M4A, MP4, MKV, MOV, WebM, AVI.
- **Engines:** the browser's own image tools and a built-in MP3 encoder for quick jobs. Everything else uses ffmpeg.wasm, downloaded the first time it is needed (about 30 MB).

## Deploy on GitHub Pages
1. Push this folder to a repo's `main` branch.
2. Settings, Pages, Source: **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` installs ffmpeg.wasm and publishes `public/`.

## Limits
Conversion happens in browser memory, so very large files can fail, and video re-encoding in the browser is slow. HEIC, RAW photos and documents are not supported.

## Optional: YouTube
Needs a separate backend (`server.js` + yt-dlp). Set its address as `api` in `public/config.js`. Only download content you own or have permission to use.
