import type { CompanionAnimation, CompanionFrequency } from "../shared/companion";

export type CompanionSection = "home" | "browse" | "saved" | "recent" | "notifications" | "settings";
export type CompanionEventKind = "series" | "section" | "startup-update" | "startup-continue" | "discover" | "save" | "play" | "pause" | "complete" | "error" | "hello";
export interface CompanionEvent { id: number; kind: CompanionEventKind; title?: string; episode?: string; key?: string; section?: CompanionSection; otherCount?: number; targetId?: string }
/** `title` is the title as it appears in `text`, when the line names one, so the bubble can set it apart. */
export interface CompanionLine { text: string; animation: CompanionAnimation; title?: string }

export const guaranteedCompanionEvent = (kind: CompanionEventKind) => kind === "series" || kind === "section" || kind === "startup-update" || kind === "startup-continue" || kind === "hello";

const SECTION_LINES: Record<CompanionSection, readonly [string, string]> = {
  home: ["Welcome home! What shall we watch?", "Back home! Your anime is waiting."],
  browse: ["Let's find something new to watch!", "What kind of anime are we looking for?"],
  saved: ["Here are the anime you saved for later.", "Your saved anime are right here!"],
  recent: ["Want to pick up where you left off?", "Here's what you've watched recently."],
  notifications: ["Let's see what's new!", "Any new episodes waiting for us?"],
  settings: ["Let's make things just right for you.", "Want to customize your experience?"]
};

const LINES: Record<CompanionEventKind, readonly string[]> = {
  series: ["Let's see what {title} has in store.", "A new adventure with {title}? I'm in!"],
  section: SECTION_LINES.home,
  "startup-update": ["Episode {episode} of {title} is new!", "A new episode of {title} is here: {episode}!"],
  "startup-continue": ["Want to continue {title}?", "Ready to pick up {title} again?"],
  discover: ["Found some anime for you!", "Anything catch your eye?"],
  save: ["Saved! We can come back to this one.", "I'll remember this anime."],
  play: ["Episode {episode} is starting. Enjoy!", "Time to watch {title}!"],
  pause: ["Taking a little break?", "I'll wait right here."],
  complete: ["That was a good episode!", "Ready for the next one?"],
  error: ["Oops, something went wrong. Let's try again.", "I'm here. We can retry when you're ready."],
  hello: ["Hi! Ready to watch something?", "I'm glad you're here!"]
};

const ANIMATION: Record<CompanionEventKind, CompanionAnimation> = {
  series: "wave", section: "wave", "startup-update": "jump", "startup-continue": "wave", discover: "jump", save: "wave", play: "jump", pause: "waiting", complete: "review", error: "failed", hello: "wave"
};

const COOLDOWN: Record<CompanionFrequency, number> = { quiet: 120_000, normal: 45_000, chatty: 20_000 };
const PER_EVENT = 300_000;

/** No remote text is executed or inserted as HTML; placeholders are short, plain text only. */
export function companionLine(event: CompanionEvent, alternate = false): CompanionLine {
  const title = (event.title ?? "this anime").replace(/\s+/g, " ").trim().slice(0, 44) || "this anime";
  const episode = (event.episode ?? "").replace(/[^\p{L}\p{N}. -]/gu, "").slice(0, 12) || "this";
  const template = event.kind === "section" ? SECTION_LINES[event.section ?? "home"][alternate ? 1 : 0] : LINES[event.kind][alternate ? 1 : 0];
  const base = template.replaceAll("{title}", title).replaceAll("{episode}", episode);
  const extra = event.kind === "startup-update" && event.otherCount && event.otherCount > 0 ? ` Plus ${Math.min(999, event.otherCount)} other unread ${event.otherCount === 1 ? "update" : "updates"}.` : "";
  return { text: base + extra, animation: ANIMATION[event.kind], title: template.includes("{title}") ? title : undefined };
}

/** Keeps one pending high-priority event; the UI consumes it once a cooldown ends. */
export class CompanionDialogueGate {
  private last = -Infinity;
  private seen = new Map<string, number>();
  private pending?: CompanionEvent;

  accept(event: CompanionEvent, frequency: CompanionFrequency, now: number): CompanionEvent | undefined {
    if (guaranteedCompanionEvent(event.kind)) { this.last = now; this.pending = undefined; return event; }
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
