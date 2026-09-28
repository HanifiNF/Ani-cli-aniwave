import { describe, expect, it } from "vitest";
import { languageFromLabel, normalizeSubtitleLanguage } from "../shared/subtitle-language";

describe("subtitle languages", () => {
  it("reads the language from a track's label, as HiAnime marks every track en", () => {
    expect(["English", "Arabic", "Chinese 2", "Spanish 2", "Norwegian (Bokmål)", "Portuguese (Brazil)", "English [CC]", "Bahasa Indonesia"].map(languageFromLabel))
      .toEqual(["en", "ar", "zh", "es", "nb", "pt", "en", "id"]);
    expect(languageFromLabel("Signs & Songs")).toBeUndefined();
  });
  it("keeps known choices and falls back to English", () => {
    expect(["off", "ar", "xx", undefined].map(normalizeSubtitleLanguage)).toEqual(["off", "ar", "en", "en"]);
  });
});
