import svg from "../../app-icon.svg?raw";
import type { CustomTheme } from "../shared/contracts";
import { themedIconSvg } from "../shared/icon";
import { isHexColor } from "../shared/theme";

/** The cleanup prevents a slower image decode from replacing a newer theme. */
export function applyAppIcon(colours: CustomTheme): () => void {
  // Hex fields may contain an incomplete value while the user is typing.
  if (![colours.background, colours.text, colours.highlight].every(isHexColor)) return () => {};
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themedIconSvg(svg, colours))}`;
  let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.append(favicon);
  }
  favicon.type = "image/svg+xml";
  favicon.href = url;

  let cancelled = false;
  const image = new Image();
  image.onload = () => {
    if (cancelled) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, 1024, 1024);
    void window.aniDesktop.setAppIcon(canvas.toDataURL("image/png")).catch(console.error);
  };
  image.src = url;
  return () => { cancelled = true; image.onload = null; };
}
