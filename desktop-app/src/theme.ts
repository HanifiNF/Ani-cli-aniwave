import type { CustomTheme, ThemePreset } from "../shared/contracts";
import { resolveTheme, videoBrand } from "../shared/theme";
import { applyAppIcon } from "./appIcon";

export function applyTheme(theme: ThemePreset, custom: CustomTheme): () => void {
  const colours = resolveTheme(theme, custom);
  const root = document.documentElement.style;
  root.setProperty("--theme-bg", colours.background);
  root.setProperty("--theme-text", colours.text);
  root.setProperty("--theme-cursor", colours.highlight);
  const brand = videoBrand(colours);
  root.setProperty("--theme-video-brand", brand.colour);
  root.setProperty("--theme-video-brand-text", brand.text);
  return applyAppIcon(colours);
}

