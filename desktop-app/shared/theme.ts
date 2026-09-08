import type { CustomTheme, ThemePreset } from "./contracts";

/** Presets follow well known terminal colour schemes so the app can match the user's shell. */
export const THEME_PRESETS: Record<Exclude<ThemePreset, "custom">, CustomTheme> = {
  graphite: { background: "#1F2023", text: "#EDEDEE", highlight: "#EDEDEE" },
  paper: { background: "#F4F4F1", text: "#1E1F22", highlight: "#1E1F22" },
  nord: { background: "#2E3440", text: "#ECEFF4", highlight: "#88C0D0" },
  gruvbox: { background: "#282828", text: "#EBDBB2", highlight: "#FABD2F" },
  mocha: { background: "#1E1E2E", text: "#CDD6F4", highlight: "#CBA6F7" },
  "solarized-light": { background: "#FDF6E3", text: "#586E75", highlight: "#268BD2" }
};

export const THEME_NAMES: ThemePreset[] = [...(Object.keys(THEME_PRESETS) as ThemePreset[]), "custom"];

export const isThemePreset = (value: unknown): value is ThemePreset => typeof value === "string" && (THEME_NAMES as string[]).includes(value);

export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function resolveTheme(theme: ThemePreset, custom: CustomTheme): CustomTheme {
  return theme === "custom" ? custom : THEME_PRESETS[theme];
}
