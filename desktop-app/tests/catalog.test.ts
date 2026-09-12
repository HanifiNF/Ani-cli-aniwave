import { describe, expect, it } from "vitest";
import type { AnimeResult } from "../shared/contracts";
import { likelyDuplicate, unifyAnimeResults } from "../shared/catalog";

const anime = (id: string, title: string, aliases = [title]): AnimeResult => {
  const provider = id.startsWith("aniwave:") ? "aniwave" as const : id.startsWith("hianime:") ? "hianime" as const : "anidb" as const;
  return { id, title, provider, sources: [{ id, title, provider, aliases }] };
};

describe("multi-source catalog identity", () => {
  it("combines exact normalized English aliases and keeps both source IDs", () => {
    const results = unifyAnimeResults([
      anime("aniwave:rezero-82570", "Re:ZERO -Starting Life in Another World- Season 4", ["Re:ZERO -Starting Life in Another World- Season 4", "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season"]),
      anime("anidb:rezero-4", "Re:ZERO Starting Life in Another World Season 4")
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.id)).toEqual(["aniwave:rezero-82570", "anidb:rezero-4"]);
  });

  it("does not automatically combine different seasons or merely similar titles", () => {
    expect(unifyAnimeResults([
      anime("aniwave:show-1", "Example Season 1"), anime("anidb:show-2", "Example Season 2")
    ])).toHaveLength(2);
    expect(unifyAnimeResults([
      anime("aniwave:show-1", "Example"), anime("anidb:show-special-2", "Example Special")
    ])).toHaveLength(2);
  });

  it("uses remembered manual links without fuzzy auto-merging", () => {
    const left = anime("aniwave:frieren-1", "Sousou no Frieren");
    const right = anime("anidb:frieren-2", "Frieren Beyond Journey's End");
    expect(unifyAnimeResults([left, right])).toHaveLength(2);
    expect(unifyAnimeResults([left, right], [[left.id, right.id]])).toHaveLength(1);
  });

  it("suggests matching provider records with the same franchise and season for confirmation", () => {
    expect(likelyDuplicate(
      anime("aniwave:rezero-1", "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season"),
      anime("anidb:rezero-2", "Re:ZERO -Starting Life in Another World- Season 4")
    )).toBe(true);
  });

  it("coalesces three groups when a third source bridges their exact aliases", () => {
    const results = unifyAnimeResults([
      anime("aniwave:example-1", "Example English"),
      anime("anidb:example-2", "作品名"),
      anime("hianime:example-series-abc123", "Example English", ["Example English", "作品名"])
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.provider)).toEqual(["aniwave", "hianime", "anidb"]);
  });

  it("does not combine duplicate records from the same provider", () => {
    expect(unifyAnimeResults([anime("hianime:example-one-abc123", "Example"), anime("hianime:example-two-def456", "Example")])).toHaveLength(2);
  });
});
