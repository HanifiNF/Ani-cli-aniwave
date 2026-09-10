export const WINDOWS_VIDEO_OVERLAY_SWITCH = "disable-direct-composition-video-overlays";
export const WINDOWS_DIRECT_COMPOSITION_SWITCH = "disable-direct-composition";
export const WINDOWS_RENDERING_SWITCHES = [
  WINDOWS_VIDEO_OVERLAY_SWITCH,
  WINDOWS_DIRECT_COMPOSITION_SWITCH
] as const;

export interface CommandLineSwitches {
  hasSwitch(name: string): boolean;
  appendSwitch(name: string, value?: string): void;
}

export interface VideoRenderingPolicy {
  directCompositionDisabled: boolean;
  directCompositionVideoOverlaysDisabled: boolean;
}

export function configureVideoRenderingPolicy(
  commandLine: CommandLineSwitches,
  platform: NodeJS.Platform = process.platform
): VideoRenderingPolicy {
  const windowsCompatibility = platform === "win32";
  if (windowsCompatibility) {
    for (const name of WINDOWS_RENDERING_SWITCHES) {
      if (!commandLine.hasSwitch(name)) commandLine.appendSwitch(name);
    }
  }
  return {
    directCompositionDisabled: windowsCompatibility,
    directCompositionVideoOverlaysDisabled: windowsCompatibility
  };
}
