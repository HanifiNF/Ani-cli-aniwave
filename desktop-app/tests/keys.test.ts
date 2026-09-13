// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMac, modifier, shortcut } from "../src/keys";

const stubPlatform = (platform: string, userAgentPlatform?: string) => {
  vi.stubGlobal("navigator", { platform, userAgentData: userAgentPlatform === undefined ? undefined : { platform: userAgentPlatform } });
};

describe("shortcut labels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the Command glyph with no separator on macOS", () => {
    stubPlatform("MacIntel");
    expect(isMac()).toBe(true); expect(modifier()).toBe("⌘"); expect(shortcut("K")).toBe("⌘K");
  });

  it("spells out Ctrl with a plus on Windows and Linux", () => {
    stubPlatform("Win32");
    expect(shortcut("K")).toBe("Ctrl+K"); expect(modifier()).toBe("Ctrl");
    stubPlatform("Linux x86_64");
    expect(isMac()).toBe(false); expect(shortcut("S")).toBe("Ctrl+S");
  });

  it("prefers the client hints platform when the browser offers one", () => {
    stubPlatform("", "macOS");
    expect(shortcut("+")).toBe("⌘+");
    stubPlatform("MacIntel", "Windows");
    expect(shortcut("+")).toBe("Ctrl++");
  });
});
