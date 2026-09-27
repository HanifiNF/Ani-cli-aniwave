import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompanionCandidate, CustomCompanion } from "../shared/companion";

export const MAX_COMPANION_BYTES = 8 * 1024 * 1024;
export const MAX_CUSTOM_COMPANIONS = 20;
const WIDTH = 1536, HEIGHT = 1872;
type Mime = CustomCompanion["mime"];
interface Stored { id: CustomCompanion["id"]; name: string; mime: Mime }
function pngHasTransparency(bytes: Buffer): boolean {
  if (bytes[25] === 4 || bytes[25] === 6) return true;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), next = offset + length + 12;
    if (next > bytes.length) return false;
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (kind === "tRNS") return true;
    if (kind === "IDAT") return false;
    offset = next;
  }
  return false;
}

/** Inspect bytes rather than trusting the extension or a renderer-supplied MIME type. */
export function inspectCompanionImage(bytes: Buffer): Mime {
  if (!bytes.length || bytes.length > MAX_COMPANION_BYTES) throw new Error("Companion sheet must be 8 MB or smaller");
  let width = 0, height = 0, mime: Mime;
  if (bytes.length >= 26 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Invalid PNG sheet");
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = "image/png";
    if (!pngHasTransparency(bytes)) throw new Error("PNG companion must have transparency");
  } else if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (bytes.readUInt32LE(4) + 8 > bytes.length || bytes.readUInt32LE(16) + 20 > bytes.length) throw new Error("Truncated WebP sheet");
    if (chunk === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3);
      if (!(bytes[20] & 0x10)) throw new Error("WebP companion must have transparency");
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
      if (!(bytes[24] & 0x10)) throw new Error("WebP companion must have transparency");
    } else throw new Error("Unsupported or opaque WebP sheet");
    mime = "image/webp";
  } else throw new Error("Choose a PNG or WebP spritesheet");
  if (width !== WIDTH || height !== HEIGHT) throw new Error("Companion sheet must be exactly 1536 × 1872 pixels");
  return mime;
}

const idValid = (id: unknown): id is CustomCompanion["id"] => typeof id === "string" && /^custom:[0-9a-f-]{36}$/i.test(id);
const nameValid = (name: unknown): name is string => typeof name === "string" && name.trim().length > 0 && name.trim().length <= 40 && !/[\x00-\x1f]/.test(name);
const extension = (mime: Mime) => mime === "image/png" ? "png" : "webp";

export class CompanionService {
  private records: Stored[] = [];
  private staged?: { ticket: string; bytes: Buffer; mime: Mime; at: number };
  constructor(private readonly directory: string) {}
  private manifest() { return join(this.directory, "companions.json"); }
  private imageFile(record: Stored) { return join(this.directory, `${record.id.slice(7)}.${extension(record.mime)}`); }
  async load() {
    try {
      const value = JSON.parse(await readFile(this.manifest(), "utf8")) as { companions?: unknown };
      this.records = Array.isArray(value.companions) ? value.companions.filter((item): item is Stored => {
        if (!item || typeof item !== "object") return false;
        const record = item as Partial<Stored>;
        return idValid(record.id) && nameValid(record.name) && (record.mime === "image/png" || record.mime === "image/webp");
      }).slice(0, MAX_CUSTOM_COMPANIONS) : [];
    } catch { this.records = []; }
  }
  private async persist() {
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify({ companions: this.records }));
    await rename(temp, this.manifest());
  }
  async list(): Promise<CustomCompanion[]> {
    const result: CustomCompanion[] = [];
    for (const record of this.records) {
      try { inspectCompanionImage(await readFile(this.imageFile(record))); result.push({ ...record, available: true }); }
      catch { result.push({ ...record, available: false }); }
    }
    return result;
  }
  stage(bytes: Buffer): CompanionCandidate {
    const mime = inspectCompanionImage(bytes);
    const ticket = randomUUID();
    this.staged = { ticket, bytes, mime, at: Date.now() };
    return { ticket, dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, mime };
  }
  async commit(ticket: unknown, rawName: unknown): Promise<CustomCompanion> {
    const pending = this.staged;
    if (!pending || ticket !== pending.ticket || Date.now() - pending.at > 5 * 60_000) throw new Error("Import expired; choose the image again");
    if (!nameValid(rawName)) throw new Error("Enter a companion name of 1–40 characters");
    if (this.records.length >= MAX_CUSTOM_COMPANIONS) throw new Error("Remove a custom companion before adding another");
    const record: Stored = { id: `custom:${randomUUID()}`, name: rawName.trim(), mime: pending.mime };
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temp, pending.bytes);
    await rename(temp, this.imageFile(record));
    this.records.push(record);
    try { await this.persist(); }
    catch (error) { this.records.pop(); await unlink(this.imageFile(record)).catch(() => undefined); throw error; }
    this.staged = undefined;
    return { ...record, available: true };
  }
  async image(id: unknown): Promise<string | undefined> {
    const record = this.records.find((item) => item.id === id);
    if (!record) return;
    try { const bytes = await readFile(this.imageFile(record)); inspectCompanionImage(bytes); return `data:${record.mime};base64,${bytes.toString("base64")}`; }
    catch { return; }
  }
  async remove(id: unknown): Promise<boolean> {
    const index = this.records.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [record] = this.records.splice(index, 1);
    try { await this.persist(); }
    catch (error) { this.records.splice(index, 0, record); throw error; }
    await unlink(this.imageFile(record)).catch(() => undefined);
    return true;
  }
}
