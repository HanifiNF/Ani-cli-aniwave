# ANIdesktop technical guide

See the [main README](../README.md) for the app overview, screenshots, and getting started. This guide covers desktop configuration, development, and troubleshooting.

ANIdesktop is an Electron desktop client built on the ani-cli v5 workflow. It supports AniWave/Vidplay, AniDB, and HiAnime, with automatic source selection. HLS video plays in a built-in Vidstack screen on Windows, macOS, and Linux; mpv, VLC, and IINA remain optional external fallbacks. The React renderer has no direct Node.js access.

## Creator photos

The footer looks for square creator photos at `public/creators/hanifi.webp` and `public/creators/pascal.webp`. It shows each creator's initial when a photo is absent. Add an optimized square WebP image at either path to replace that fallback without changing the component; JPEG files may also be used after updating the corresponding filename in `src/creators.ts`.

## Custom watch companions

Open **Settings → Appearance → Watch companion**, enter a name, then choose **Import image**. Use a transparent PNG or WebP spritesheet no larger than 8 MB, exactly **1536 × 1872 pixels**. The sheet has 8 columns and 9 rows; each cell is **192 × 208 pixels**. Frames run left to right. The three bundled sheets in `public/pets/` are examples.

| Row (top to bottom) | Animation | Frames |
| --- | --- | ---: |
| 1 | Idle | 6 |
| 2 | Run right | 8 |
| 3 | Run left | 8 |
| 4 | Wave | 4 |
| 5 | Jump | 5 |
| 6 | Failed | 8 |
| 7 | Waiting | 6 |
| 8 | Working | 6 |
| 9 | Review | 6 |

Keep unused cells transparent. ANIdesktop checks the image dimensions and decoding before copying it into app data. Up to 20 custom companions can be stored, selected, or removed; removing one never alters your original file. Imports are local to that computer, so share the original PNG/WebP with a friend who wants the same companion. Imported companions use the app's existing preset speech. If an image fails to import, check its file type, size, dimensions, and whether it opens in another image viewer.

Drag the companion within the app content to set its home, or focus it and use the arrow keys (Shift for larger steps). It occasionally walks nearby and returns home. **Companion size** (50–200%), **Reset position**, and **Allow wandering** are in the same Settings group. Reduced-motion mode prevents wandering and frame animation. The companion comments when you open an anime or visit an app section; on startup it can announce unread episode updates and offer to reopen your most recently watched anime without autoplay.

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

