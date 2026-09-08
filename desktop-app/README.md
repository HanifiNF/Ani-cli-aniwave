# Ani Desktop

A private Electron desktop client built from the ani-cli v5 workflow. It supports Auto (AniWave then AniDB), AniWave/Vidplay, and AniDB providers. Source URLs and the preferred provider are editable in Settings. The Electron main process performs source requests, stores local history and bookmarks, and starts an external media player with any required stream referrer. The React renderer has no direct Node.js access.

## Requirements

- Node.js 22 or newer
- pnpm
- mpv or VLC available on `PATH`, or its full executable path configured in Settings

## Development

```powershell
pnpm install
pnpm dev
```

## Checks

```powershell
pnpm test
pnpm typecheck
pnpm build
```

## Windows installer

```powershell
pnpm dist:win
```

The installer is written to `release/`. A media player is intentionally not bundled in this first version; each user must install mpv or VLC and select its executable in Settings.

## Security boundary

The renderer uses `contextIsolation`, disables Node integration, and communicates through a small preload API. Source requests and process launching remain in the main process. Do not load remote streaming pages in the application window.
