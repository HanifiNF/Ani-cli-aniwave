# Ani Desktop

A private Electron desktop client built from the ani-cli v5 workflow. It supports Auto, AniWave/Vidplay, and AniDB providers. HLS video plays in a built-in Vidstack window on Windows and macOS; mpv, VLC, and IINA remain optional external fallbacks. The React renderers have no direct Node.js access.

## Requirements

- Node.js 22 or newer
- npm, included with Node.js

No separate media player is required.

## Run from source

The app runs from source on Windows and macOS:

```sh
cd desktop-app
npm install
npm start
```

`npm start` builds and launches the Electron app. Use `npm run dev` for the development server or `npx vite` for the renderer-only browser preview.

## Using the app

Type at least two characters to search automatically after a short pause, or press Enter to search immediately. Results, saved titles, and recent titles support mouse and keyboard navigation.

- Auto search combines matching AniWave and AniDB titles while keeping provider-native episode lists.
- Open a series, select a provider tab, and choose an episode to resolve and play its stream.
- The built-in player opens in a separate reusable window with playback, seeking, volume, captions, quality, picture-in-picture, and fullscreen controls.
- Provider-specific progress, history, bookmarks, source links, preferred quality, audio mode, and theme are stored locally.
- Settings control the playback target, instant fullscreen, external fallback path, provider addresses, and theme.

If the built-in player reports a fatal error, use **Retry**. **Open in external player** appears when an external-player path is configured and is never triggered automatically.

## Optional external players

Choose **Settings → Playback → external**, or keep built-in playback selected and use the fallback button. The fullscreen/windowed preference applies to both targets.

For IINA on macOS, set the external path to:

```text
/Applications/IINA.app/Contents/MacOS/iina-cli
```

The app supplies the HLS format, referrer, media title, and fullscreen options required by IINA. Equivalent supported arguments are supplied to mpv and VLC.

## Themes and icons

Theme presets and custom colours control the interface and running app icon. Builds generate a graphite PNG, multi-size Windows ICO, and Retina-ready macOS ICNS from `../app-icon.svg`.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

## Windows installer

```powershell
npm run dist:win
```

The x64 NSIS installer is written to `release/`.

## macOS packages

On macOS, build Intel and Apple Silicon DMGs with:

```sh
npm run dist:mac
```

The unsigned DMGs are written to `release/`. A downloaded unsigned build may be blocked on first launch; after attempting to open it, a trusted user can approve it with **System Settings → Privacy & Security → Open Anyway**.

## GitHub releases

Set the package version, commit it, and push the matching tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The desktop release workflow tests the app and attaches a Windows x64 installer plus Intel and Apple Silicon macOS DMGs to the tag's GitHub Release. macOS signing and notarization can be added later.

Vidstack and hls.js are bundled JavaScript dependencies; no native player executable or streamed media is included. See [Third-party notices](THIRD_PARTY_NOTICES.md).

## Security boundary

Both renderers use `contextIsolation`, disable Node integration, and communicate through narrow preload APIs. The video window uses a separate nonpersistent session for HLS requests, referrer handling, and scoped CORS response headers. Navigation, popups, and permission requests are blocked. Source requests and process launching remain in the main process; remote streaming pages are never loaded as application UI.
