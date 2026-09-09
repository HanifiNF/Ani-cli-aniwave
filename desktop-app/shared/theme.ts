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

/** Relative luminance of a hex colour, 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The video surface is always black, so a dark highlight (paper, solarized light) falls back to white for player controls. */
export function videoBrand(colours: CustomTheme): { colour: string; text: string } {
  const colour = isHexColor(colours.highlight) && luminance(colours.highlight) >= 0.18 ? colours.highlight : "#ffffff";
  return { colour, text: luminance(colour) > 0.4 ? "#000000" : "#ffffff" };
}
