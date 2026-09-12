// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEpisodeMetadata } from "../src/useEpisodeMetadata";
import type { AniDesktopApi, Stream, TranslationMode } from "../shared/contracts";
let container: HTMLDivElement, root: Root;
const streams = vi.fn<AniDesktopApi["streams"]>(), availability = vi.fn<AniDesktopApi["availability"]>(), cancel = vi.fn();
const storedMetadata = vi.fn<AniDesktopApi["episodeMetadata"]>(), clearMetadata = vi.fn<AniDesktopApi["clearEpisodeMetadata"]>();
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
function Harness({ mode = "sub", enabled = true, scope = "a" }: { mode?: TranslationMode; enabled?: boolean; scope?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const metadata = useEpisodeMetadata(list, enabled, ["aniwave:1:1"], "aniwave:1:1", mode, scope);
  return <div ref={list}><div data-episode="aniwave:1:1" /><output>{JSON.stringify(metadata.get("aniwave:1:1"))}</output><button onClick={() => metadata.retry("aniwave:1:1")}>retry</button><button onClick={() => void metadata.refresh()}>refresh</button></div>;
}
const render = async (props: Parameters<typeof Harness>[0] = {}) => { await act(async () => root.render(<Harness {...props} />)); };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  storedMetadata.mockReset().mockResolvedValue(undefined); clearMetadata.mockReset().mockResolvedValue(undefined);
  streams.mockReset(); availability.mockReset(); cancel.mockReset();
  availability.mockResolvedValue({ sub: true, dub: true, checkedAt: Date.now() });
  window.aniDesktop = { streams, availability, episodeMetadata: storedMetadata, clearEpisodeMetadata: clearMetadata, cancelCatalog: cancel } as unknown as AniDesktopApi;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("episode metadata lifecycle", () => {
  it("shows audio availability before the full stream lookup completes", async () => {
    const pending = deferred<Stream[]>(); streams.mockReturnValue(pending.promise); await render();
    expect(container.textContent).toContain('"sub":true'); expect(container.textContent).toContain('"phase":"quality"');
    await act(async () => pending.resolve([{ quality: "1080p", url: "test", provider: "aniwave" }]));
    expect(container.textContent).toContain("1080p");
  });
  it("cancels the old audio lookup and ignores its late quality after switching mode", async () => {
    const pending = deferred<Stream[]>();
    streams.mockImplementation(async (_id, mode) => mode === "sub" ? pending.promise : [{ quality: "480p", url: "test", provider: "aniwave" }]);
    await render(); const oldId = streams.mock.calls[0][2]!.id;
    await render({ mode: "dub" }); expect(cancel).toHaveBeenCalledWith(oldId);
    await act(async () => pending.resolve([{ quality: "1080p", url: "test", provider: "aniwave" }]));
    expect(container.textContent).toContain("480p"); expect(container.textContent).not.toContain("1080p");
  });
  it("cancels on navigation and retries failed metadata explicitly with fresh requests", async () => {
    const pending = deferred<Stream[]>(); streams.mockReturnValueOnce(pending.promise);
    await render(); const oldId = streams.mock.calls[0][2]!.id;
    await render({ enabled: false }); expect(cancel).toHaveBeenCalledWith(oldId);
    await act(async () => pending.resolve([{ quality: "1080p", url: "test", provider: "aniwave" }]));
    streams.mockRejectedValueOnce(new Error("offline")); await render();
    expect(container.textContent).toContain('"phase":"error"');
    streams.mockResolvedValue([{ quality: "720p", url: "test", provider: "aniwave" }]);
    await act(async () => container.querySelector("button")!.click());
    expect(availability.mock.calls.at(-1)?.[1]?.refresh).toBe(true);
    expect(streams.mock.calls.at(-1)?.[2]?.refresh).toBe(true);
    expect(container.textContent).toContain("720p");
  });
  it("does not resolve video hosts when the requested audio is unavailable", async () => {
    availability.mockResolvedValue({ sub: true, dub: false, checkedAt: Date.now() }); await render({ mode: "dub" });
    expect(streams).not.toHaveBeenCalled(); expect(container.textContent).toContain('"dub":false');
  });
  it("restores fresh metadata on mount and revisit without provider requests", async () => {
    storedMetadata.mockResolvedValue({ availability: { sub: true, dub: true, checkedAt: Date.now() }, qualities: { sub: { quality: "1080p", checkedAt: Date.now() } } });
    await render(); await render({ enabled: false }); await render();
    expect(container.textContent).toContain("1080p");
    expect(availability).not.toHaveBeenCalled(); expect(streams).not.toHaveBeenCalled();
  });
  it("retains expired badges during refresh and a provider failure", async () => {
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    storedMetadata.mockResolvedValue({ availability: { sub: true, dub: true, checkedAt: yesterday }, qualities: { sub: { quality: "1080p", checkedAt: yesterday } } });
    const pending = deferred<Stream[]>(); streams.mockReturnValue(pending.promise);
    await render();
    expect(container.textContent).toContain("1080p"); expect(container.textContent).toContain('"phase":"quality"');
    await render({ enabled: false });
    streams.mockRejectedValue(new Error("offline")); await render();
    expect(container.textContent).toContain("1080p"); expect(container.textContent).toContain('"phase":"error"');
  });
  it("checks newly available dubs while reusing the cached sub resolution", async () => {
    storedMetadata.mockResolvedValue({ availability: { sub: true, dub: false, checkedAt: Date.now() - 16 * 60 * 1000 }, qualities: { sub: { quality: "720p", checkedAt: Date.now() } } });
    await render();
    expect(availability).toHaveBeenCalledTimes(1); expect(streams).not.toHaveBeenCalled();
    expect(container.textContent).toContain('"dub":true'); expect(container.textContent).toContain("720p");
  });
  it("forces fresh requests after clearing a series cache", async () => {
    storedMetadata.mockResolvedValue({ availability: { sub: true, dub: true, checkedAt: Date.now() }, qualities: { sub: { quality: "480p", checkedAt: Date.now() } } });
    await render();
    streams.mockResolvedValue([{ quality: "1080p", url: "test", provider: "aniwave" }]);
    await act(async () => container.querySelectorAll("button")[1].click());
    expect(clearMetadata).toHaveBeenCalledWith(["aniwave:1:1"]);
    expect(availability.mock.calls.at(-1)?.[1]?.refresh).toBe(true);
    expect(streams.mock.calls.at(-1)?.[2]?.refresh).toBe(true);
    expect(container.textContent).toContain("1080p");
  });
  it("ignores a cached read completed after leaving the series", async () => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodeMetadata"]>>>();
    storedMetadata.mockReturnValue(pending.promise); await render(); await render({ enabled: false });
    await act(async () => pending.resolve({ availability: { sub: true, dub: true, checkedAt: Date.now() }, qualities: {} }));
    expect(availability).not.toHaveBeenCalled(); expect(streams).not.toHaveBeenCalled();
  });
});
