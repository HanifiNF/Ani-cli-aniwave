// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotice, UpdatePanel, updatePending } from "../src/UpdateUI";
import type { UpdateInstallStatus } from "../shared/contracts";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("update UI", () => {
  it("offers download progress, install and restart, manual opening, and retry", async () => {
    const download = vi.fn(), install = vi.fn();
    const render = async (phase: UpdateInstallStatus["phase"], mode: UpdateInstallStatus["mode"] = "automatic") => act(async () => root.render(
      <UpdatePanel status={{ state: "available", currentVersion: "1.0.0", latestVersion: "1.1.0" }} checking={false}
        onCheck={vi.fn()} onOpen={vi.fn()} onSkip={vi.fn()} onDownload={download} onInstall={install}
        installStatus={{ mode, phase, detail: "Platform instructions", version: "1.1.0", percent: 42, ...(phase === "error" ? { error: "Update failed" } : {}) }} />));
    const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
    await render("idle");
    // At rest the offer is one line: the install instructions wait until there is something to install.
    expect(container.textContent).not.toContain("Platform instructions");
    await act(async () => button("Download update").click());
    expect(download).toHaveBeenCalledOnce();
    await render("downloading");
    expect(button("Downloading 42%").disabled).toBe(true);
    expect(button("skip").disabled).toBe(true);
    await render("ready");
    await act(async () => button("Install and restart").click());
    expect(install).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Version 1.1.0 is ready");
    expect(container.textContent).toContain("Platform instructions");
    await render("ready", "manual");
    expect(button("Open download")).toBeDefined();
    await render("error");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Update failed");
    expect(button("Download update").disabled).toBe(false);
    await render("idle", "native");
    await act(async () => button("Install update…").click());
    expect(download).toHaveBeenCalledTimes(2);
    await render("idle", "unsupported");
    expect(button("Download update")).toBeUndefined();
    expect(button("View release")).toBeDefined();
  });
  it("links to the Updates row from the Settings heading until the version is skipped", async () => {
    const jump = vi.fn();
    await act(async () => root.render(<UpdateNotice status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available" }} onJump={jump} />));
    expect(container.textContent).toContain("v1.1.0 available");
    await act(async () => container.querySelector<HTMLButtonElement>(".update-notice")!.click());
    expect(jump).toHaveBeenCalledOnce();
    expect(updatePending({ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available" })).toBe(true);

    await act(async () => root.render(<UpdateNotice status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true }} onJump={jump} />));
    expect(container.querySelector(".update-notice")).toBeNull();
    expect(updatePending({ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true })).toBe(false);
    expect(updatePending({ currentVersion: "1.0.0", state: "current" })).toBe(false);
  });

  it("opens the release from the version title and offers a quiet skip", async () => {
    const check = vi.fn(), open = vi.fn(), skip = vi.fn();
    const click = (label: string) => act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === label)!.click());
    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", checkedAt: 1 }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("Version 1.1.0 is available");
    expect(container.textContent).toContain("You have 1.0.0");
    await click("Version 1.1.0 is available"); await click("View release"); await click("skip");
    expect(open).toHaveBeenCalledTimes(2); expect(skip).toHaveBeenCalledOnce();
    // A known version needs no manual check; the hourly check finds anything newer.
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Version 1.1.0 is available", "skip", "View release"]);

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Version 1.1.0 is available", "View release"]);
    expect(container.textContent).toContain("skipped");
  });

  it("shows current, stale, error, and development states in Settings", async () => {
    const check = vi.fn(), open = vi.fn(), skip = vi.fn();
    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.0.0", state: "current", checkedAt: 1 }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("up to date");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "check now")!.click());
    expect(check).toHaveBeenCalledOnce();

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", stale: true, error: "Could not check for updates" }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("Showing the last valid result");
    expect(container.textContent).toContain("Could not check for updates");

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", state: "development" }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("disabled while running from source");
  });
});
