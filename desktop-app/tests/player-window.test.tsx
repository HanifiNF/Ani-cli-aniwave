// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AniPlayerApi, PlayerSession } from "../shared/contracts";

const cleanup = vi.hoisted(() => vi.fn());
vi.mock("@vidstack/react", async () => {
  const React = await import("react");
  return {
    MediaPlayer: ({ children, src, title, onError }: { children: React.ReactNode; src: { src: string }; title: string; onError: (detail: unknown) => void }) => {
      React.useEffect(() => () => cleanup(src.src), [src.src]);
      return <div data-testid="media" data-src={src.src} data-title={title}>{children}<button type="button" onClick={() => onError({ message: "fatal HLS error" })}>fail media</button></div>;
    },
    MediaProvider: () => <div data-testid="provider" />
  };
});
vi.mock("@vidstack/react/player/layouts/default", () => ({
  DefaultVideoLayout: () => <div data-testid="controls" />,
  defaultLayoutIcons: {}
}));

import PlayerApp from "../src/PlayerApp";

let root: Root;
let container: HTMLDivElement;
let load: (session: PlayerSession) => void;
let api: AniPlayerApi;
const session = (url: string, canOpenExternal = true): PlayerSession => ({
  request: { url, title: "Example — Episode 1", referrer: "https://embed.test/watch" }, canOpenExternal
});

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cleanup.mockClear();
  api = {
    ready: vi.fn().mockResolvedValue(session("https://cdn.test/first.m3u8")),
    onLoad: vi.fn((listener) => { load = listener; return vi.fn(); }),
    openExternal: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined)
  };
  window.aniPlayer = api;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<PlayerApp />); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});

describe("built-in player window", () => {
  it("replaces streams and releases the previous media player", async () => {
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-src")).toBe("https://cdn.test/first.m3u8");
    cleanup.mockClear();
    await act(async () => load(session("https://cdn.test/second.m3u8")));
    expect(cleanup).toHaveBeenCalledWith("https://cdn.test/first.m3u8");
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-src")).toBe("https://cdn.test/second.m3u8");
  });

  it("shows retry and waits for an explicit external fallback click", async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=media] button")!.click(); });
    expect(container.textContent).toContain("fatal HLS error");
    expect(api.openExternal).not.toHaveBeenCalled();
    const fallback = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open in external player")!;
    await act(async () => { fallback.click(); });
    expect(api.openExternal).toHaveBeenCalledOnce();
  });
});
