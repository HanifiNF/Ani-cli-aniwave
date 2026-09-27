import { describe, expect, it } from "vitest";
import { COMPANION_ANIMATIONS, COMPANION_REGISTRY, companionFrame, normalizeCompanionPreferences } from "../shared/companion";
import { CompanionDialogueGate, companionLine } from "../src/companion-dialogue";

describe("watch companion", () => {
  it("defaults and normalizes persisted preferences", () => {
    expect(normalizeCompanionPreferences({})).toMatchObject({ companionEnabled: true, companionPetId: "columbinya", companionFrequency: "normal", companionWander: true });
    expect(normalizeCompanionPreferences({ companionEnabled: false, companionPetId: "feibi", companionFrequency: "quiet" })).toMatchObject({ companionEnabled: false, companionPetId: "feibi", companionFrequency: "quiet" });
    expect(normalizeCompanionPreferences({ companionPetId: "unknown" as never, companionFrequency: "nope" as never }).companionPetId).toBe("columbinya");
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
    expect(gate.accept({ id: 2, kind: "series", key: "a" }, "normal", 46_000)).toBeUndefined();
    expect(gate.accept({ id: 5, kind: "save", key: "a" }, "normal", 1_000)).toBeUndefined();
    expect(gate.next("normal", 44_999)).toBeUndefined();
    expect(gate.next("normal", 45_000)?.id).toBe(5);
    expect(gate.accept({ id: 3, kind: "complete", key: "a" }, "normal", 45_001)?.id).toBe(3);
    expect(gate.next("normal", 45_002)).toBeUndefined();
    expect(gate.accept({ id: 4, kind: "hello" }, "normal", 45_003)?.id).toBe(4);
  });

  it("maps all supplied sheets to verified animation cells", () => {
    expect(Object.keys(COMPANION_REGISTRY)).toEqual(["columbinya", "endminguga", "feibi"]);
    expect(Object.values(COMPANION_ANIMATIONS).map(({ frames }) => frames)).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
    expect(companionFrame("run-right", 7)).toEqual({ x: 7 * 192, y: 208 });
    expect(companionFrame("wave", 999)).toEqual({ x: 3 * 192, y: 3 * 208 });
  });
});
