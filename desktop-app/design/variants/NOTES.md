# Ani Desktop UI rework: design notes

## What the app is

A launcher, not a player. Search a title, pick an episode, and the stream is handed to mpv, VLC, or IINA.
Audience: ani-cli users. They live in a terminal, run mpv, and care about speed over chrome.
Primary job: get from "I want episode N of X" to a playing window in the fewest actions.

## UX changes shared by every variant

- Launch screen shows Continue watching from history, under a focused search field. No marketing hero.
- Clicking an episode resolves the stream and opens the player in one step. Quality, sub/dub, and source are set
  before the click, not after. This matches how ani-cli behaves.
- Episodes already watched (up to the last recorded episode) are marked, and the next one is suggested.
- Status, progress, and errors appear inline where the action happened, not in a corner toast.
- Settings is a plain page in the same layout, not a modal.
- Bookmarks and history are one click from anywhere and use the same row style as search results.

## Variant A: Guide (light)

Idea: a printed TV program guide. Everything is a list or a table in one calm column.

- Color: paper #F5F5F3, surface #FFFFFF, ink #1A1B1E, muted #6F7278, rule #DEDFDB, indigo #2F3E9E, indigo tint #E9ECF8
- Type: Schibsted Grotesk (bundled woff2, one family). Titles 26px/600, body 14px/400, rows 15px/500. Tabular figures.
- Layout: one 720px column centered in the window, all content left-aligned. Wordmark and three text links on the top row.
  Search is an underlined field, not a box. Episodes are a numbered table because they are a real sequence.
- Principles: no cards, no shadows, no icons. Rules only between rows. Indigo appears only on the thing you can act on next.

Self-review: light plus serif plus terracotta is the generic light default; this uses a grotesque and indigo instead.
Hairline table rules are justified because rows are data. Radius is 6px on inputs only.

## Variant B: Palette (dark)

Idea: ani-cli's fzf menus, set properly. One text field drives the whole app. Keyboard first, mouse works too.

- Color: graphite #1F2023, raised #27282C, text #EDEDEE, muted #8B8C92, rule #35363A, cursor bar #EDEDEE (inverted row)
- Type: Fragment Mono (bundled, one weight). Hierarchy by size and tone only: 22px title, 14px rows, 12px hints.
- Layout: full width, fixed 56px left gutter, left-aligned. Field on top, result groups below, key hints pinned at the bottom.
  Episode picker is a wrapped grid of numbers with a cursor.
- Principles: no accent hue at all; the only highlight is the inverted cursor row. No icons, no prompt glyph, no blinking cursor.

Self-review: dark plus one acid accent is the generic dark default; this has zero accent and a mid graphite base.
Monospace everywhere is a total choice tied to the product's CLI origin, not a data-label garnish.

## Variant B2: Palette with art (mouse friendly)

Same tokens and type as B. Changes:

- Cover art in every row (40 by 56) and a larger cover (112 by 158) in the series header. Art is the only color on screen.
  Stand-in art in posters/ is generated locally because the public poster APIs were unreachable; real posters come from
  the provider's poster field. LibraryEntry needs a new optional poster field so history and saved rows can show art too.
- Every keyboard action has a visible clickable control: audio, quality, and source are chips under the field, series has
  back and save buttons, the status line has cancel, settings has cancel and save changes, and the footer links to
  saved, recent, and settings. Rows are 68px tall with a hover state, so mouse targets are generous.
- Key hints stay in the footer for people who prefer the keyboard.
- Saved and recent are full screens in the same row style, reached from the footer or by pressing s or r from home.
  The field becomes a filter. Each row shows progress, the play action (play ep N, or play ep 1 again when finished),
  audio mode, and a quiet remove. Recent adds a clear history action and relative dates. The empty saved state explains
  what saving does. Saved rows keep their place because recordHistory already updates matching bookmarks.

### Themes for B2

A theme is three colours: background, text, and highlight. Surfaces, rules, dim, and muted text are mixed from
background and text with color-mix in oklab, so any three colours that contrast produce a complete, consistent palette.
Cover art stays the only other colour on screen.

Presets: graphite (default), paper, nord, gruvbox, mocha (Catppuccin), solarized light. They follow well known terminal
schemes so the app can match the user's shell. Custom starts from the current preset's three values, edited with a swatch
that opens the native colour picker and a hex field. Selecting a preset applies instantly; save changes persists it.

Implementation: a theme field in Settings holding either a preset name or three hex values; the renderer sets
data-theme on the html element and, for custom, three CSS variables. No component needs to know about themes.

## Variant C: Native (follows the OS)

Idea: the app has no brand. It wears the system font, the system accent color, and the system light/dark mode.

- Color: system. Light: window #FFFFFF, sidebar #F4F4F6, text #1D1D1F, secondary #6E6E73, separator #E3E3E7.
  Dark: window #1E1E20, sidebar #262628, text #F2F2F2, secondary #9A9A9F, separator #3A3A3D. Accent: CSS AccentColor.
- Type: system-ui stack (SF Pro on macOS, Segoe UI Variable on Windows). 13px base like native apps.
- Layout: two panes. Left 300px: segmented control (Search, Saved, Recent), field, rows with small square art.
  Right: selected series, compact controls, episode grid, status bar at the bottom.
- Principles: native controls and spacing, nothing decorative. Traffic lights inset on macOS via hiddenInset title bar.

Self-review: this is deliberately the platform default. Its distinctiveness is restraint and OS accent adoption.

## Outcome

Variant B2 with themes was implemented in the app on 9 September 2026 (src/App.tsx, src/styles.css, shared/theme.ts).
The other variants remain here as reference.
