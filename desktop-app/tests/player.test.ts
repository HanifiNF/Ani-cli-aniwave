import { describe, expect, it } from "vitest";
import { playerArguments } from "../electron/player";

const request = { url: "https://cdn.example.test/episode.m3u8", title: "Example — Episode 1" };

describe("playerArguments", () => {
  it("passes the stream referrer to IINA and disables stdin detection", () => {
    expect(playerArguments("/Applications/IINA.app/Contents/MacOS/iina-cli", {
      ...request, referrer: "https://play.test/embed"
    })).toEqual([
      "--no-stdin", "--mpv-demuxer-lavf-format=hls", "--mpv-fullscreen=yes", `--mpv-force-media-title=${request.title}`,
      "--mpv-referrer=https://play.test/embed", request.url
    ]);
  });

  it("opens IINA streams without a referrer when none is provided", () => {
    expect(playerArguments("iina-cli", request)).toEqual([
      "--no-stdin", "--mpv-demuxer-lavf-format=hls", "--mpv-fullscreen=yes", `--mpv-force-media-title=${request.title}`, request.url
    ]);
  });

  it("identifies extensionless provider playlists as HLS for IINA", () => {
    const url = "https://cdn.example.test/cdn/opaque-token";
    const args = playerArguments("/Applications/IINA.app/Contents/MacOS/iina-cli", { ...request, url });
    expect(args).toContain("--mpv-demuxer-lavf-format=hls");
    expect(args.at(-1)).toBe(url);
  });

  it("adds the media title option for mpv", () => {
    expect(playerArguments("mpv.exe", request)).toEqual([
      "--fullscreen",
      "--force-media-title=Example — Episode 1",
      request.url
    ]);
  });

  it("uses VLC-compatible title and referrer options", () => {
    expect(playerArguments("C:\\Program Files\\VideoLAN\\VLC\\vlc.exe", { ...request, referrer: "https://play.test/embed" })).toEqual([
      "--no-one-instance", "--no-qt-start-minimized", "--no-qt-system-tray", "--fullscreen", "--play-and-exit", "--meta-title=Example — Episode 1", "--http-referrer=https://play.test/embed", request.url
    ]);
  });

  it("omits fullscreen switches for windowed external playback", () => {
    expect(playerArguments("mpv.exe", request, false)).toEqual(["--force-media-title=Example — Episode 1", request.url]);
    expect(playerArguments("C:\\Program Files\\VideoLAN\\VLC\\vlc.exe", request, false)).not.toContain("--fullscreen");
    expect(playerArguments("iina-cli", request, false)).not.toContain("--mpv-fullscreen=yes");
  });
});
