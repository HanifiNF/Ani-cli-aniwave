# Ani Desktop design notes

## Current design: atsu style (September 2026)

The renderer now follows atsu.moe. `atsu.html` holds the mockups; `shots/atsu-*.png` are the mockup captures and
`shots/app-*.png` are captures of the live renderer (`capture-app.cjs`, run against `npx vite`).

- One centred column, 1120px wide (`--container`), shared by the top bar and the page. Gutters grow on wide windows.
- Top bar: wordmark, a centred search pill (⌘K or / focuses it), then home, saved, recent, and settings icons. The bar
  carries nothing about playback: the corner player is the way back to the full player (its expand button or the
  backtick).
- Home: "Continue watching" and "Saved" as poster-card rows, eight across, with a next-episode badge, the audio mode,
  and a progress line on the poster. Arrow keys move between cards, up and down switch sections, Enter plays, o opens,
  x removes.
- Search: typing in the pill opens a palette over the page with source chips, a result count, and thumbnail rows
  carrying a provider ribbon. Up and down move, Enter opens, Escape clears and closes.
- Series: a sticky left panel with the poster, Play next, Save, and audio and quality chips. The right column has the
  title, source tags, a facts strip, then the episode list with All / Unwatched / Watched chips, a jump box, and sort
  arrows (newest first by default). Episodes are grouped by number with one row per provider. Each row shows the best
  quality that source offers, resolved lazily as rows scroll into view and cached in local storage; the checkbox
  records progress through that episode on that provider.
- Sources are resolved together. Search unifies provider records that share an alias or clearly name the same season
  of one franchise (`unifyAnimeResults`). Opening a series looks it up on every provider it is not yet known on
  (`resolveSources` in `electron/scraper.ts`, searched by title and aliases) while the known sources load; confident
  matches (a shared alias) are remembered as provider links and their episodes join the grouped list as they arrive.
  A result never holds two records from one provider, even through a link, so links cannot chain seasons together.
  Links also flow into the library: linking attaches the records to every saved or recent entry for that anime, and a
  play request recorded from one source keeps the sources the entry already had, so continuing from the home page,
  saved, recent, or the player's "episodes" action reopens the series with every known source before any lookup.
  The search palette has no source control; the search scope is the Source setting. Settings also offers "forget
  source links" for when a series shows the wrong records together. The manual "merge" action remains for anything
  the matcher misses.
- Saved and recent: full card grids filtered by the pill. Settings: grouped cards. The key-hint footer is gone; `?`
  shows a hint pill.
- Type is the system sans-serif (Inter when installed); Fragment Mono is no longer bundled. Themes are unchanged.

## Previous design: B2 Palette with art guide

## Purpose

Ani Desktop searches anime titles, selects episodes, and opens streams in mpv, VLC, or IINA.
The design takes its cues from ani-cli's terminal menus, with keyboard navigation and visible mouse controls.

## Visual design

- Fragment Mono provides the type hierarchy: 22px titles, 14px rows, and 12px hints.
- The graphite preset uses background #1F2023, text #EDEDEE, and highlight #EDEDEE.
- Each theme defines background, text, and highlight. The renderer derives surfaces, rules, and muted text
  using `color-mix` in oklab. Scrollbars and artwork borders follow the selected theme.
- Cover art appears in title rows at 40 by 56 pixels and in the series header at 112 by 158 pixels.
  Soft shadows give the covers depth. The `posters/` illustrations are stand-ins for reference screens;
  the app uses posters supplied by its providers.

## Layout and interaction

- A search field and audio, quality, and source controls sit above the content. Navigation stays in the footer.
- Search results occupy the larger left panel. Continue and saved form a compact stack on the right,
  with the first three titles in each section. Lists scroll independently when space is limited.
- Saved and recent pages expose the full library with filtering and removal controls.
- Clicking an episode resolves a stream and opens the external player. Watched episodes are dimmed,
  and playback status and errors appear below the episode grid.
- Settings provides player configuration, playback defaults, provider addresses, and theme selection.

## Themes

Presets are graphite, paper, nord, gruvbox, mocha, and solarized light. Custom themes expose background,
text, and highlight as colour pickers and hex fields. Settings previews changes immediately; saving persists them.
The app applies the resolved colours through root CSS variables in `src/App.tsx` and `src/styles.css`.
Preset definitions live in `shared/theme.ts`.

## Reference screens

`b2-palette-art.html` records the original selected design. `index.html` links to its screens and themes;
`shots/` contains captured previews. The React renderer includes subsequent layout and interaction refinements.

Regenerate the reference previews from `desktop-app/`:

```sh
env -u ELECTRON_RUN_AS_NODE npx electron design/variants/capture.cjs
```

## Built-in player inside the main window

`player-in-window.html` explores folding the built-in player into the main window instead of a second
BrowserWindow. Both layouts keep the B2 system: one line of context in Fragment Mono, chips and quiet
text buttons, key hints in the footer, and the three theme colours.

- **A1, player takes the page.** The video fills the page area edge to edge. Above it one line shows the
  title, "episode n of m", and the stream detail, with prev, next, and episodes on the right. Escape returns
  to the series grid with the cursor on the current episode. When an episode ends the next one is announced
  in the video area with a short countdown; Enter plays now and Escape stays. Native fullscreen shows only
  the video, with the title fading in alongside the controls.
- **A2, video above the grid.** No new screen. The series header collapses to a single row with a small
  cover, a fixed-height video panel sits under it, and the source bar and episode grid follow. Tab moves
  focus between the video and the grid. The panel is pillarboxed at the default window size, which is
  the trade-off for keeping the grid in view.

The video surface is always black. Vidstack's controls take the theme's highlight colour. A dark highlight,
such as paper's, would vanish on black, so the renderer falls back to white for the player controls
(`videoBrand` in `shared/theme.ts`).

Capture these previews with `env -u ELECTRON_RUN_AS_NODE npx electron design/variants/capture.cjs player-in-window mocha,paper`.

### Mini player while browsing

`#mini-home`, `#mini-series`, and `#mini-ended` show the player docked in the bottom right corner while the
user searches, opens another series, or filters saved titles. Escape on the player screen docks it instead
of stopping. The mini player is a third of the window wide, sits above the footer, and shows the video with
a bar beneath: title, "episode n of m" with the time, play or pause, expand, and close. Clicking the video,
the expand control, or the footer's "now playing" link (backtick) returns to the full player. Close ends
the session. Lists scroll under the corner. The ended countdown runs at the smaller size, so autoplay next
continues while docked. Playback keys work only on the full player screen; while docked the app keys
belong to the lists again. The bar is a drag handle: release snaps the player to the nearest of the four
corners so nothing stays covered, and the corner is remembered across sessions (`#mini-moved`).
Implemented in `src/PlayerScreen.tsx` (docked mode) and `src/App.tsx`; the corner and width live in settings.
The box resizes from a grip at its inner corner or with ⌘+ and ⌘−, between 240px and the body width.