- Catalog search checks AniWave, AniDB, and HiAnime concurrently and shows one row per anime as each provider responds. Records are grouped by identity rather than by provider: a shared MyAnimeList or AniList id, a remembered work, a shared title or alias, or, as a last resort, the same season of the same title when no stated fact (format, year, episode count) disagrees. A provider's censored and uncensored copies of one anime share the row. Each row carries a chip per source; a row grouped by title alone says so. Results keep season, part, and special names visible. The preferred source setting controls playback selection.
- Browse uses AniList to show 24 catalog titles at a time with genre, year, season, status, format, score, episode-count, and sorting filters. All selected genres are applied by AniList before pagination. Genres sit in the open as chips: one click includes a genre, a second excludes it, a third clears it; the other filters wait behind a "Filters" disclosure and show as removable tokens once set. Every change applies at once (typed fields after a short pause), pages are cached, "Show more" appends the next page under the grid, and streaming providers are searched only after a title is opened. The minimum score is entered out of ten, as cards show it, and an invalid field is marked and held back until it is fixed. When nothing matches, the page offers one removal per active filter. A search field under the heading narrows the same page: an empty field is the catalog, and a term combines with every chip and filter. It searches AniList by title (English, romaji, native, and synonyms; two characters at least, after a 600 ms pause, best match first) and offers matching studios under the field in the same request, animation studios ahead of producers. Taking a studio puts it in the field as a token and lists its anime; the field then searches titles within it. AniList cannot filter a studio's own list, so the app reads that list once as ids (25 a request, kept for a week, resumed if interrupted, the most popular works shown meanwhile) and hands them to the ordinary catalog query, which keeps genres, tags, filters, sorting, and paging exact. The Filters panel adds a type-ahead field for AniList's tags. Arrow keys travel from the field to the studio suggestions to the cards; Escape walks back up and clears the term before anything else. A search without matches can hand its words to the source search on Home. "Newest release" lists dated titles, and released ones unless a status is chosen. Opening reuses confident remembered source links and discovers missing sources using up to five distinct complete aliases per enabled provider (three initial attempts and two fallbacks). It prioritises the displayed title, labelled English/romaji names, primary titles from exact-ID offline-index matches when enabled, and Latin-script synonyms, retaining native spellings as candidates. One main-process operation owns a 20-second discovery deadline and a maximum of ten HTTP search attempts per source including retries; opening the resulting series reuses that completed discovery. Failed or rate-limited sources stop their alias attempts while healthy sources continue. Discovery uses the known catalogue identity directly, with no additional AniList title searches. Index aliases are retrieval hints; returned records must still match the original catalogue identity. A shared id settles a match even when catalogues disagree on year or format; without one, titles decide under the shared fact rules, and conflicting identities and ambiguous matches remain unresolved. The opened series keeps the entry's ids, so its information and remembered work name the entry that was clicked. While sources are checked the clicked card reports it in the grid (Escape or a second click cancels), and a match opens the series directly. A catalog title with no matching provider remains visible as information, with a retry and a manual search, without being added to history.
- Every anime the app groups becomes a *work*: an app-owned identity that holds the external ids and the provider records bound to it. Bookmarks, history, and caches follow the work, so a provider can disappear or be replaced without losing what you watched. Confident groupings from search and the cross-source lookup that runs when a series opens are remembered automatically. On a series page, each source tag has a split control for a record that does not belong; the split pair is never grouped again by title. **Forget links** in Settings resets every work.
- Series pages show information for the work: format and season, airing status with the next episode date, studio, score, a synopsis, and genres. It comes from AniList, looked up by the work's ids or, for a work without ids yet, by its titles, and is cached locally: a finished series is fetched once and refreshed after about ninety days, an airing one after a day, or on **Refresh info**. Episode counts and lists always come from the streaming sources. Library entries saved before this existed learn their ids in a slow background pass shortly after start, a few at a time. The AniList switch in Settings turns these requests off; cached information and provider-scraped genres remain. An optional offline title index (a local copy of the anime-offline-database, about six megabytes, refreshed weekly) lets search group titles across sources without any request.
- Home shows the current seasonal schedule below Saved as a poster-card grid. It opens on today in a rolling seven-day strip (two days back, today, four days ahead), which shifts at local midnight. For each selected local day, the app requests the overlapping UTC dates from AniWave and groups releases locally, preserving overnight releases and daylight-saving boundaries. Neighboring tabs share cached UTC responses. This also covers days the site's own schedule tabs no longer list. It supports SUB/DUB, orders AniWave's estimated releases by local time, shows a countdown and one line of genre chips per card (with a "+n" chip for any that do not fit), and dims entries that have not aired yet while leaving aired ones at full brightness. AniWave must be enabled for live schedule updates; cached rows remain visible with a stale notice during an outage.
- Open a series to see episodes grouped by number, with provider sources underneath. Click an episode to play, use the sidebar to save or mark watched, and use **Jump to** to find an episode. This page uses mouse controls with standard Tab focus, without custom keyboard shortcuts or a selection highlight. Known and newly discovered sources populate independently, preserving scroll position.
- Supported sub/dub availability loads before full stream resolution. Audio labels describe provider-listed availability; playback verifies the host. Visible rows reuse cached quality badges. Video-host quality checks run during playback or an explicit metadata refresh, rather than automatically when opening or scrolling a series. Failed checks offer **Retry info**.
- **Refresh sources** refreshes cached data while respecting paused services. Cached episode lists remain visible if a refresh fails, alongside the provider error. **Check now**, **Retry search**, and **Retry info** permit a controlled recovery check.
- The built-in player occupies the main window, with playback, seeking, volume, captions, quality, picture-in-picture, and native fullscreen controls. Escape docks it into a resizable corner player while you browse; click it to expand it again, or use backtick while browsing the library or search results. Video keeps its aspect ratio with black bars filling the remaining player area.
- Volume, mute, playback speed, caption visibility/language, and episode resume positions are saved locally. Positions use provider episode IDs and audio mode, so refreshed stream URLs resume correctly.
- Built-in episodes are recorded as started on opening and completed when playback reaches the end. Continue resumes an unfinished episode; completed episodes advance to the next one. Existing history retains its previous completed interpretation. External-player completion remains untracked and uses the existing launch-based history behavior.
- Clearing history also clears resume positions. Bookmarks, works and their source bindings, preferred quality, audio mode, and theme are stored locally.
- Settings control the playback target, instant fullscreen, external fallback path, provider addresses, and theme.
- Each source in Settings has a switch. A source that is off is left out of search, cross-provider lookup, and episode loading; at least one must stay on, and a preferred source that is switched off falls back to auto. Settings also shows each source's recent reachability, last check time, and retry delay. **Check now** or **Retry** checks that source through the existing outage protection. Opening Settings only reads local status; checks stop when you leave. Save address edits before checking them. HiAnime status follows its catalog API, and playback hosts retain separate outage tracking.

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

