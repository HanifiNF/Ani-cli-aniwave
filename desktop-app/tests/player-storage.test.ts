import { describe, expect, it, vi } from "vitest";
import { DesktopMediaStorage } from "../src/player-storage";
import { validateStorageUpdate } from "../shared/playback";
import type { AniPlayerApi, PlayerSession } from "../shared/contracts";

const session: PlayerSession = { id: "session-1", request: { url: "https://cdn.test/first", title: "Episode" },
  canOpenExternal: false, fullscreen:false, preferences: { volume:0.4, muted:true, rate:1.5, captions:true, lang:"en" },
  position: { time:123, completed:false, updatedAt:"" } };

it("restores preferences and flushes the latest position on destruction", async () => {
  const saveStorage=vi.fn().mockResolvedValue(undefined);
  const storage=new DesktopMediaStorage(session,{saveStorage} as unknown as AniPlayerApi,vi.fn());
  expect(await storage.getTime()).toBe(123);
  expect(await storage.getVolume()).toBe(0.4);
  expect(await storage.getMuted()).toBe(true);
  expect(await storage.getPlaybackRate()).toBe(1.5);
  expect(await storage.getCaptions()).toBe(true);
  expect(await storage.getLang()).toBe("en");
  await storage.setTime(124.2); await storage.setTime(125.1); await storage.setVolume(0.5);
  storage.onDestroy();
  expect(saveStorage).toHaveBeenCalledExactlyOnceWith("session-1",{time:125.1,completed:false,volume:0.5});
});

it("replays completed episodes from the beginning and reports save failures", async () => {
  const failed=vi.fn();
  const storage=new DesktopMediaStorage({...session,position:{time:120,completed:true,updatedAt:""}},
    {saveStorage:vi.fn().mockRejectedValue(new Error("disk full"))} as unknown as AniPlayerApi,failed);
  expect(await storage.getTime()).toBe(0);
  await storage.setTime(200,true); storage.flush(); await Promise.resolve();
  expect(await storage.getTime()).toBe(0);
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({message:"disk full"}));
});

describe("player IPC storage validation",()=>{
  it.each([{time:NaN},{time:Infinity},{time:-1},{volume:2},{rate:20},{captions:"yes"},{lang:{}}])("rejects invalid values %o",value=>{
    expect(()=>validateStorageUpdate(value)).toThrow();
  });
  it("accepts only known preference fields",()=>{
    expect(validateStorageUpdate({volume:0.25,time:14,completed:false,episodeId:"another-episode"})).toEqual({volume:0.25,time:14,completed:false});
  });
});
