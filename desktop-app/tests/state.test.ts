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
  it("keeps player diagnostics opt-in and persists the setting", async () => {
    expect(store.snapshot().settings.playerDiagnostics).toBe(false);
    await store.saveSettings({ ...store.snapshot().settings, playerDiagnostics: true });
    const reloaded = new StateStore(join(directory, "state.json"));
    await reloaded.load();
    expect(reloaded.snapshot().settings.playerDiagnostics).toBe(true);
    await reloaded.saveSettings({ ...reloaded.snapshot().settings, playerDiagnostics: false });
    await store.load();
    expect(store.snapshot().settings.playerDiagnostics).toBe(false);
  });
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

  it("defaults legacy settings to built-in fullscreen playback and validates external mode", async () => {
    await writeFile(join(directory, "state.json"), JSON.stringify({ settings: { playerPath: "C:\\VLC\\vlc.exe" } }));
    const fresh = new StateStore(join(directory, "state.json"));
    await fresh.load();
    expect(fresh.snapshot().settings).toMatchObject({
      playbackTarget: "builtin", startPlayerFullscreen: true, playerPath: "C:\\VLC\\vlc.exe"
    });
    await expect(fresh.saveSettings({ ...fresh.snapshot().settings, playbackTarget: "external", playerPath: "" })).rejects.toThrow(/external player path/i);
    const saved = await fresh.saveSettings({ ...fresh.snapshot().settings, playbackTarget: "builtin", playerPath: "", startPlayerFullscreen: false });
    expect(saved.settings).toMatchObject({ playbackTarget: "builtin", startPlayerFullscreen: false, playerPath: "" });
  });

  it("repairs unknown themes and partial custom colours on load", async () => {
    await writeFile(join(directory, "state.json"), JSON.stringify({ settings: { theme: "bogus", customTheme: { background: "#000000", text: 12 } } }));
    const fresh = new StateStore(join(directory, "state.json"));
    await fresh.load();
    expect(fresh.snapshot().settings.theme).toBe("graphite");
    expect(fresh.snapshot().settings.customTheme).toEqual({ background: "#000000", text: "#EDEDEE", highlight: "#EDEDEE" });
  });

  it("migrates legacy progress and merges confirmed provider duplicates without losing either position", async () => {
    await writeFile(join(directory, "state.json"), JSON.stringify({ history: [
      entry({ animeId: "aniwave:rezero-1", title: "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", lastEpisode: "15", updatedAt: "2026-09-09T01:00:00Z" }),
      entry({ animeId: "anidb:rezero-2", title: "Re:ZERO Starting Life in Another World Season 4", lastEpisode: "81", updatedAt: "2026-09-09T02:00:00Z" })
    ] }));
    const fresh = new StateStore(join(directory, "state.json"));
    await fresh.load();
    expect(fresh.snapshot().history[0].progressByProvider?.aniwave?.lastEpisode).toBe("15");
    await fresh.mergeEntries("aniwave:rezero-1", "anidb:rezero-2");
    const merged = fresh.snapshot();
    expect(merged.history).toHaveLength(1);
    expect(merged.history[0].progressByProvider).toMatchObject({ aniwave: { lastEpisode: "15" }, anidb: { lastEpisode: "81" } });
    expect(merged.providerLinks).toEqual([["aniwave:rezero-1", "anidb:rezero-2"]]);
  });

  it("copies all known provider progress into a newly saved title", async () => {
    const first = entry({
      animeId: "aniwave:rezero-1", title: "Re:ZERO Season 4", lastEpisode: "15", lastProvider: "anidb",
      sources: [
        { id: "aniwave:rezero-1", provider: "aniwave", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"] },
        { id: "anidb:rezero-2", provider: "anidb", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"] }
      ],
      progressByProvider: {
        aniwave: { lastEpisode: "15", mode: "sub", updatedAt: "2026-09-09T01:00:00Z" },
        anidb: { lastEpisode: "81", mode: "sub", updatedAt: "2026-09-09T02:00:00Z" }
      }
    });
    await store.recordHistory(first);
    await store.toggleBookmark(entry({ ...first, progressByProvider: { anidb: first.progressByProvider!.anidb } }));
    expect(store.snapshot().bookmarks[0].progressByProvider).toMatchObject({ aniwave: { lastEpisode: "15" }, anidb: { lastEpisode: "81" } });
  });

  it("remembers a declined duplicate suggestion", async () => {
    await store.recordHistory(entry({ animeId: "aniwave:first-1", title: "Example Season 2" }));
    await store.recordHistory(entry({ animeId: "anidb:second-2", title: "Example 2nd Season" }));
    const before = store.snapshot().history;
    await store.dismissMerge("aniwave:first-1", "anidb:second-2");
    expect(store.snapshot().history).toEqual(before);
    expect(store.snapshot().dismissedMergeKeys).toEqual(["anidb:second-2|aniwave:first-1"]);
  });
});


describe("playback positions and completion", () => {
  it("keeps resume positions across URL changes and only completes on playback end", async () => {
    const request = { url: "https://cdn.test/old-token", title: "Episode", episode: { id: "aniwave:episode-12", entry: entry() } };
    await store.recordHistory({ ...entry(), completed: false });
    expect(store.snapshot().history[0].completed).toBe(false);
    await store.savePlayerStorage(request, { time: 90, volume: 0.4, captions: true, lang: "en", rate: 1.25 });
    const fresh = new StateStore(join(directory, "state.json"));
    await fresh.load();
    expect(fresh.snapshot().playbackPositions?.["aniwave:episode-12:sub"]).toMatchObject({ time: 90, completed: false });
    expect(fresh.snapshot().playerPreferences).toMatchObject({ volume: 0.4, captions: true, lang: "en", rate: 1.25 });
    await fresh.savePlayerStorage({ ...request, url: "https://cdn.test/new-token" }, { time: 150, completed: true });
    expect(fresh.snapshot().history[0]).toMatchObject({ completed: true, progressByProvider: { aniwave: { completed: true } } });
    expect(fresh.snapshot().playbackPositions?.["aniwave:episode-12:sub"]).toMatchObject({ time: 0, completed: true });
  });

  it("keeps a late completion from changing the currently started episode", async () => {
    await store.recordHistory({ ...entry({ lastEpisode: "13" }), completed: false });
    await store.savePlayerStorage({ url: "https://cdn.test/12", title: "Episode", episode: { id: "aniwave:episode-12", entry: entry() } }, { time: 100, completed: true });
    expect(store.snapshot().history[0]).toMatchObject({ lastEpisode: "13", completed: false });
  });
});
