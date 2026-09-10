# Ani Desktop: B2 Palette with art guide

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
Implemented in `src/PlayerScreen.tsx` (docked mode) and `src/App.tsx`; the corner lives in settings.
