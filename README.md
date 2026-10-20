# Opaline

Drop a file or paste a link, then download.

| Feature | Where it runs |
|---|---|
| JPG / PNG / WebP conversion | Your browser (nothing uploaded) |
| MP4 to MP3 | Your browser (nothing uploaded) |
| YouTube to MP4 / MP3 | Optional backend (`server.js` + yt-dlp) |

## Deploy the site on GitHub Pages
1. Push this folder to a GitHub repo with a `main` branch.
2. In the repo: Settings, Pages, Source: **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` publishes the `public/` folder.

Images and MP4 to MP3 work immediately. Browser limits apply: MP4 to MP3 decodes the whole audio track in memory, so very long or very large files can fail.

## Turn on YouTube (optional)
GitHub Pages cannot run servers, so YouTube needs the backend somewhere else (your own PC with a Cloudflare Tunnel, a VPS, Render with Docker).
1. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp), then `npm install` and run `ALLOWED_ORIGIN=https://<user>.github.io npm start`.
2. Expose it over **https** (Pages blocks plain http calls).
3. Set `api` in `public/config.js` to that URL and push.

Running `npm start` alone also serves the whole site at http://localhost:3000 with YouTube enabled.

Only download content you own or have permission to use.
