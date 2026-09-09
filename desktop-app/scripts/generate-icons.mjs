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

// ICNS accepts PNG payloads in its modern icon chunks. Include both standard
// and Retina representations so Finder and the Dock stay sharp on Intel and
// Apple Silicon Macs without requiring macOS-only icon tools.
const icnsEntries = [
  ["icp4", 16], ["icp5", 32], ["ic11", 32], ["icp6", 64], ["ic12", 64],
  ["ic07", 128], ["ic08", 256], ["ic13", 256], ["ic09", 512], ["ic14", 512], ["ic10", 1024]
];
const icnsChunks = icnsEntries.map(([type, size]) => {
  const data = png(size);
  const chunk = Buffer.alloc(8 + data.length);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32BE(chunk.length, 4);
  data.copy(chunk, 8);
  return chunk;
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((total, chunk) => total + chunk.length, 0), 4);
await writeFile(new URL("icon.icns", output), Buffer.concat([icnsHeader, ...icnsChunks]));
