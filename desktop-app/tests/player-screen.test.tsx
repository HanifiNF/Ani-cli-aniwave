// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AniDesktopApi, AniPlayerApi, PlayerSession } from "../shared/contracts";

const cleanup = vi.hoisted(() => vi.fn());
vi.mock("@vidstack/react", async () => {
  const React = await import("react");
  return {
    ...await vi.importActual<typeof import("@vidstack/react")>("@vidstack/react"),
    useMediaContext: () => ({}),
    MediaPlayer: ({ children, className, src, title, viewType, streamType, load, controlsDelay, hideControlsOnMouseLeave, keyShortcuts, keyDisabled, onError, onEnded }: {
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
      keyDisabled: boolean;
      onError: (detail: unknown) => void;
      onEnded: () => void;
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
          data-key-disabled={keyDisabled}
          className={className}
        >
          {children}
          <button data-testid="fail-media" type="button" onClick={() => onError({ message: "fatal HLS error" })}>fail media</button>
          <button data-testid="end-media" type="button" onClick={onEnded}>end media</button>
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

import PlayerScreen, { type PlayerScreenProps } from "../src/PlayerScreen";

let root: Root;
let container: HTMLDivElement;
let api: AniPlayerApi;
let onBack: ReturnType<typeof vi.fn<() => void>>;
let onNext: ReturnType<typeof vi.fn<() => void>>;
let onPrev: ReturnType<typeof vi.fn<() => void>>;
let setFullscreenFromWindow: (fullscreen: boolean) => void;
const session = (url: string, canOpenExternal = true, fullscreen = false): PlayerSession => ({
  id: url, preferences: {}, canOpenExternal, fullscreen,
  request: { url, title: "Example — Episode 1", referrer: "https://embed.test/watch",
    episode: { id: "ep-1", entry: { animeId: "aniwave:example-1", title: "Example", lastEpisode: "1", mode: "sub", updatedAt: "" } } }
});

/** Owns fullscreen the way App does, so native window events can be replayed into the screen. */
function Harness(props: Partial<PlayerScreenProps> & { session: PlayerSession }) {
  const [fullscreen, setFullscreen] = useState(props.session.fullscreen);
  setFullscreenFromWindow = setFullscreen;
  return <PlayerScreen fullscreen={fullscreen} onFullscreenChange={setFullscreen} autoplayNext onBack={onBack} onNext={onNext} onPrev={onPrev} episodeCount={12} detail="1080p sub aniwave" {...props} />;
}
const render = (props: Partial<PlayerScreenProps> & { session: PlayerSession }) => act(async () => { root.render(<Harness {...props} />); });
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text)!;
// Each second is its own act so React commits the state the next timer depends on.
const tick = async (seconds: number) => { for (let i = 0; i < seconds; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };
const press = (key: string, init: KeyboardEventInit = {}) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init })); });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cleanup.mockClear();
  onBack = vi.fn<() => void>(); onNext = vi.fn<() => void>(); onPrev = vi.fn<() => void>();
  api = {
    ready: vi.fn().mockResolvedValue(undefined),
    onLoad: vi.fn(() => vi.fn()),
    onDiagnosticsChange: vi.fn(() => vi.fn()),
    logDiagnostic: vi.fn(),
    onCommand: vi.fn(() => vi.fn()),
    onNotice: vi.fn(() => vi.fn()),
    onFullscreenChange: vi.fn(() => vi.fn()),
    saveStorage: vi.fn().mockResolvedValue(undefined),
    setFullscreen: vi.fn(async (fullscreen) => fullscreen),
    openExternal: vi.fn().mockResolvedValue(true),
    setActive: vi.fn().mockResolvedValue(undefined)
  };
  window.aniDesktop = { player: api } as unknown as AniDesktopApi;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await render({ session: session("https://cdn.test/first.m3u8") });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("built-in player screen", () => {
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

  it("shows the episode context above the video and reports itself active", () => {
    const now = container.querySelector(".now")!;
    expect(now.textContent).toContain("Example");
    expect(now.textContent).toContain("episode 1 of 12");
    expect(now.textContent).toContain("1080p sub aniwave");
    expect(document.title).toBe("Example — Episode 1");
    expect(api.setActive).toHaveBeenCalledWith(true);
  });

  it("toggles native fullscreen from the control and follows native window events", async () => {
    const enter = container.querySelector<HTMLButtonElement>('[aria-label="Enter fullscreen"]')!;
    await act(async () => { enter.click(); });
    expect(api.setFullscreen).toHaveBeenCalledWith(true);
    expect(container.querySelector('[aria-label="Exit fullscreen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media"]')?.classList).toContain("is-native-fullscreen");
    expect(container.querySelector(".player-shell")?.classList).toContain("is-fullscreen");

    await act(async () => { setFullscreenFromWindow(false); });
    expect(container.querySelector('[aria-label="Enter fullscreen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media"]')?.classList).toContain("is-windowed");
  });

  it("uses F to toggle, then Escape to leave fullscreen, then Escape to go back", async () => {
    vi.mocked(api.setFullscreen).mockClear();
    await press("f");
    expect(api.setFullscreen).toHaveBeenLastCalledWith(true);

    vi.mocked(api.setFullscreen).mockClear();
    await press("Escape");
    expect(api.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(onBack).not.toHaveBeenCalled();

    await press("Escape");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("moves between episodes with N and P and the header buttons", async () => {
    await press("n"); expect(onNext).toHaveBeenCalledOnce();
    await press("p"); expect(onPrev).toHaveBeenCalledOnce();
    await act(async () => { button("next").click(); });
    expect(onNext).toHaveBeenCalledTimes(2);
    await act(async () => { button("episodes").click(); });
    expect(onBack).toHaveBeenCalledOnce();
    await render({ session: session("https://cdn.test/first.m3u8"), onNext: undefined, onPrev: undefined });
    expect(button("next").disabled).toBe(true);
    expect(button("prev").disabled).toBe(true);
    await press("n"); expect(onNext).toHaveBeenCalledTimes(2);
  });

  it("counts down to the next episode after the stream ends and lets Escape cancel", async () => {
    vi.useFakeTimers();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=end-media]")!.click(); });
    expect(container.querySelector(".player-next")?.textContent).toContain("next episode in 5");
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-key-disabled")).toBe("true");
    await tick(2);
    expect(container.querySelector(".player-next")?.textContent).toContain("next episode in 3");
    await press("Escape");
    expect(container.querySelector(".player-next")).toBeNull();
    expect(onNext).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=end-media]")!.click(); });
    await press("Enter");
    expect(onNext).toHaveBeenCalledOnce();
    expect(container.querySelector(".player-next")).toBeNull();

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=end-media]")!.click(); });
    await tick(5);
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".player-next")).toBeNull();
  });

  it("does nothing at the end without autoplay or a next episode", async () => {
    await render({ session: session("https://cdn.test/first.m3u8"), autoplayNext: false });
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=end-media]")!.click(); });
    expect(container.querySelector(".player-next")).toBeNull();
    await render({ session: session("https://cdn.test/first.m3u8"), onNext: undefined });
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=end-media]")!.click(); });
    expect(container.querySelector(".player-next")).toBeNull();
  });

  it("replaces streams and releases the previous media player", async () => {
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-src")).toBe("https://cdn.test/first.m3u8");
    cleanup.mockClear();
    await render({ session: session("https://cdn.test/second.m3u8") });
    expect(cleanup).toHaveBeenCalledWith("https://cdn.test/first.m3u8");
    expect(container.querySelector('[data-testid="media"]')?.getAttribute("data-src")).toBe("https://cdn.test/second.m3u8");
  });

  it("shows retry and waits for an explicit external fallback click", async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=fail-media]")!.click(); });
    expect(container.textContent).toContain("fatal HLS error");
    expect(api.openExternal).not.toHaveBeenCalled();
    await act(async () => { button("Open in external player").click(); });
    expect(api.openExternal).toHaveBeenCalledOnce();
  });

  it("leaves fullscreen and reports inactive when unmounted", async () => {
    await press("f");
    vi.mocked(api.setFullscreen).mockClear();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(api.setFullscreen).toHaveBeenCalledWith(false);
    expect(api.setActive).toHaveBeenLastCalledWith(false);
    expect(document.title).toBe("Ani Desktop");
  });
});
