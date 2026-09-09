// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AniPlayerApi, PlayerSession } from "../shared/contracts";

const cleanup = vi.hoisted(() => vi.fn());
vi.mock("@vidstack/react", async () => {
  const React = await import("react");
  return {
    ...await vi.importActual<typeof import("@vidstack/react")>("@vidstack/react"),
    useMediaContext: () => ({}),
    MediaPlayer: ({ children, className, src, title, viewType, streamType, load, controlsDelay, hideControlsOnMouseLeave, keyShortcuts, onError }: {
      children: React.ReactNode;
      className: string;
      src: { src: string };
      title: string;
      viewType: string;
      streamType: string;
      load: string;
      controlsDelay: number;
      hideControlsOnMouseLeave: boolean;
      keyShortcuts: { toggleFullscreen: null };
      onError: (detail: unknown) => void;
    }) => {
      React.useEffect(() => () => cleanup(src.src), [src.src]);
      return (
        <div
          data-testid="media"
          data-src={src.src}
          data-title={title}
          data-view-type={viewType}
          data-stream-type={streamType}
          data-load={load}
          data-controls-delay={controlsDelay}
          data-hide-controls-on-leave={hideControlsOnMouseLeave}
          data-key-fullscreen-disabled={keyShortcuts.toggleFullscreen === null}
          className={className}
        >
          {children}
          <button data-testid="fail-media" type="button" onClick={() => onError({ message: "fatal HLS error" })}>fail media</button>
        </div>
      );
    },
    MediaProvider: () => <div data-testid="provider" />,
    SeekButton: ({ children, seconds, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { seconds: number }) => (
      <button type="button" data-testid="seek" data-seconds={seconds} {...props}>{children}</button>
    )
  };
});
vi.mock("@vidstack/react/player/layouts/default", () => ({
  DefaultVideoLayout: ({ seekStep, slots }: { seekStep: number; slots: { beforePlayButton: React.ReactNode; afterPlayButton: React.ReactNode; fullscreenButton: React.ReactNode } }) => (
    <div data-testid="controls" data-seek-step={seekStep}>
      {slots.beforePlayButton}
      <button type="button">Play</button>
      {slots.afterPlayButton}
      <input data-testid="timeline" type="range" />
      {slots.fullscreenButton}
    </div>
  ),
  defaultLayoutIcons: {
    SeekButton: {
      Backward: () => <span data-testid="rewind-icon" />,
      Forward: () => <span data-testid="forward-icon" />
    },
    FullscreenButton: {
      Enter: () => <span data-testid="enter-fullscreen-icon" />,
      Exit: () => <span data-testid="exit-fullscreen-icon" />
    }
  }
}));

import PlayerApp from "../src/PlayerApp";

let root: Root;
let container: HTMLDivElement;
let load: (session: PlayerSession) => void;
let fullscreenChange: (fullscreen: boolean) => void;
let api: AniPlayerApi;
const session = (url: string, canOpenExternal = true, fullscreen = false): PlayerSession => ({
  id: url, preferences: {},
  request: { url, title: "Example — Episode 1", referrer: "https://embed.test/watch" }, canOpenExternal, fullscreen
});

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cleanup.mockClear();
  api = {
    onDiagnosticsChange: vi.fn(() => vi.fn()),
    logDiagnostic: vi.fn(),
    onCommand: vi.fn(() => vi.fn()),
    onNotice: vi.fn(() => vi.fn()),
    saveStorage: vi.fn().mockResolvedValue(undefined),
    ready: vi.fn().mockResolvedValue(session("https://cdn.test/first.m3u8")),
    onLoad: vi.fn((listener) => { load = listener; return vi.fn(); }),
    onFullscreenChange: vi.fn((listener) => { fullscreenChange = listener; return vi.fn(); }),
    setFullscreen: vi.fn(async (fullscreen) => fullscreen),
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
  it("renders on-demand video controls with timeline and ten-second seeking", () => {
    const media = container.querySelector<HTMLElement>('[data-testid="media"]')!;
    expect(media.dataset.viewType).toBe("video");
    expect(media.dataset.streamType).toBe("on-demand");
    expect(media.dataset.load).toBe("eager");
    expect(media.dataset.controlsDelay).toBe("2500");
    expect(media.dataset.hideControlsOnLeave).toBe("true");
    expect(media.dataset.keyFullscreenDisabled).toBe("true");
    expect(media.classList).toContain("is-windowed");
    expect(container.querySelector('[data-testid="controls"]')?.getAttribute("data-seek-step")).toBe("10");
    expect([...container.querySelectorAll('[data-testid="seek"]')].map((button) => button.getAttribute("data-seconds"))).toEqual(["-10", "10"]);
    expect(container.querySelector('[data-testid="timeline"]')).not.toBeNull();
  });

  it("toggles native fullscreen from the control and follows native window events", async () => {
    const enter = container.querySelector<HTMLButtonElement>('[aria-label="Enter fullscreen"]')!;
    await act(async () => { enter.click(); });
    expect(api.setFullscreen).toHaveBeenCalledWith(true);
    expect(container.querySelector('[aria-label="Exit fullscreen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media"]')?.classList).toContain("is-native-fullscreen");

    await act(async () => { fullscreenChange(false); });
    expect(container.querySelector('[aria-label="Enter fullscreen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media"]')?.classList).toContain("is-windowed");
  });

  it("uses F to toggle and Escape to leave native fullscreen", async () => {
    vi.mocked(api.setFullscreen).mockClear();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })); });
    expect(api.setFullscreen).toHaveBeenLastCalledWith(true);

    vi.mocked(api.setFullscreen).mockClear();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(api.setFullscreen).toHaveBeenLastCalledWith(false);
  });

  it("replaces streams and releases the previous media player", async () => {
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-src")).toBe("https://cdn.test/first.m3u8");
    cleanup.mockClear();
    await act(async () => load(session("https://cdn.test/second.m3u8")));
    expect(cleanup).toHaveBeenCalledWith("https://cdn.test/first.m3u8");
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-src")).toBe("https://cdn.test/second.m3u8");
  });

  it("shows retry and waits for an explicit external fallback click", async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=fail-media]")!.click(); });
    expect(container.textContent).toContain("fatal HLS error");
    expect(api.openExternal).not.toHaveBeenCalled();
    const fallback = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open in external player")!;
    await act(async () => { fallback.click(); });
    expect(api.openExternal).toHaveBeenCalledOnce();
  });
});
