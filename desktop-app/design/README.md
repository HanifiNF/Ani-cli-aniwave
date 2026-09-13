# ANIdesktop design notes

## Current design: atsu style (September 2026)

The renderer follows atsu.moe. The components in `../src/` are the current UI reference.

- One centred column, 1120px wide (`--container`), shared by the top bar and the page. Gutters grow on wide windows.
- Top bar: wordmark, a centred search pill (⌘K or / focuses it), then home, saved, recent, and settings icons. The bar
  carries nothing about playback: the corner player is the way back to the full player (its expand button or the
  backtick).
- Home: "Continue watching" and "Saved" as poster-card rows, eight across (six in narrower windows), with a next-episode badge and the audio mode.
  Arrow keys move between cards and rows, up and down also cross sections, Enter plays, o opens,
  x removes.
- Search: typing in the pill opens a palette over the page with a result count, and thumbnail rows
  carrying artwork and alternate titles. Up and down move, Enter opens, Escape clears and closes.
- Series: a sticky left panel with the poster, Play next, Save, and audio and quality chips. The right column has the
  title, source tags, a facts strip, then the episode list with All / Unwatched / Watched chips, a jump box, and sort
  arrows (newest first by default). Episodes are grouped by number with one row per provider. Each row shows the best
  quality that source offers, resolved lazily as rows scroll into view and cached in the app’s metadata store; the checkbox
  records progress through that episode on that provider.
- Sources are resolved together. Search unifies provider records that share an alias or clearly name the same season
  of one franchise (`unifyAnimeResults`). Opening a series looks it up on every provider it is not yet known on
  (`CatalogService.resolve` in `electron/catalog-service.ts`, searched by title and aliases) while the known sources load; confident
  matches (a shared alias) are remembered as provider links and their episodes join the grouped list as they arrive.
  A result never holds two records from one provider, even through a link, so links cannot chain seasons together.
  Links also flow into the library: linking attaches the records to every saved or recent entry for that anime, and a
  play request recorded from one source keeps the sources the entry already had, so continuing from the home page,
  saved, recent, or the player's "episodes" action reopens the series with every known source before any lookup.
  The search scope is every source enabled in Settings. Settings also offers "forget
  source links" for when a series shows the wrong records together. The manual "merge" action remains for anything
  the matcher misses.
- Saved and recent: full card grids filtered by the pill. Settings: grouped cards. The Sources group is one row per
  provider: a status dot with the name and a one-line state on the left, the address in a fixed middle column, and a
  single Check now / Retry button and an on/off switch on the right. A source that is off dims and is left out of search, lookup, and episode loading.
  The theme picker is a row of preview tiles, one per preset plus custom, each drawn in its own background, text,
  and highlight colours; custom adds a row of colour swatches with editable hex values.
  Yes/no settings (start fullscreen, autoplay, diagnostics) are switches; chips are reserved for choices between
  named options (player, quality, audio, preferred source). The cancel/save row sticks to the bottom of the scrolling
  form and save is disabled until something changes. The key-hint footer is gone; `?`
  shows a hint pill.
- Type is the system sans-serif (Inter when installed); Fragment Mono is no longer bundled. Themes are unchanged.

## Capture the current UI

From `desktop-app/`, start `npx vite --host 127.0.0.1`, then run:

```sh
env -u ELECTRON_RUN_AS_NODE npx electron design/capture-app.cjs
```

The capture tool uses the in-memory development API. Generated screenshots go to `design/shots/`, which is ignored by Git.
Use `SHOT_WIDTH`, `SHOT_HEIGHT`, and `SHOT_SUFFIX` for other window sizes, or pass the development server URL as the first argument.

`design/capture-motion.cjs` works the same way but saves frame bursts (`design/shots/motion/`) around the moments that animate:
the home grid, the search palette, opening a series, the playback status, and docking or expanding the player.
