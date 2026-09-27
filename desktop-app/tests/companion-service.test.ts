import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CompanionService, inspectCompanionImage, MAX_COMPANION_BYTES } from "../electron/companion-service";

const sheet = () => readFile(join(process.cwd(), "public/pets/columbinya/spritesheet.webp"));
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("custom companion imports", () => {
  it("validates the supplied transparent WebP and rejects oversized, opaque, or wrong-size images", async () => {
    const bytes = await sheet();
    expect(inspectCompanionImage(bytes)).toBe("image/webp");
    expect(() => inspectCompanionImage(Buffer.alloc(MAX_COMPANION_BYTES + 1))).toThrow(/8 MB/);
    const opaque = Buffer.from(bytes); opaque[24] &= ~0x10;
    expect(() => inspectCompanionImage(opaque)).toThrow(/transparency/);
    const wrong = Buffer.from(bytes); wrong[21] = 1;
    expect(() => inspectCompanionImage(wrong)).toThrow(/1536/);
  });

  it("stores multiple opaque IDs, reloads them, and treats a missing image as unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ani-companion-")); directories.push(directory);
    const service = new CompanionService(directory), bytes = await sheet();
    await service.load();
    const first = await service.commit(service.stage(bytes).ticket, "First");
    const second = await service.commit(service.stage(bytes).ticket, "第二");
    expect(first.id).toMatch(/^custom:[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect(await service.image(first.id)).toMatch(/^data:image\/webp;base64,/);
    expect(await service.image("custom:../../bad")).toBeUndefined();
    const reloaded = new CompanionService(directory); await reloaded.load();
    expect((await reloaded.list()).map((record) => record.name)).toEqual(["First", "第二"]);
    await unlink(join(directory, `${first.id.slice(7)}.webp`));
    expect((await reloaded.list())[0].available).toBe(false);
    expect(await reloaded.remove(second.id)).toBe(true);
    expect((await reloaded.list()).map((record) => record.id)).toEqual([first.id]);
  });

  it("rejects invalid names and stale import tickets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ani-companion-")); directories.push(directory);
    const service = new CompanionService(directory); await service.load();
    const candidate = service.stage(await sheet());
    await expect(service.commit("wrong", "Valid")).rejects.toThrow(/expired/);
    await expect(service.commit(candidate.ticket, " ")).rejects.toThrow(/name/);
    expect((await service.list())).toEqual([]);
  });
});
