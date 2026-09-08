import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateStore } from "../electron/state";
import type { LibraryEntry } from "../shared/contracts";

let directory: string;
let store: StateStore;

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  animeId: "aniwave:frieren-1", title: "Frieren", lastEpisode: "12", mode: "sub", updatedAt: "", poster: "https://cdn.test/frieren.jpg", ...overrides
});

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ani-state-"));
  store = new StateStore(join(directory, "state.json"));
  await store.load();
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("StateStore", () => {
  it("keeps a valid poster and drops unsafe ones", async () => {
    await store.recordHistory(entry());
    expect(store.snapshot().history[0].poster).toBe("https://cdn.test/frieren.jpg");
    await store.recordHistory(entry({ animeId: "anidb:mob-2", poster: "javascript:alert(1)" }));
    expect(store.snapshot().history[0].poster).toBeUndefined();
  });

  it("preserves a known poster when a later entry has none", async () => {
    await store.toggleBookmark(entry());
    await store.recordHistory(entry({ lastEpisode: "13", poster: undefined }));
    const state = store.snapshot();
    expect(state.history[0]).toMatchObject({ lastEpisode: "13", poster: "https://cdn.test/frieren.jpg" });
    expect(state.bookmarks[0]).toMatchObject({ lastEpisode: "13", poster: "https://cdn.test/frieren.jpg" });
  });

  it("removes single entries and clears history", async () => {
    await store.toggleBookmark(entry());
    await store.recordHistory(entry());
    await store.recordHistory(entry({ animeId: "anidb:mob-2", title: "Mob" }));
    await store.removeHistory("aniwave:frieren-1");
    expect(store.snapshot().history.map((item) => item.animeId)).toEqual(["anidb:mob-2"]);
    expect(store.snapshot().bookmarks).toHaveLength(1);
    await store.removeBookmark("aniwave:frieren-1");
    expect(store.snapshot().bookmarks).toHaveLength(0);
    await store.clearHistory();
    expect(store.snapshot().history).toHaveLength(0);
  });

  it("validates themes when saving settings", async () => {
    const settings = store.snapshot().settings;
    await expect(store.saveSettings({ ...settings, theme: "custom", customTheme: { background: "#1F2023", text: "#EDEDEE", highlight: "not-a-colour" } })).rejects.toThrow(/highlight/);
    await expect(store.saveSettings({ ...settings, theme: "neon" as never })).rejects.toThrow(/theme/i);
    const saved = await store.saveSettings({ ...settings, theme: "nord" });
    expect(saved.settings.theme).toBe("nord");
    expect(JSON.parse(await readFile(join(directory, "state.json"), "utf8")).settings.theme).toBe("nord");
  });

  it("repairs unknown themes and partial custom colours on load", async () => {
    await writeFile(join(directory, "state.json"), JSON.stringify({ settings: { theme: "bogus", customTheme: { background: "#000000", text: 12 } } }));
    const fresh = new StateStore(join(directory, "state.json"));
    await fresh.load();
    expect(fresh.snapshot().settings.theme).toBe("graphite");
    expect(fresh.snapshot().settings.customTheme).toEqual({ background: "#000000", text: "#EDEDEE", highlight: "#EDEDEE" });
  });
});
