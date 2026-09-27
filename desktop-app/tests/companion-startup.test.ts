import { describe, expect, it } from "vitest";
import { companionStartupPrompts } from "../src/companion-startup";
import type { EpisodeUpdateStatus, LibraryEntry } from "../shared/contracts";

const history: LibraryEntry[] = [
  { animeId: "aniwave:old", title: "Old", lastEpisode: "2", mode: "sub", updatedAt: "2026-09-01T00:00:00Z" },
  { animeId: "aniwave:new", title: "Recent", lastEpisode: "4", mode: "sub", updatedAt: "2026-09-02T00:00:00Z" }
];
const status: EpisodeUpdateStatus = {
  updates: [
    { id: "old", animeId: "aniwave:old", sourceId: "aniwave:old", provider: "aniwave", title: "Old", episodeId: "old:3", episodeNumber: "3", detectedAt: 1 },
    { id: "new", animeId: "aniwave:new", sourceId: "aniwave:new", provider: "aniwave", title: "Recent", episodeId: "new:5", episodeNumber: "5", detectedAt: 2 },
    { id: "read", animeId: "aniwave:old", sourceId: "aniwave:old", provider: "aniwave", title: "Read", episodeId: "read:4", episodeNumber: "4", detectedAt: 3, readAt: 4 }
  ], unreadCount: 2, counts: {}, latestByAnime: {}, checking: false
};
describe("companion startup prompts", () => {
  it("announces the newest unread update then the latest watched anime", () => {
    expect(companionStartupPrompts(status, history)).toEqual([
      { kind: "startup-update", title: "Recent", episode: "5", otherCount: 1, targetId: "new" },
      { kind: "startup-continue", title: "Recent", targetId: "aniwave:new" }
    ]);
  });
  it("skips unavailable prompts without changing local records", () => {
    expect(companionStartupPrompts(undefined, [])).toEqual([]);
    expect(companionStartupPrompts({ ...status, updates: status.updates.map((item) => ({ ...item, readAt: 5 })) }, history)).toEqual([
      { kind: "startup-continue", title: "Recent", targetId: "aniwave:new" }
    ]);
    expect(status.updates[0].readAt).toBeUndefined();
  });
});
