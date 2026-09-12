// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SourceStatusPanel from "../src/SourceStatusPanel";
import type { AniDesktopApi, ProviderSourceStatus } from "../shared/contracts";
import { StateStore } from "../electron/state";

const settings = new StateStore("unused").snapshot().settings;
const sourceStatus = vi.fn<AniDesktopApi["sourceStatus"]>(), checkSource = vi.fn<AniDesktopApi["checkSource"]>(), cancel = vi.fn();
const onChange = vi.fn();
let container: HTMLDivElement, root: Root;
const status = (state: ProviderSourceStatus["state"] = "paused", canRetry = true): ProviderSourceStatus[] => [
  { provider: "anidb", origin: "https://anidb.app", state, canRetry, checkedAt: Date.now(), retryAt: Date.now() + 120_000, serverRequested: !canRetry }
];
const button = () => container.querySelector<HTMLButtonElement>('[aria-label="Check AniDB now"]')!;
const render = async (draft = settings) => { await act(async () => root.render(<SourceStatusPanel saved={settings} draft={draft} onChange={onChange} />)); };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sourceStatus.mockReset().mockResolvedValue(status()); checkSource.mockReset().mockResolvedValue(undefined); cancel.mockReset();
  onChange.mockClear();
  window.aniDesktop = { sourceStatus, checkSource, cancelCatalog: cancel } as unknown as AniDesktopApi;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows local outage status without issuing a provider check", async () => {
  await render();
  expect(container.textContent).toContain("Paused"); expect(container.textContent).toContain("2m");
  expect(button().textContent).toBe("Retry"); expect(checkSource).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(sourceStatus).toHaveBeenCalledTimes(2); expect(checkSource).not.toHaveBeenCalled();
});

it("checks only the selected source, prevents duplicate clicks, and refreshes its status", async () => {
  let finish!: () => void;
  checkSource.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await act(async () => { button().click(); button().click(); });
  expect(checkSource).toHaveBeenCalledExactlyOnceWith("anidb", expect.objectContaining({ checkNow: true, refresh: true }));
  expect(button().disabled).toBe(true); expect(container.textContent).toContain("Checking");
  sourceStatus.mockResolvedValue(status("reachable")); await act(async () => finish());
  expect(container.textContent).toContain("Reachable"); expect(button().disabled).toBe(false);
});

it("respects server delays and unsaved source addresses", async () => {
  sourceStatus.mockResolvedValue(status("paused", false)); await render();
  expect(button().disabled).toBe(true); expect(container.textContent).toContain("server requested a wait");
  sourceStatus.mockResolvedValue(status());
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(button().disabled).toBe(false);
  const field = container.querySelector<HTMLInputElement>('[aria-label="AniDB address"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "https://new.test");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({ ...settings, anidbBaseUrl: "https://new.test" });
  await render({ ...settings, anidbBaseUrl: "https://new.test" });
  expect(button().disabled).toBe(true); expect(container.textContent).toContain("Save this address before checking");
  expect(checkSource).not.toHaveBeenCalled();
});

it("cancels checks when Settings closes and ignores late completion", async () => {
  let finish!: () => void;
  checkSource.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await act(async () => button().click());
  const id = checkSource.mock.calls[0][1]!.id;
  await act(async () => root.render(null)); expect(cancel).toHaveBeenCalledWith(id);
  const reads = sourceStatus.mock.calls.length;
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(4000); });
  expect(sourceStatus).toHaveBeenCalledTimes(reads);
});

it("switches a source off, resets a matching preference, and blocks checks while off", async () => {
  await render({ ...settings, preferredProvider: "anidb" });
  const toggle = () => container.querySelector<HTMLButtonElement>('[aria-label="Use AniDB"]')!;
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle().click());
  expect(onChange).toHaveBeenLastCalledWith({ ...settings, preferredProvider: "auto", disabledSources: ["anidb"] });
  await render({ ...settings, disabledSources: ["anidb"] });
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(button().disabled).toBe(true); expect(container.textContent).toContain("Off");
  await act(async () => toggle().click());
  expect(onChange).toHaveBeenLastCalledWith({ ...settings, preferredProvider: "auto", disabledSources: [] });
});

it("shows check failures alongside the updated cooldown", async () => {
  checkSource.mockRejectedValue(new Error("Source offline")); await render();
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Source offline");
  expect(container.textContent).toContain("Paused"); expect(button().disabled).toBe(false);
});