The startup fullscreen preference applies when starting a fresh built-in playback session in the main window. Selecting another episode preserves the current window mode. Fullscreen follows confirmed window-manager events and ignores repeated toggles during a transition. A failed transition displays a dismissible notice while playback continues.

On Windows, the app disables Chromium's DirectComposition surface and video-overlay paths at startup to prevent audio-only black frames when moving between the mini player, expanded player, and fullscreen. Other GPU acceleration and hardware decoding remain enabled. The mitigation takes effect after restarting the app and does not change macOS or Linux behavior.

For troubleshooting, turn **Settings → player diagnostics → on**, then save. This takes effect in an open player immediately and stays enabled across restarts until you turn it off and save. **Open logs** opens the local log folder. Logging is off by default.

`media-player.jsonl` contains timestamped JSON records grouped by playback session: the active rendering policy, key down/up, modifiers, repeats, focused control, whether the key's default action was prevented, seek requests and results, playback/buffering, volume, speed, track/quality changes, errors, native fullscreen, window size/focus, and renderer failures. Keyboard records include the input timestamp (`inputTime`, milliseconds since the Unix epoch) and playback position so they can be correlated with resulting media events. A prevented key alone does not prove that a seek succeeded; check the subsequent `seeked` record.

Logs live in the app's user-data `logs` folder. The single `media-player.jsonl` file retains the latest **five minutes** of events, with cleanup once per second while the app is open, including when diagnostics are turned off. Startup and **Open logs** also trim expired entries. Time-based retention replaces the size limit and backup rotation; any existing backup is merged into the five-minute window and removed. Files left while the app is closed are trimmed at the next launch. Log writing runs asynchronously with a bounded queue; a `dropped` count identifies records omitted under heavy load. Text-field/composition input, stream URLs, titles, and arbitrary error messages are excluded. Nothing is uploaded. To report an issue, enable diagnostics, reproduce it, then promptly copy the log file before those events expire.

If the built-in player reports a fatal error, use **Retry** to resolve a fresh stream URL for the episode. **Open in external player** is enabled when an external-player path is configured and is never triggered automatically.

## Optional external players

Choose **Settings → Playback → external**, or keep built-in playback selected and use the fallback button. The fullscreen/windowed preference applies to both targets.

For IINA on macOS, set the external path to:

```text
/Applications/IINA.app/Contents/MacOS/iina-cli
```

The app supplies the HLS format, referrer, media title, and fullscreen options required by IINA. Equivalent supported arguments are supplied to mpv and VLC.

## Themes and icons

Theme presets and custom colours control the interface and running app icon. Builds generate a graphite PNG, multi-size Windows ICO, and Retina-ready macOS ICNS from `../app-icon.svg`.

## Catalog loading

Works live in `state.json` alongside the library, capped at 5,000 with the oldest unreferenced works dropped first; works the library refers to are never dropped. Series information sits in `work-info.json`, keyed by MyAnimeList id, up to 5,000 works, kept indefinitely and refreshed by age as described above; AniList search answers used for grouping are kept there for a day. AniList requests honour the rate limit stated in its response headers and pause before reaching it. The offline title index, when enabled, is downloaded from the anime-offline-database releases to `title-index.json` and refreshed weekly at startup.

