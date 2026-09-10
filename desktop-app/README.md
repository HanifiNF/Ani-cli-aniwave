# Ani Desktop

A private Electron desktop client built from the ani-cli v5 workflow. It supports Auto, AniWave/Vidplay, and AniDB providers. HLS video plays in a built-in Vidstack window on Windows, macOS, and Linux; mpv, VLC, and IINA remain optional external fallbacks. The React renderers have no direct Node.js access.

## Requirements

- Node.js 22 or newer
- npm, included with Node.js

No separate media player is required.

## Run from source

The app runs from source on Windows, macOS, and Linux:

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
- The built-in player opens in a separate reusable window with playback, seeking, volume, captions, quality, picture-in-picture, and native fullscreen controls. Video keeps its aspect ratio with black bars filling the remaining window area.
- Volume, mute, playback speed, caption visibility/language, and episode resume positions are saved locally. Positions use provider episode IDs and audio mode, so refreshed stream URLs resume correctly.
- Built-in episodes are recorded as started on opening and completed when playback reaches the end. Continue resumes an unfinished episode; completed episodes advance to the next one. Existing history retains its previous completed interpretation. External-player completion remains untracked and uses the existing launch-based history behavior.
- Clearing history also clears resume positions. Bookmarks, source links, preferred quality, audio mode, and theme are stored locally.
- Settings control the playback target, instant fullscreen, external fallback path, provider addresses, and theme.

The player listens for shortcuts immediately after opening. Text fields, sliders, and menus keep their own keyboard navigation. **?** or **Help → Keyboard Shortcuts** opens the shortcut reference; **Playback** contains native menu commands. On Linux, Alt reveals the hidden menu bar.

| Shortcut | Action |
| --- | --- |
| Space / K | Play or pause |
| Left / Right / J / L | Seek 10 seconds |
| Shift + Left / Right | Seek 20 seconds |
| Up / Down | Adjust volume |
| M | Mute |
| C | Toggle captions |
| < / > | Change speed in 0.25× steps |
| 0–9 | Seek to 0–90% |
| I | Picture in picture |
| F / double-click | Native fullscreen |
| Ctrl+Cmd+F (macOS), F11 (Linux/Windows) | Native fullscreen |
| Escape | Close an open menu first, then leave fullscreen |
| Tab / Shift+Tab | Move between controls |

The startup fullscreen preference applies when creating the player window. Selecting another episode preserves the current window mode. Fullscreen follows confirmed window-manager events and ignores repeated toggles during a transition. A failed transition displays a dismissible notice while playback continues.

On Windows, the app disables Chromium's DirectComposition surface and video-overlay paths at startup to prevent audio-only black frames when moving between the mini player, expanded player, and fullscreen. Other GPU acceleration and hardware decoding remain enabled. The mitigation takes effect after restarting the app and does not change macOS or Linux behavior.

For troubleshooting, turn **Settings → player diagnostics → on**, then save. This takes effect in an open player immediately and stays enabled across restarts until you turn it off and save. **Open logs** opens the local log folder. Logging is off by default.

`media-player.jsonl` contains timestamped JSON records grouped by playback session: the active rendering policy, key down/up, modifiers, repeats, focused control, whether the key's default action was prevented, seek requests and results, playback/buffering, volume, speed, track/quality changes, errors, native fullscreen, window size/focus, and renderer failures. Keyboard records include the input timestamp (`inputTime`, milliseconds since the Unix epoch) and playback position so they can be correlated with resulting media events. A prevented key alone does not prove that a seek succeeded; check the subsequent `seeked` record.

Logs live in the app's user-data `logs` folder. The single `media-player.jsonl` file retains the latest **five minutes** of events, with cleanup once per second while the app is open, including when diagnostics are turned off. Startup and **Open logs** also trim expired entries. Time-based retention replaces the size limit and backup rotation; any existing backup is merged into the five-minute window and removed. Files left while the app is closed are trimmed at the next launch. Log writing runs asynchronously with a bounded queue; a `dropped` count identifies records omitted under heavy load. Text-field/composition input, stream URLs, titles, and arbitrary error messages are excluded. Nothing is uploaded. To report an issue, enable diagnostics, reproduce it, then promptly copy the log file before those events expire.

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

The real-player integration suite needs `ffmpeg` on PATH. It generates silent HLS fixtures in a temporary directory and uses an isolated Electron profile, leaving personal history untouched:

```sh
npm run test:player
npm run test:player:native
```

The first command tests actual Vidstack controls, HLS loading under the production CSP, captions, transient network recovery, resume across URL changes, and measured black bars. The second also opens a window and tests native fullscreen, window geometry, and application menus. CI configures macOS plus Linux X11/Openbox and Wayland/Weston runs. Compositor, multiple-display, and hardware media-key behavior should also be checked on the target desktop.

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

## Linux package

```sh
npm run dist:linux
```

The AppImage is written to `release/`. Linux runs through Electron on X11 or Wayland. For display-specific testing, pass `--ozone-platform=x11` or `--ozone-platform=wayland` to Electron.

## GitHub releases

Set the package version, commit it, and push the matching tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The desktop release workflow tests the app and attaches a Windows x64 installer, Linux x64 AppImage, and Intel and Apple Silicon macOS DMGs to the tag's GitHub Release. macOS signing and notarization can be added later.

Vidstack loads the bundled hls.js module directly, so the player requires no CDN script permission. Vidstack and hls.js are bundled JavaScript dependencies; no native player executable or streamed media is included. See [Third-party notices](THIRD_PARTY_NOTICES.md).

## Security boundary

Both renderers use `contextIsolation`, disable Node integration, and communicate through narrow preload APIs. The video window uses a separate nonpersistent session for HLS requests, referrer handling, and scoped CORS response headers. Navigation, popups, and permission requests are blocked. Source requests and process launching remain in the main process; remote streaming pages are never loaded as application UI.
