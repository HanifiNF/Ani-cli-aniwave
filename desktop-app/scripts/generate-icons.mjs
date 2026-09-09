import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { themedIconSvg } from "../dist-electron/shared/icon.js";
import { THEME_PRESETS } from "../dist-electron/shared/theme.js";

const source = await readFile(new URL("../../app-icon.svg", import.meta.url), "utf8");
const svg = themedIconSvg(source, THEME_PRESETS.graphite);
const output = new URL("../build/icons/", import.meta.url);
await mkdir(output, { recursive: true });
const png = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
await writeFile(new URL("../dist-electron/icon.png", import.meta.url), png(1024));

// ICO supports PNG entries, preserving transparency at each Windows icon size.
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
await writeFile(new URL("icon.ico", output), Buffer.concat([header, ...images]));
