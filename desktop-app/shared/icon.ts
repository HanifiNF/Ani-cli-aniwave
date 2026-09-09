import type { CustomTheme } from "./contracts";
import { isHexColor } from "./theme";

/** Keep the original artwork's geometry and map its three fills to the active palette. */
export function themedIconSvg(svg: string, colours: CustomTheme): string {
  if (![colours.background, colours.text, colours.highlight].every(isHexColor)) {
    throw new Error("Icon colours must be six-digit hex values");
  }
  const fills: Record<string, string> = {
    "#1F2023": colours.background,
    "#EDEDEE": colours.text,
    "#88C0D0": colours.highlight
  };
  return svg.replace(/fill="(#[0-9a-f]{6})"/gi, (attribute, colour: string) =>
    fills[colour.toUpperCase()] ? `fill="${fills[colour.toUpperCase()]}"` : attribute);
}
