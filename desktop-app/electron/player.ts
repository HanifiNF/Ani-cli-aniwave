import { basename } from "node:path";
import type { PlayRequest } from "../shared/contracts";

export function playerArguments(playerPath: string, request: PlayRequest): string[] {
  const executable = basename(playerPath).toLowerCase();

  if (executable === "mpv" || executable === "mpv.exe") {
    return ["--fullscreen", `--force-media-title=${request.title}`, ...(request.referrer ? [`--referrer=${request.referrer}`] : []), request.url];
  }

  if (executable === "vlc" || executable === "vlc.exe") {
    return [
      // Do not hand playback to an older VLC process that may be hidden in the
      // notification area. Always create a visible window for this request.
      "--no-one-instance",
      "--no-qt-start-minimized",
      "--no-qt-system-tray",
      "--fullscreen",
      "--play-and-exit",
      `--meta-title=${request.title}`,
      ...(request.referrer ? [`--http-referrer=${request.referrer}`] : []),
      request.url
    ];
  }

  // VLC and most other desktop players accept the media URL directly. Avoid
  // passing mpv-specific switches, which cause VLC to reject the launch.
  return [request.url];
}
