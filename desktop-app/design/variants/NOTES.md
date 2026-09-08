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
