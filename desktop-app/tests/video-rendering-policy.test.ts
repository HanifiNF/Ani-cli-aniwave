import { describe, expect, it, vi } from "vitest";
import {
  configureVideoRenderingPolicy,
  WINDOWS_DIRECT_COMPOSITION_SWITCH,
  WINDOWS_RENDERING_SWITCHES,
  WINDOWS_VIDEO_OVERLAY_SWITCH,
  type CommandLineSwitches
} from "../electron/video-rendering-policy";

function commandLineDouble() {
  const switches = new Set<string>();
  const appendSwitch = vi.fn((name: string) => { switches.add(name); });
  const commandLine: CommandLineSwitches = {
    appendSwitch,
    hasSwitch: (name) => switches.has(name)
  };
  return { appendSwitch, commandLine };
}

describe("video rendering startup policy", () => {
  it("installs both DirectComposition compatibility switches exactly once on Windows", () => {
    const { appendSwitch, commandLine } = commandLineDouble();

    expect(configureVideoRenderingPolicy(commandLine, "win32")).toEqual({
      directCompositionDisabled: true,
      directCompositionVideoOverlaysDisabled: true
    });
    expect(configureVideoRenderingPolicy(commandLine, "win32")).toEqual({
      directCompositionDisabled: true,
      directCompositionVideoOverlaysDisabled: true
    });
    expect(appendSwitch).toHaveBeenCalledTimes(2);
    expect(appendSwitch).toHaveBeenCalledWith(WINDOWS_VIDEO_OVERLAY_SWITCH);
    expect(appendSwitch).toHaveBeenCalledWith(WINDOWS_DIRECT_COMPOSITION_SWITCH);
    expect(appendSwitch.mock.calls.map(([name]) => name)).toEqual(WINDOWS_RENDERING_SWITCHES);
  });

  it.each(["darwin", "linux"] as const)("does not install the switch on %s", (platform) => {
    const { appendSwitch, commandLine } = commandLineDouble();

    expect(configureVideoRenderingPolicy(commandLine, platform)).toEqual({
      directCompositionDisabled: false,
      directCompositionVideoOverlaysDisabled: false
    });
    expect(appendSwitch).not.toHaveBeenCalled();
  });
});
