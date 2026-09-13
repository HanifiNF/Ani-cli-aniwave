// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BookmarkMetadataPanel from "../src/BookmarkMetadataPanel";
import type { AniDesktopApi, BookmarkMetadataProgress } from "../shared/contracts";
import { StateStore } from "../electron/state";

const settings = new StateStore("unused").snapshot().settings;
const fetchMetadata = vi.fn<AniDesktopApi["fetchBookmarkMetadata"]>(), cancel = vi.fn<AniDesktopApi["cancelBookmarkMetadata"]>(), status = vi.fn<AniDesktopApi["bookmarkMetadataStatus"]>();
let latest: BookmarkMetadataProgress | undefined;
const result: BookmarkMetadataProgress = { state: "completed", seriesTotal: 2, seriesDone: 2, episodesDone: 10, updatedEpisodes: 6, cachedEpisodes: 4, failedEpisodes: 0, skippedSources: [] };
let container: HTMLDivElement, root: Root;
const button = () => container.querySelector<HTMLButtonElement>("button")!;
const render = async (count = 2, draft = settings) => { await act(async () => root.render(<BookmarkMetadataPanel count={count} saved={settings} draft={draft} />)); };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  latest = undefined;
  fetchMetadata.mockReset().mockImplementation(async () => { latest = result; return latest; });
  cancel.mockReset().mockImplementation(async () => { latest = { ...result, state: "cancelling" }; return latest; });
  status.mockReset().mockImplementation(async () => latest);
  window.aniDesktop = { fetchBookmarkMetadata: fetchMetadata, bookmarkMetadataStatus: status, cancelBookmarkMetadata: cancel } as unknown as AniDesktopApi;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("fetches only on click and shows the completed cache counts", async () => {
  await render(); expect(fetchMetadata).not.toHaveBeenCalled();
  await act(async () => { button().click(); button().click(); });
  expect(fetchMetadata).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Bookmark metadata is ready");
  expect(container.textContent).toContain("6 episode records updated · 4 already fresh");
  expect(button().disabled).toBe(false);
});

it("restores a running job after leaving Settings and can cancel it from the reopened page", async () => {
  fetchMetadata.mockImplementation(async () => { latest = { ...result, state: "running", seriesDone: 1, currentSeries: "Frieren" }; return latest; });
  await render(); await act(async () => button().click());
  expect(container.textContent).toContain("Fetching: Frieren");
  await act(async () => root.render(null));
  expect(cancel).not.toHaveBeenCalled();
  const reads = status.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(status).toHaveBeenCalledTimes(reads);
  await render();
  expect(container.textContent).toContain("Fetching: Frieren");
  expect(button().textContent).toBe("Cancel fetch");
  expect(fetchMetadata).toHaveBeenCalledTimes(1);
  await act(async () => button().click());
  expect(cancel).toHaveBeenCalledTimes(1); expect(button().disabled).toBe(true);
  latest = { ...result, state: "cancelled", seriesDone: 1 };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.textContent).toContain("Fetch cancelled. Completed metadata is saved.");
});

it("shows completion or failure reached while Settings was closed", async () => {
  latest = { ...result, state: "running" };
  await render(); await act(async () => root.render(null));
  latest = result;
  await render(); expect(container.textContent).toContain("Bookmark metadata is ready");
  await act(async () => root.render(null));
  latest = { ...result, state: "failed", error: "Catalog unavailable" };
  await render(); expect(container.querySelector('[role="alert"]')?.textContent).toBe("Catalog unavailable");
  expect(button().disabled).toBe(false); expect(fetchMetadata).not.toHaveBeenCalled();
});

it("ignores a stale status response that arrives after a new job starts", async () => {
  await render();
  let finish!: (value: BookmarkMetadataProgress) => void;
  status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  fetchMetadata.mockResolvedValue({ ...result, state: "running", currentSeries: "New job" });
  await act(async () => button().click());
  await act(async () => finish(result));
  expect(container.textContent).toContain("Fetching: New job");
});

it("requires bookmarks and saved enabled source settings", async () => {
  await render(0); expect(button().disabled).toBe(true);
  await render(2, { ...settings, aniwaveBaseUrl: "https://new.test" });
  expect(button().disabled).toBe(true); expect(container.textContent).toContain("Save source changes");
  await render(2, { ...settings, disabledSources: ["aniwave"] }); expect(button().disabled).toBe(true);
  const off = { ...settings, disabledSources: ["aniwave", "anidb", "hianime"] as const };
  await act(async () => root.render(<BookmarkMetadataPanel count={2} saved={{ ...off, disabledSources: [...off.disabledSources] }} draft={{ ...off, disabledSources: [...off.disabledSources] }} />));
  expect(button().disabled).toBe(true); expect(fetchMetadata).not.toHaveBeenCalled();
});

it("reports partial failures and allows another run", async () => {
  fetchMetadata.mockResolvedValue({ ...result, failedEpisodes: 1, skippedSources: ["anidb"] });
  await render(); await act(async () => button().click());
  expect(container.textContent).toContain("Finished with some metadata unavailable");
  expect(container.textContent).toContain("Sources skipped: anidb");
  fetchMetadata.mockRejectedValue(new Error("Fetch unavailable"));
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Fetch unavailable");
  expect(button().disabled).toBe(false);
});
