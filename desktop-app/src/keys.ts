/** Platform-aware labels for keyboard shortcuts. The handlers accept Command or Control everywhere; only the hint text differs. */
const platform = (): string => {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform || "";
};

export const isMac = (): boolean => /mac|iphone|ipad/i.test(platform());

/** The primary modifier as users see it: the Command glyph on macOS, "Ctrl" elsewhere. */
export const modifier = (): string => (isMac() ? "⌘" : "Ctrl");

/** A modifier-plus-key label in the platform's own spelling: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export const shortcut = (key: string): string => (isMac() ? `⌘${key}` : `Ctrl+${key}`);
