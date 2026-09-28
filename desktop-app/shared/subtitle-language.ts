/** The subtitle languages a viewer can prefer, as ISO 639-1 codes; "off" starts every episode without subtitles. */
export const SUBTITLE_LANGUAGES = ["en", "ar", "zh", "cs", "da", "nl", "fi", "fr", "de", "el", "he", "hi", "hu", "id", "it", "ja", "ko", "ms", "nb", "pl", "pt", "ro", "ru", "es", "sv", "th", "tr", "uk", "vi"] as const;
export type SubtitleLanguage = typeof SUBTITLE_LANGUAGES[number] | "off";
export const DEFAULT_SUBTITLE_LANGUAGE: SubtitleLanguage = "en";

const english = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "language" }) : undefined;
/** A language's English name, such as "Portuguese" for "pt". */
export const languageName = (code: string): string => english?.of(code) ?? code;

export function normalizeSubtitleLanguage(value: unknown): SubtitleLanguage {
  return value === "off" || (SUBTITLE_LANGUAGES as readonly unknown[]).includes(value) ? value as SubtitleLanguage : DEFAULT_SUBTITLE_LANGUAGE;
}

/**
  The player's starting subtitle state for a Settings choice. It replaces whatever the player last saved, so a track it
  fell back to never becomes the preference.
*/
export function subtitlePreferences(value: unknown): { lang: string | null; captions: boolean } {
  const language = normalizeSubtitleLanguage(value);
  return language === "off" ? { lang: null, captions: false } : { lang: language, captions: true };
}

const letters = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\p{L}]+/gu, "");
const NAMES = new Map<string, string>([
  ...SUBTITLE_LANGUAGES.map((code) => [letters(languageName(code)), code] as [string, string]),
  // Names sources use that differ from the English display name.
  ["norwegian", "nb"], ["bahasaindonesia", "id"], ["bahasamelayu", "ms"], ["chinesesimplified", "zh"], ["chinesetraditional", "zh"], ["brazilianportuguese", "pt"]
]);

/**
  The language a subtitle track's label names ("English", "Chinese 2", "Portuguese (Brazil)", "Norwegian (Bokmål)"), or
  undefined when the label names none. HiAnime marks every track "en" whatever its language, so the label is the
  better witness.
*/
export function languageFromLabel(label: string): string | undefined {
  const whole = letters(label);
  const base = letters(label.replace(/\(.*?\)|\[.*?\]/g, ""));
  return NAMES.get(whole) ?? NAMES.get(base) ?? NAMES.get(letters(label.split(/[-–(]/)[0]));
}