The Electron main process shares in-flight HTTP requests and caches their response bodies in memory (up to 1,000 entries and 32 MB). Search and server availability responses remain fresh for 60 seconds, episode-list responses for 30 seconds, and source/playlist responses for 20 seconds. Response-body caches reset when the app exits. Parsed episode catalogs persist in `episode-lists.json` for up to seven days and remain visible while providers refresh. That cache holds at most 200 provider catalogs and 20,000 episodes; invalid or expired saved entries are discarded on load.

Background traffic is limited to five active requests overall and two per service origin. Playback can use a reserved sixth slot and a third request to a service. Queued playback requests take priority. Cancellation releases an individual consumer; shared upstream work stops only when its last consumer leaves.

Network errors, timeouts, HTTP 429, and HTTP 5xx failures pause the affected service. Repeated failed recovery checks increase the pause from 30 seconds to 2 minutes, 5 minutes, then 15 minutes. After the pause, the next needed request acts as the sole recovery probe; other requests to that service fail promptly or use fresh cached responses. Probes make one HTTP attempt. Healthy services remain available, and a failing video host is tracked independently from its catalog provider. Missing records, unavailable audio, and user cancellations do not count as service outages. Concurrent results from before a pause cannot clear it or repeatedly increase its backoff.

Explicit retry actions may request one early check per service, shared by downstream lookups. Bulk refresh preserves outage protection. A server's `Retry-After` delay takes precedence, including for manual checks. Successful recovery resets the backoff. There is no idle polling: recovery checks run when data is next needed.

Outage counters and next-check times are saved atomically to `source-health.json` in Electron's user-data directory, with a limit of 100 service origins. They survive restarts and expire after 24 hours without a failure once the cooldown has elapsed. Cache refreshes and unrelated source-setting changes preserve this history; a different service address has separate health. Damaged health files are rebuilt automatically.

Episode audio availability and best resolution are saved to `episode-metadata.json` in Electron's user-data directory, keyed by source configuration and provider episode ID, with separate sub/dub resolutions. Successful resolutions and complete audio availability remain fresh for 24 hours. Missing audio or resolution is checked again after 15 minutes, so newly added versions can appear sooner. Fresh metadata restores without provider requests; expired metadata remains visible during viewport-driven refresh, including when a provider fails. Entries expire entirely after seven days, with a limit of 5,000 episodes. Writes are batched and atomic, and a damaged cache is rebuilt automatically.

The renderer holds up to 1,000 completed metadata entries and pauses failed lookups for 10 seconds. Work stops when rows leave the active view. **Refresh sources** clears metadata for the current series across both audio modes and forces new requests; **Retry info** forces another lookup for that row. Playback resolutions also update the metadata cache. Playable URLs continue using the short-lived memory cache and are resolved separately when playback starts.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Run the production Browse flow with fixture HTTP responses and an isolated Electron profile:

```sh
npm run test:browse
```

This checks cold alias discovery, episode loading, saved links, the offline-index setting, the IPC bridge, and cancellation. Unit tests also cover fallback limits, HTTP retries, the overall deadline, conflicting identities, ambiguous results, and unavailable sources.

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

On macOS, build Intel and Apple Silicon DMGs and update ZIPs with:

```sh
npm run dist:mac
```

The DMGs are written to `release/`. Apps use ad-hoc signing (`mac.identity: "-"`), with Electron's default hardened-runtime entitlements. The build mounts each completed DMG and verifies the app's signature, nested code, and CPU architecture before succeeding. Setting `identity` to `null` skips signing and can leave an invalid Electron signature after packaging.

These builds are unnotarized. A downloaded build may be blocked on first launch; after attempting to open it, a trusted user can approve it with **System Settings → Privacy & Security → Open Anyway**. Developer ID signing and Apple notarization are required for distribution that passes Gatekeeper without an override. The original `v0.1.0` Mac packages contain an invalid signature; install a newer build if macOS reports that version as damaged.

## Linux package

```sh
npm run dist:linux
```

The AppImage is written to `release/`. Linux runs through Electron on X11 or Wayland. For display-specific testing, pass `--ozone-platform=x11` or `--ozone-platform=wayland` to Electron.

## GitHub releases

