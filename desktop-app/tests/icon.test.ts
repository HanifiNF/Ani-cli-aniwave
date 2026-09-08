// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppIcon } from "../src/appIcon";
import { THEME_PRESETS } from "../shared/theme";

class TestImage {
  static instances: TestImage[] = [];
  onload: (() => void) | null = null;
  src = "";
  constructor() { TestImage.instances.push(this); }
}
const setAppIcon = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  TestImage.instances = [];
  vi.stubGlobal("Image", TestImage);
  window.aniDesktop = { setAppIcon } as unknown as typeof window.aniDesktop;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,test");
});
afterEach(() => {
  document.querySelector('link[rel="icon"]')?.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("themed application icon", () => {
  it.each(Object.entries(THEME_PRESETS))("uses all three %s theme colours", (_name, colours) => {
    const cleanup = applyAppIcon(colours);
    const svg = decodeURIComponent(TestImage.instances[0].src.split(",")[1]);
    const artwork = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect([...artwork.querySelectorAll("path")].map((path) => path.getAttribute("fill")))
      .toEqual([colours.background, colours.highlight, colours.text]);
    TestImage.instances[0].onload?.();
    expect(setAppIcon).toHaveBeenCalledWith("data:image/png;base64,test");
    cleanup();
  });

  it("keeps the newest theme when an older image finishes decoding late", () => {
    const cancelOld = applyAppIcon(THEME_PRESETS.nord);
    const finishOld = TestImage.instances[0].onload;
    cancelOld();
    applyAppIcon({ background: "#123456", text: "#ABCDEF", highlight: "#654321" });
    TestImage.instances[1].onload?.();
    finishOld?.();
    expect(setAppIcon).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href)).toContain('fill="#123456"');
  });

  it("keeps the existing icon while a custom hex field is incomplete", () => {
    applyAppIcon(THEME_PRESETS.nord)();
    const previous = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href;
    expect(() => applyAppIcon({ ...THEME_PRESETS.nord, highlight: "#88" })).not.toThrow();
    expect(TestImage.instances).toHaveLength(1);
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href).toBe(previous);
  });
});
