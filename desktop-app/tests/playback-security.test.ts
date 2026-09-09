import { describe, expect, it } from "vitest";
import { isPlaybackRequest, validatePlayRequest, withMediaCors, withPlaybackReferrer } from "../electron/playback-security";

describe("built-in playback security", () => {
  it("accepts only HTTP media and referrer URLs", () => {
    expect(validatePlayRequest({
      url: "https://cdn.test/video.m3u8", title: "Example episode", referrer: "https://embed.test/watch"
    })).toEqual({
      url: "https://cdn.test/video.m3u8", title: "Example episode", referrer: "https://embed.test/watch"
    });
    expect(() => validatePlayRequest({ url: "file:///secret", title: "Example" })).toThrow(/playback URL/);
    expect(() => validatePlayRequest({ url: "https://cdn.test/video", title: "Example", referrer: "javascript:alert(1)" })).toThrow(/referrer URL/);
  });

  it("adds the provider referrer without discarding media request headers", () => {
    expect(withPlaybackReferrer({ Accept: "video/*", referer: "https://old.test" }, "https://embed.test/watch")).toEqual({
      Accept: "video/*", Referer: "https://embed.test/watch"
    });
  });

  it("replaces conflicting CORS values only inside the caller-provided response", () => {
    expect(withMediaCors({ Server: ["test"], "access-control-allow-origin": ["https://wrong.test"] })).toEqual({
      Server: ["test"],
      "Access-Control-Allow-Origin": ["*"],
      "Access-Control-Allow-Methods": ["GET, HEAD, OPTIONS"],
      "Access-Control-Allow-Headers": ["*"]
    });
  });

  it("rewrites headers for stream traffic only, leaving posters and page assets alone", () => {
    expect(["xhr", "media"].every(isPlaybackRequest)).toBe(true);
    expect(["image", "mainFrame", "script", "stylesheet", "font", "webSocket"].some(isPlaybackRequest)).toBe(false);
  });
});
