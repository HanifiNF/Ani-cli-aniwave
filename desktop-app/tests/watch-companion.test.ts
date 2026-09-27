import { describe, expect, it } from "vitest";
import { COMPANION_ANIMATIONS, COMPANION_REGISTRY, companionFrame, normalizeCompanionPreferences, normalizeCompanionSize } from "../shared/companion";
import { CompanionDialogueGate, companionLine } from "../src/companion-dialogue";

describe("watch companion", () => {
  it("defaults and normalizes persisted preferences", () => {
    expect(normalizeCompanionPreferences({})).toMatchObject({ companionEnabled: true, companionPetId: "columbinya", companionFrequency: "normal", companionWander: true, companionSize: 100 });
    expect(normalizeCompanionPreferences({ companionEnabled: false, companionPetId: "feibi", companionFrequency: "quiet" })).toMatchObject({ companionEnabled: false, companionPetId: "feibi", companionFrequency: "quiet" });
    expect(normalizeCompanionPreferences({ companionPetId: "unknown" as never, companionFrequency: "nope" as never }).companionPetId).toBe("columbinya");
  });
  it("clamps and rounds companion sizes without trusting saved values", () => {
    expect([normalizeCompanionSize(50), normalizeCompanionSize(155), normalizeCompanionSize(200)]).toEqual([50, 160, 200]);
    expect([normalizeCompanionSize(0), normalizeCompanionSize(999), normalizeCompanionSize(NaN), normalizeCompanionSize("150")]).toEqual([50, 200, 100, 100]);
  });

  it("uses safe local dialogue and short plain-text placeholders", () => {
    const line = companionLine({ id: 1, kind: "play", title: "<script>alert(1)</script>", episode: "13<script>" });
    expect(line.animation).toBe("jump");
    expect(line.text).not.toContain("<script>");
    expect(companionLine({ id: 2, kind: "series", title: "漢字 Anime" }).text).toContain("漢字 Anime");
  });

  it("rate-limits routine events, lets important events interrupt, and lets clicks speak immediately", () => {
    const gate = new CompanionDialogueGate();
    expect(gate.accept({ id: 1, kind: "series", key: "a" }, "normal", 0)?.id).toBe(1);
    expect(gate.accept({ id: 2, kind: "series", key: "a" }, "normal", 1_000)?.id).toBe(2);
    expect(gate.accept({ id: 5, kind: "save", key: "a" }, "normal", 2_000)).toBeUndefined();
    expect(gate.next("normal", 45_999)).toBeUndefined();
    expect(gate.next("normal", 46_000)?.id).toBe(5);
    expect(gate.accept({ id: 6, kind: "section", section: "saved" }, "quiet", 46_001)?.id).toBe(6);
    expect(gate.accept({ id: 3, kind: "complete", key: "a" }, "normal", 46_002)?.id).toBe(3);
    expect(gate.accept({ id: 4, kind: "hello" }, "normal", 46_003)?.id).toBe(4);
    expect(companionLine({ id: 7, kind: "section", section: "notifications" }).text).toContain("new");
    expect(companionLine({ id: 8, kind: "startup-update", title: "Anime", episode: "13", otherCount: 2 }).text).toContain("2 other unread updates");
  });

  it("maps all supplied sheets to verified animation cells", () => {
    expect(Object.keys(COMPANION_REGISTRY)).toEqual(["columbinya", "endminguga", "feibi"]);
    expect(Object.values(COMPANION_ANIMATIONS).map(({ frames }) => frames)).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
    expect(companionFrame("run-right", 7)).toEqual({ x: 7 * 192, y: 208 });
    expect(companionFrame("wave", 999)).toEqual({ x: 3 * 192, y: 3 * 208 });
  });
});