The desktop release workflow runs nightly at 2:17 AM Brisbane time (16:17 UTC). It compares the scheduled `master` commit with the most recently published stable `vMAJOR.MINOR.PATCH` release. If the commit is already included in that release, packaging and publication are skipped. All changes count, including documentation changes. Drafts and prereleases are excluded from the comparison, so failed or missed releases remain eligible on the following night. GitHub schedules run on the repository's default branch, which must remain `master`, and execution can be delayed by GitHub.

When changes exist, the workflow runs the unit, build, and native player checks alongside builds of a Windows x64 installer, Linux x64 AppImage, and Intel and Apple Silicon macOS DMGs. Once all checks and packages succeed, it creates a version tag on the exact built commit and publishes the packages with generated release notes. Desktop checks also run independently on pull requests and branch pushes, including merges into `master`, when desktop code or workflow files change.

The first release uses the version in `package.json` (currently `0.1.0`). Each subsequent release increments the highest stable `vMAJOR.MINOR.PATCH` tag's patch number: `0.1.1`, `0.1.2`, and so on. To start a larger release, update the package and lockfile to a version above the latest release, then commit those files in your pull request:

```sh
cd desktop-app
npm version 0.2.0 --no-git-tag-version
```

The release version is applied to the package and lockfile in the build workspace. The workflow creates tags and releases using GitHub's built-in token; it creates no version-bump commits. The checked-in package version serves as the minimum version for future releases, so source checkouts can show an older version than downloaded packages.

Packaged apps check the repository's latest stable GitHub Release shortly after every opening (a launch, or on macOS a new window after the last one closed), then at most once every 24 hours while they stay open. An available version appears only in Settings: a link beside the Settings heading jumps to the Updates row, and a small dot marks the settings icon and the Updates entry in the rail. **Download update** downloads the matching release package; **View release** opens GitHub for release notes or manual installation; **skip this version** clears the dots and the link until the next release. Downloads begin when requested. On packaged Windows x64 installs and Linux x64 AppImages, a completed download offers **Install and restart**. Updates are applied only through that action; ordinary app shutdown leaves a downloaded update pending. Sparkle-enabled macOS builds offer **Install update…**, opening a native window that downloads, verifies, installs, and restarts the app. Builds without a configured Sparkle public key offer a matching DMG for manual replacement. Linux builds running outside an AppImage download the matching AppImage and reveal it for manual replacement. Download progress and failures appear in Settings, or in Sparkle’s native window on enabled macOS builds. Downloads continue when navigating to another screen. Results and per-version dismissals are stored in `update-check.json` in the app's user-data directory. Automatic checks are disabled while running from source, and **Check now** bypasses the daily throttle.

### Update installation requirements

The GitHub publish configuration embeds `app-update.yml` in packaged apps. Release builds also publish `latest.yml` for Windows, `latest-linux.yml` for Linux, and generated blockmaps alongside the installers. These files include the checksums that `electron-updater` verifies before installation. Existing releases lack this update flow; users must install the first release containing it manually, then use it for later releases. Source runs continue to offer release checks and links, with installation disabled.

- **Windows:** the NSIS installer supports update and relaunch. Per-machine installs may ask for administrator permission. The current builds have no Windows publisher certificate, so Windows may show an unknown-publisher or SmartScreen prompt. Adding Authenticode signing later also enables publisher identity verification by the updater.
- **Linux:** automatic replacement requires running the actual AppImage with `APPIMAGE` set and a writable file and containing directory. Move a system-owned or read-only AppImage to a user-writable folder and relaunch it before updating. Extracted apps use the manual download fallback. Only x64 Linux packages are currently published.
- **macOS:** Sparkle verifies signed update feeds and ZIP archives with the project's Ed25519 public key, then installs and restarts through its native window. It works with the existing ad-hoc signing and requires no Apple membership. Install the first Sparkle-enabled release manually into Applications. First-launch Gatekeeper approval still applies to these unnotarized builds. Configure `SPARKLE_PRIVATE_KEY` as an Actions secret and `SPARKLE_PUBLIC_KEY` as a repository variable using the [Sparkle release setup guide](docs/sparkle-release-setup.md). Builds without the public key retain the DMG fallback.

