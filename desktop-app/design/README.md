# ANIdesktop design notes

## Design language (September 2026)

A quiet, fast tool: motion shows where things come from and where they go, then gets out of the way. The screens below keep
their layouts; this is how they look and move. Mockup: `design/variants/design-language.html` (live, with a spec sheet and
a Feel switch comparing the tunings tried); `design/record-design-language.cjs` records it and `design/record-app-motion.cjs`
records the real renderer, both at true speed.

- Colour: the three theme colours (background, text, highlight) and tones mixed from them in oklab: surfaces 6% and 10%
  text, hairlines 12%, secondary text 60%, faint text 36%. The highlight marks only the primary action, the selection,
  progress, ticks, switches that are on, and the today dot. Status dots keep their own green and red. Flat fills only: raised
  layers get a 12% hairline, never a drop shadow; the scrim is the background at 72%.
- Shape: 10px on cards, posters, panels, and buttons; 8px on small controls (icon buttons, badges, checkboxes, fields,
  keys); pills for the search field and every chip (segmented chips, tags, genres, tokens); circles for dots.
- Type: Inter only (bundled, `@fontsource-variable/inter`), weights 400, 500 and 700, letter spacing −0.005em everywhere.
  Small labels are sentence case at 500, never tracked capitals.
- Icons: one set (`src/icons.tsx`) on a 24px grid with a 1.8 stroke and round caps and joins, drawn at 1.5 screen pixels at
  every size. The full player uses it too (`src/playerIcons.tsx` fills Vidstack's icon slots, at 24px in the bar and 18px
  in menus); seek and replay are one arc with the arrowhead's point on the arc's end, captions on takes the highlight, and
  the shortcuts button is a keyboard instead of "?". The player's menus use the raised surface and hairline. Mockup:
  `design/variants/player-icons.html` (with Vidstack's glyphs beside them, from `player-icons-vidstack.js`).
- Motion (`src/motion.ts`): springs on everything, three presets. Snap (0.25 s, damping 1) moves controls; glide (0.4 s,
  0.95) moves layout and shared elements; stretch moves indicator edges (leading 0.2 s, trailing 0.32 s), so an indicator
  runs ahead and gathers up as it lands. Every spring is launched: a new target from rest starts at distance × ω, so about a
  quarter of the travel lands in the first frame and the rest settles calmly. Shorter springs from rest were tried and
  rejected (they read as sped up); springs from rest felt laggy. A new target mid-flight keeps position and velocity. CSS
  gets the same springs as `linear()` curves (`--t-snap`, `--t-glide`, `--t-out`). Lists rise in turn, 18 ms apart. With
  reduced motion, changes apply at once or as a plain fade.
- Input: chips, tabs, sort toggles, theme tiles, and the nav act on pointer down (keys on click, `src/press.ts`); cards,
  buttons, and tiles dip slightly under the pointer and act on release.
- Continuity: the search pill and the palette are one surface that grows around the results (`src/useSearchMorph.ts`); a
  card's or search row's poster flies to the series poster and back to its card (`src/flight.ts`); the player grows out of
  the Play button, an episode row, or a card, and docking, expanding, and throwing the corner player move one box on the glide
  spring (`src/playerMotion.ts`, PlayerScreen), with its title bars fading while the box is scaled. The corner player follows
  the pointer exactly, stretches with resistance past the window's edges, and flies to the corner it was thrown toward.
- Indicators (`src/useIndicator.ts`): the nav fill, the segmented chips (with a lit copy of the labels clipped to the
  indicator), the settings rail, the episode sort, and the theme ring all move on two edges. Switches have a two-edge knob
  that can be dragged, stretches past either end, and springs from its release speed.
- Back is a return, not a visit: going back from a series lands on the page it was opened from (Home, Saved, Recent,
  Browse, Notifications; the back link names it), with its scroll, filter, backdrop art, schedule day, and keyboard
  cursor as they were, and without the page fade or the cards' rise. Posters already shown this session appear at once
  (`src/Art.tsx`) instead of fading in again.
- Stable layout: nothing appears above content to announce work. Progress, confirmations, and errors float in a status
  pill at the bottom of the page (confirmations pass after 4 s, errors stay until the next action); quick actions whose
  control shows the result (save, ticks, mark all watched, removing a card) say nothing at all. Episode loading is shown
  by skeleton rows only. The series page holds room for the AniList synopsis and facts while they load, the facts sit in a
  steady grid, and Browse fills the screen with ghost cards before its first page.
- Swaps (`src/Swap.tsx`): inner content that changes in place (the Play label, Save, the result count, the save state,
  play/pause) blurs out quickly while the new copy blurs in a beat later. Theme changes glide between the colour sets. The
  bell no longer swings; a new count grows in from the bell's corner.

## Atsu-style screens (September 2026)

The renderer follows atsu.moe. The components in `../src/` are the current UI reference.

- One centred column, 1120px wide (`--container`), shared by the top bar and the page. Gutters grow on wide windows.
- Top bar: wordmark, a centred search pill (⌘K or / focuses it), then home, saved, recent, and settings icons. The bar
  carries nothing about playback: the corner player is the way back to the full player (its expand button or the
  backtick).
- Home: "Continue watching" and "Saved" as poster-card rows, eight across (six in narrower windows), with a next-episode badge and the audio mode. A schedule follows Saved and remains visible when the library is empty: the section head carries the season, the local zone, and plain-text day tabs, each with its day of the month beneath and a dot under today. The tabs are a rolling strip in date order (two days back, today as the third tab, four days ahead), so every weekday has one tab, the two most recent aired days stay in reach, and the rest looks ahead. Each local day is assembled from overlapping UTC date responses from AniWave, so releases crossing local midnight appear on the correct day. The local calendar supplies both midnight boundaries to handle daylight-saving changes. Neighboring tabs reuse cached UTC responses, and a failed response preserves the last complete schedule. The site's own tab strip is not consulted. At local midnight the strip shifts by one day; a selection on today follows to the new today, another day stays selected while the strip still shows it. Mockups: `design/variants/schedule-rollover.html` (L4 chosen); the body is the same poster-card grid, each card (titles reserve two lines on every card so the line beneath and the chips align across a row) showing an episode badge on the poster, then the local air time with a countdown for upcoming entries, "in 3 days" on later days (or "Aired · time" once it has passed; posters that have not aired yet are darkened and desaturated, not faded, while aired ones stay at full brightness because they can be watched), and genre chips on one line: whole chips only, then a "+n" chip for the ones that did not fit (hovering it lists them). A plain-text SUB/DUB switch sits after the tabs behind a hairline; a card opens the series page.
  Arrow keys move between cards and rows, up and down also cross sections, Enter plays, o opens,
  x removes.
- Browse: the heading line carries a quiet "AniList catalog" note and plain-text sort on the right, like the schedule's tabs. Genres follow as three-state chips (off, included and filled, excluded and struck with a minus). A "Filters" word opens a panel of segmented chips (format, status, season) and short typed fields (year, score, episode range); filters in force show beside it as removable tokens, with "Clear all" at the right end. Every change applies at once, typed fields after 400 ms. Cards are the standard card with the score as a badge on the poster, then format · year · episodes and the one-line genre chips (`src/GenreChips.tsx`, shared with the schedule). The foot of the grid says how many titles are shown and offers "Show more" (AniList reports only whether another page exists); a fading ghost row holds the place of a page in flight, and a changed filter dims the old grid until its first page lands. An empty result offers one removal button per active filter. Opening a title checks sources on the card itself (ring, dimmed poster, "checking" badge, the rest of the grid stepped back); a match goes straight to the series, and only a title without a source lands on the detail page. Mockups: `design/variants/browse-filters.html` (B1 chosen, with the shared paging, empty state, and O1 opening).
  Search is part of the one Browse page: a full-width field under the heading searches the catalog by title or studio, an empty field is simply the catalog, and a term combines with every chip and filter. A separate Search space with its own state (T1) was built first and merged back the same day because the two felt redundant. Matching studios appear as a row of suggestions between the field and the chips ("animation studio" bright, "producer" quieter; no work counts, AniList's are unreliable). A taken studio is a token inside the field (P1). The Filters panel has a Tags type-ahead, include only; the Studio type-ahead it briefly had (V4) went once search joined the same page and made it a duplicate. While a studio's list is read for the first time its popular works show under a thin progress line and the filters wait. No title matches but a studio does: the empty state points at the studio. The top search pill is unchanged on every screen. Mockups: `browse-search.html` (S1 to S3), `browse-search-tabs.html` (T1, since merged), `browse-search-studio-tags.html`, `browse-search-states.html` (V1 with V4, shown as P1; capture it with `SHOT_HEIGHT=13000`), and `browse-search-merged.html` (M1 chosen; M2 and M3 are other placements for the field).
- Empty pages keep the shape of full ones. Home, Saved, and Recent each show their section head, an action tile (search on home, save or play elsewhere), and a row of ghost posters fading out to the right; Saved and Recent add a one-line note under the row. Behind the Home, Browse, Saved, and Recent pages, empty or not, sits an illustration from a hand-picked pool on nekosapi.com (`shared/backdrops.ts`): a wash across the top on home, and on Browse, Saved, and Recent a wash or a figure peeking from the top-right corner, chosen at random per visit. The pool is curated rather than random because the service's "safe" rating lets explicit images through and it cannot mark generated art. Images are cached under the app's data folder by `electron/backdrop-service.ts`, at most one new download per run; the "Backdrop art" switch in Appearance turns the whole thing off. The credit, with its source link, sits at the right end of the footer's foot line. `design/variants/empty-state.html` holds the mockups (its art references `design/shots/nekos/`, which is not committed).
- Search: typing in the pill opens a palette over the page with a result count, and thumbnail rows
  carrying artwork and alternate titles. Up and down move, Enter opens, Escape clears and closes.
  The series page keeps the query in the pill: a click or the search shortcut selects it and reopens the held results over the
  series, typing searches in place, and Escape or the dimmed page closes the palette with the series and the query intact.
  Mockups: `design/variants/search-on-series.html` (Q1 chosen).
- Notifications: the bell panel pops from the bell's corner and closes with a short reverse pop; its rows and the
  Notifications page cards rise in turn like other lists. A deleted card slides aside, fades, and closes its gap, and Clear
  does this row by row. A new notification opens a gap at the top and fades in while the bell swings once and its count
  pops. Marking read fades the card, shrinks its dot, and folds the check away. Mockups: `design/variants/notifications-motion.html`
  (C chosen); `design/record-notifications-motion.cjs` records each variant to `design/shots/motion/`.
- Series: the back link sits at the top-left of the page with the title across the full width beneath it and the source
  tags under the title, as atsu does; they scroll away, and the left panel (poster, Play next, Save, audio and quality
  chips) then holds under the top bar. The Browse detail page shares the header. Mockups:
  `design/variants/series-title-placement.html` (T2 chosen). A dim copy icon follows the title's last word (`src/CopyTitle.tsx`): it
  brightens under the pointer with a "Copy title" tooltip and shows a check with "Copied" for two seconds after the
  click. Mockups: `design/variants/series-copy-title.html` (K1 chosen). The right column has the
  facts strip, then the episode list with All / Unwatched / Watched chips, a jump box, and sort
  arrows (newest first by default). Episodes are grouped by number with one row per provider. Each row shows the best
  quality that source offers, resolved lazily as rows scroll into view and cached in the app’s metadata store; the checkbox
  records progress through that episode on that provider.
- Sources are resolved together around a *work*, the app's own identity for an anime (`Work` in `shared/contracts.ts`,
  owned by `electron/state.ts`). Search groups provider records into one row per work (`unifyAnimeResults` in
  `shared/catalog.ts`, matching rules in `shared/identity.ts`) in three tiers that each run to completion before the
  next: a shared external reference (a MyAnimeList id HiAnime states, an AniList answer, the offline index, or a
  remembered work), then a shared normalised title or alias, then the same season of the same title. Season markers
  are compared strictly ("Part 2" is not "2nd Season", and "Part 6: Stone Ocean Part 2" is not "Part 6: Stone Ocean
  Part 3"); a format, year, or episode count that disagrees vetoes a match. Two records from one provider share a
  row only through a reference or a release qualifier such as "(Uncensored)". Rows show a chip per source and say
  "grouped by title" when the weakest tier joined them. Confident rows are remembered as works after each search.
  Opening a series looks it up on every provider it is not yet known on (`CatalogService.resolve`), using the
  work's known titles; confident matches bind to the work and their episodes join the grouped list as they arrive.
  The series page shows the work's information (`electron/work-info-service.ts`, from AniList, cached indefinitely
  and refreshed by age) under the facts strip: synopsis with a More toggle and the source line with a Refresh info link. Each source tag carries a split control; splitting records
  the pair so title matching never regroups it. Settings has an "Anime information" group with the AniList switch
  and the offline title index switch and download. "Forget links" in the Sources group resets every work. There is
  no manual merge for search rows any more; the library cards keep theirs for duplicates saved before grouping.
- Saved and recent: full card grids filtered by the pill. Settings: grouped cards. The Sources group is one row per
  provider: a status dot with the name and a one-line state on the left, the address in a fixed middle column, and a
  single Check now / Retry button and an on/off switch on the right. A source that is off dims and is left out of search, lookup, and episode loading.
  The theme picker is a row of preview tiles, one per preset plus custom, each drawn in its own background, text,
  and highlight colours; custom adds a row of colour swatches with editable hex values.
  Yes/no settings (start fullscreen, autoplay, diagnostics) are switches; chips are reserved for choices between
  named options (player, quality, audio, preferred source). The cancel/save row sticks to the bottom of the scrolling
  form and save is disabled until something changes. The key-hint footer is gone; `?`
  shows a hint pill.
- Settings save state: every row applies on change, and the right end of the Settings heading reports it only while there is news. It is empty at rest, reads "Saving…" during a write, shows a check with "Saved" that fades after two seconds, and on a refusal keeps "Not saved" with a "retry" link until the save goes through. Mockups: `design/variants/settings-save-state.html` (P1 chosen).
- Subtitle appearance row: the last row of Playback reads like its neighbours, with the label and a one-line summary on the left, then a live one-line sample sized like the external player field and a chevron on the right. The sample stays live while the rows beneath are open, so the settings page carries no second preview. The still behind the sample (and behind the preview in the player's dialog) is a dark frame tinted by the theme. Mockups: `design/variants/subtitle-row.html` (R2 chosen).
- Updates: an available release is announced only inside Settings (`src/UpdateUI.tsx`). An accent link beside the Settings heading ("v0.1.4 available") jumps to the Updates row, the Updates entry in the rail carries a dot, and the gear in the top bar carries the same dot on every screen. The Updates group is one row: the news, the installed version and check time, then "skip this version", "check again", a "View release" link, and primary "Download update". Downloads show progress in that button. Completed Windows/ AppImage updates offer "Install and restart"; Sparkle-enabled macOS builds offer "Install update…", which opens the native download/install/relaunch window. DMG fallback builds and manual Linux packages offer "Open download". Platform instructions and failures appear below the row. The action row wraps at smaller widths. Skipping clears the link and both dots until the next release. There is no banner. Mockups: `design/variants/update-available.html` (first round, rejected) and `design/variants/update-in-settings.html` (S2 chosen).
- Footer: one raised, rounded panel under every page (like the atsu.moe footer), and the only place the app describes itself. Left: the wordmark, a one-line blurb, a credit line saying the app is built on ani-cli by pystardust and its contributors (both linked), and a link to the source. Middle: an "App" column of icon links (home, saved, recent, settings) with the current one lit. Right: "Made by", one row per creator with a small round portrait, the name, and icon-only links (GitHub, Discord, Instagram, email; the Discord icon copies the handle and shows a "Copied" tip). A dim foot line carries the media note. There are no About or Contact pages.
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
