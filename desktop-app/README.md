# Ani Desktop

A private Electron desktop client built from the ani-cli v5 workflow. It supports Auto (AniWave then AniDB), AniWave/Vidplay, and AniDB providers. Source URLs and the preferred provider are editable in Settings. The Electron main process performs source requests, stores local history and bookmarks, and starts an external media player with any required stream referrer. The React renderer has no direct Node.js access.

## Requirements

- Node.js 22 or newer
- npm (included with Node.js) or pnpm
- mpv, VLC, or IINA (macOS) available on `PATH`, or its full executable path configured in Settings

## Run from source

The app runs from source on macOS. The packaged installer currently targets
Windows. From the repository root:

```sh
cd desktop-app
npm install
npm start
```

`npm start` builds and launches the app. If you already ran `npm install`, continue
with `npm start`. For pnpm, use `pnpm install` and `pnpm start` instead.

## IINA on macOS

Install IINA in Applications, then set **Settings → Media player executable or
full path** to:

```text
/Applications/IINA.app/Contents/MacOS/iina-cli
```

Use the bundled `iina-cli` executable. This path stays valid while IINA is
installed in Applications.

The app passes these options to IINA:

- `--no-stdin` to open the stream URL without waiting for terminal input.
- `--mpv-referrer=…` when the stream provides a referrer.
- `--mpv-demuxer-lavf-format=hls` to recognize HLS playlists even when the host
  uses extensionless URLs and image content types.
- Fullscreen and media-title options.

The repository's `ani-cli` script also passes the referrer and explicitly selects
HLS when launching IINA. These changes apply to IINA playback; mpv and VLC retain
their existing launch options.

### Troubleshooting playback

If IINA shows “Cannot open file or stream” or stays on “Loading Media,” first
ensure you are running the updated app. Quit Ani Desktop completely with **⌘Q**,
then run `npm start` from this directory and select the episode again to resolve
a fresh stream URL. Keep the IINA path above in Settings.

If the issue persists, try another episode or provider and report the title,
episode, provider, quality, IINA version, and any error message. The app's
“opened in your media player” notice confirms that the player process started;
playback success is determined by IINA.

## Development

Run with the development server:

```sh
npm run dev
```

pnpm equivalent: `pnpm dev`.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

pnpm equivalents: `pnpm test`, `pnpm typecheck`, and `pnpm build`.

## Windows installer

```powershell
npm run dist:win
```

pnpm equivalent: `pnpm dist:win`.

The installer is written to `release/`. A media player is intentionally not bundled in this first version; each user must install mpv or VLC and select its executable in Settings.

## Security boundary

The renderer uses `contextIsolation`, disables Node integration, and communicates through a small preload API. Source requests and process launching remain in the main process. Do not load remote streaming pages in the application window.