References: [electron-builder updater requirements](https://www.electron.build/v26/docs/features/auto-update/), [macOS notarization](https://www.electron.build/v26/docs/notarization/), and [Sparkle signing](https://sparkle-project.org/documentation/).

Release runs queue one at a time (up to GitHub's 100 pending-run limit). Failed checks or package builds prevent publication. Uploads stay in a draft until all files are attached. Retrying a tagged commit reuses its version and preserves an already published release. If a failed run's version was claimed by a later commit, choose **Re-run all jobs** to select a fresh version.

To test packages from a branch, open **Actions → Desktop release → Run workflow**, select the branch, and leave **Release action** set to **Test packages**. This runs the same checks and builds and saves the packages as workflow artifacts, even when the commit was already released. To publish an urgent release, select `master` and choose **Publish release**. Manual publication uses the same unreleased-change check as nightly runs; publishing from another branch is rejected. macOS packages currently use ad-hoc signing; Developer ID signing and notarization can be added later.

Vidstack loads the bundled hls.js module directly, so the player requires no CDN script permission. Vidstack and hls.js are bundled JavaScript dependencies; no native player executable or streamed media is included. See [Third-party notices](THIRD_PARTY_NOTICES.md).

## Security boundary

The main window uses `contextIsolation`, disables Node integration, and communicates through a narrow preload API. Browsing and built-in playback share the `ani-desktop` nonpersistent Electron session. Referrer and CORS header adjustments apply to media/XHR traffic; poster and page requests retain their headers. Navigation, popups, and permission requests are blocked. Source requests and process launching remain in the main process; remote streaming pages are never loaded as application UI.

## Code layout

- `src/App.tsx` coordinates navigation, library state, series loading, and playback requests. `SettingsScreen`, `SeriesScreen`, `SearchPalette`, and `LibrarySection` render their respective views. `usePlayerSession` owns the native session subscription; `useAnimeSearch` and `useEpisodeMetadata` own their request lifecycles.
- `src/episodes.ts` and `src/library.ts` contain episode ordering, progress selection, and library models. `src/theme.ts` applies the active theme; `src/errors.ts` normalizes renderer-facing errors.
- `shared/settings.ts` defines defaults, playback quality choices, and catalog/source configuration keys. `shared/identity.ts` holds title normalisation, season markers, fact vetoes, and reference helpers; `shared/catalog.ts` groups provider records into works with them. `shared/player-diagnostics.ts` defines accepted diagnostic events.
- `electron/catalog-service.ts` is the catalog orchestration entry point for the app and smoke checks. `electron/scraper.ts` handles individual provider requests and stream resolution. `electron/anilist.ts` is the AniList client, `electron/work-info-service.ts` the series information cache, and `electron/identity-index.ts` the offline title index. `electron/state.ts` owns works and their bindings.
- Both TypeScript configurations reject unused locals and parameters. Unit tests cover the renderer and services; the player integration scripts exercise actual HLS playback in an isolated profile.

Current UI decisions and instructions for capturing the live renderer are in [design/README.md](design/README.md). Generated design screenshots are ignored by Git and excluded from application packages.

## Episode provider contract

Every episode list goes through `getProviderEpisodes` and the shared `collectEpisodePages` collector. Register each provider in the exhaustive `episodeLoaders` map in `electron/scraper.ts`. A loader yields all available pages and throws on a failed or malformed page. Follow the provider's pagination protocol until completion; embedded previews and announced totals alone do not establish availability. AniWave and AniDB currently return their lists in one response; HiAnime requires its internal anime ID and episode ranges of 100.

The shared collector validates, deduplicates, and sorts the combined episodes. Cancellation, failed pages, and exceeded limits fail the whole load. Only successful complete lists enter `CatalogService`'s episode cache; a failed refresh preserves the previous complete list with an error. Episode counts, including library and schedule metadata, come from that cache or the same loader. Provider metadata supplies genres and announced totals. Playback and continuation consume the resulting catalog.

When adding or changing a provider, extend `tests/episode-loading.test.ts` with its actual response and pagination shape. Cover later-page failure, cancellation, duplicate records, empty catalogs, and the metadata count path. Verify the endpoint against a series with more than one page. Bump the episode cache version if the change invalidates previously cached completeness assumptions.
