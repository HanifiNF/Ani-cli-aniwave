import type { CompanionAnimation, CompanionFrequency } from "../shared/companion";

export type CompanionEventKind = "series" | "discover" | "save" | "play" | "pause" | "complete" | "error" | "hello";
export interface CompanionEvent { id: number; kind: CompanionEventKind; title?: string; episode?: string; key?: string }
export interface CompanionLine { text: string; animation: CompanionAnimation }

const LINES: Record<CompanionEventKind, readonly string[]> = {
  series: ["Let's see what {title} has in store.", "A new adventure? I'm in!"],
  discover: ["Found some anime for you!", "Anything catch your eye?"],
  save: ["Saved! We can come back to this one.", "I'll remember this anime."],
  play: ["Episode {episode} is starting. Enjoy!", "Time to watch {title}!"],
  pause: ["Taking a little break?", "I'll wait right here."],
  complete: ["That was a good episode!", "Ready for the next one?"],
  error: ["Oops, something went wrong. Let's try again.", "I'm here. We can retry when you're ready."],
  hello: ["Hi! Ready to watch something?", "I'm glad you're here!"]
};

const ANIMATION: Record<CompanionEventKind, CompanionAnimation> = {
  series: "wave", discover: "jump", save: "wave", play: "jump", pause: "waiting", complete: "review", error: "failed", hello: "wave"
};

const COOLDOWN: Record<CompanionFrequency, number> = { quiet: 120_000, normal: 45_000, chatty: 20_000 };
const PER_EVENT = 300_000;

/** No remote text is executed or inserted as HTML; placeholders are short, plain text only. */
export function companionLine(event: CompanionEvent, alternate = false): CompanionLine {
  const title = (event.title ?? "this anime").replace(/\s+/g, " ").trim().slice(0, 44) || "this anime";
  const episode = (event.episode ?? "").replace(/[^\p{L}\p{N}. -]/gu, "").slice(0, 12) || "this";
  const template = LINES[event.kind][alternate ? 1 : 0];
  return { text: template.replaceAll("{title}", title).replaceAll("{episode}", episode), animation: ANIMATION[event.kind] };
}

/** Keeps one pending high-priority event; the UI consumes it once a cooldown ends. */
export class CompanionDialogueGate {
  private last = -Infinity;
  private seen = new Map<string, number>();
  private pending?: CompanionEvent;

  accept(event: CompanionEvent, frequency: CompanionFrequency, now: number): CompanionEvent | undefined {
    if (event.kind === "hello") { this.last = now; return event; }
    const key = `${event.kind}:${event.key ?? event.title ?? ""}`;
    if (now - (this.seen.get(key) ?? -Infinity) < PER_EVENT) return;
    this.seen.set(key, now);
    if (now - this.last >= COOLDOWN[frequency] || event.kind === "complete" || event.kind === "error") { this.last = now; this.pending = undefined; return event; }
    this.pending = event;
    return;
  }

  next(frequency: CompanionFrequency, now: number): CompanionEvent | undefined {
    if (!this.pending || now - this.last < COOLDOWN[frequency]) return;
    this.last = now;
    const event = this.pending;
    this.pending = undefined;
    return event;
  }

  clear(): void { this.pending = undefined; }
}
