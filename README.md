# KEXP Playlist Fetcher

A fan-made tool for browsing and exporting [KEXP](https://www.kexp.org) playlists. Built with Vite + React.

## Features

- **Now Playing** — loads the last hour of plays automatically on open
- **Time Window** — fetch any date/time range
- **By DJ** — browse plays by host, chosen from a live dropdown of active KEXP DJs
- **By Program** — filter by recurring show (Morning Show, Audioasis, Roadhouse, etc.)
- Album art thumbnails via KEXP and the [Cover Art Archive](https://coverartarchive.org)
- Rotation breakdown (Heavy / Medium / Light / Library / R/N)
- Filter results by artist, song, or album
- Download results as CSV
- Import CSV to a streaming service via [TuneMyMusic](https://www.tunemymusic.com/transfer/csv-to-apple-music)

## Running locally

```bash
npm install
npm run dev
```

The dev server proxies `/api/*` → `https://api.kexp.org` to avoid CORS issues.

## Deploying to Netlify

The `public/_redirects` file handles the API proxy in production — no environment variables needed.

Build settings:
- **Build command:** `npm run build`
- **Publish directory:** `dist`

## Notes

- All times are Pacific (KEXP's timezone)
- The KEXP API does not filter by time server-side — this app fetches newest-first and stops once it passes your start time
- Album art falls back to the Cover Art Archive when KEXP doesn't have a thumbnail

---

♥ [Donate to KEXP](https://www.kexp.org/donate/) — listener-supported radio from Seattle
