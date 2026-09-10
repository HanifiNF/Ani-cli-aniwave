import type { MediaStorage } from "@vidstack/react";
import type { AniPlayerApi, PlayerSession, PlayerStorageUpdate } from "../shared/contracts";

/** Preferences are global; position belongs to the stable episode ID in the main process. */
export class DesktopMediaStorage implements MediaStorage {
  private data: PlayerStorageUpdate;
  private lastSavedTime = -1;
  private pending: PlayerStorageUpdate = {};
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private session: PlayerSession, private api: AniPlayerApi, private onError: (error: unknown) => void) {
    this.data = { ...session.preferences, time: session.position?.completed ? 0 : session.position?.time ?? 0 };
  }

  async getVolume() { return this.data.volume ?? null; }
  async getMuted() { return this.data.muted ?? null; }
  async getPlaybackRate() { return this.data.rate ?? null; }
  async getLang() { return this.data.lang ?? null; }
  async getCaptions() { return this.data.captions ?? null; }
  async getTime() { return this.data.time ?? null; }
  async getVideoQuality() { return null; }
  async getAudioGain() { return null; }
  async setVolume(volume: number) { this.update({ volume }); }
  async setMuted(muted: boolean) { this.update({ muted }); }
  async setPlaybackRate(rate: number) { this.update({ rate }); }
  async setLang(lang: string | null) { this.update({ lang }); }
  async setCaptions(captions: boolean) { this.update({ captions }); }
  async setTime(time: number, completed = false) {
    if (!Number.isFinite(time) || time < 0) return;
    this.data.time = completed ? 0 : time;
    // Keep the latest exact position for pause/close; write periodically during playback.
    this.pending = { ...this.pending, time: this.data.time, completed };
    if (completed || Math.abs(time - this.lastSavedTime) >= 2) {
      this.lastSavedTime = time;
      this.schedule();
    }
  }

  private update(value: PlayerStorageUpdate) {
    if (Object.entries(value).every(([key, next]) => this.data[key as keyof PlayerStorageUpdate] === next)) return;
    Object.assign(this.data, value);
    Object.assign(this.pending, value);
    this.schedule();
  }
  private schedule() { this.timer ??= setTimeout(() => this.flush(), 200); }
  flush = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    const update = this.pending;
    this.pending = {};
    if (Object.keys(update).length) void this.api.saveStorage(this.session.id, update).catch(this.onError);
  };
  onDestroy() { this.flush(); }
}
