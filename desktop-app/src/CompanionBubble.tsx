import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./icons";
import { springCurve } from "./motion";
import { play } from "./transition";

export interface BubbleMessage { id: number; text: string; title?: string; action?: string }
export interface BubbleCountdown { total: number; remaining: number; running: boolean; run: number }
/** Where the bubble sits against the pet: `offset` is its outer edge's distance in from the pet's (left, or right when `end`). */
export interface BubblePlacement { end: boolean; below: boolean; offset: number; tail: number; lift: number }

interface Props {
  message?: BubbleMessage; countdown?: BubbleCountdown; placement: BubblePlacement;
  onAction: () => void; onDismiss: () => void; onHold: (held: boolean) => void;
}

const OUT = springCurve("out");
// The arc's circumference: r = 9.5 in a 22 box.
const ARC = 2 * Math.PI * 9.5;

/** The time left, as an arc around the dismiss button that drains while the countdown runs. */
function Countdown({ total, remaining, running, run }: BubbleCountdown) {
  const from = ARC * (1 - remaining / total);
  return <svg className="companion-arc" viewBox="0 0 22 22" aria-hidden="true">
    <circle key={run} cx="11" cy="11" r="9.5" strokeDasharray={ARC}
      style={{ strokeDashoffset: from, animation: running ? `companion-drain ${remaining}ms linear forwards` : "none" }} />
  </svg>;
}

/** The line names the title as it was given; set it apart from the words around it. */
function Line({ text, title }: { text: string; title?: string }) {
  const at = title ? text.indexOf(title) : -1;
  if (!title || at < 0) return <p>{text}</p>;
  return <p>{text.slice(0, at)}<b className="companion-title">{title}</b>{text.slice(at + title.length)}</p>;
}

/**
 * A speech bubble whose tail points at the pet's head. It grows from the tail on the glide spring, holds its countdown
 * while the pointer or focus is on it, and after its message ends it stays for the quick exit before it leaves the page.
 */
export default function CompanionBubble({ message, countdown, placement, onAction, onDismiss, onHold }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [kept, setKept] = useState(message);
  if (message && message.id !== kept?.id) setKept(message);
  const closing = !message && Boolean(kept);
  useLayoutEffect(() => {
    if (!closing) return;
    const run = play(ref.current, [{ opacity: 0, transform: `translateY(${placement.below ? -6 : 6}px) scale(.94)` }], { duration: OUT.ms, easing: OUT.easing, fill: "forwards" });
    if (!run) { setKept(undefined); return; }
    void run.finished.then(() => setKept(undefined), () => undefined);
    return () => run.cancel();
  }, [closing]);
  const shown = message ?? kept;
  if (!shown) return null;
  const { end, below, offset, tail, lift } = placement;
  const style = { [end ? "right" : "left"]: offset, [below ? "top" : "bottom"]: lift, "--tail": `${tail}px` } as CSSProperties;
  return <div key={shown.id} ref={ref} className={`companion-bubble${end ? " end" : ""}${below ? " below" : ""}${closing ? " closing" : ""}`} style={style} role="status"
    onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)}
    onFocus={() => onHold(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold(false); }}>
    <Line text={shown.text} title={shown.title} />
    {shown.action && <button type="button" className="companion-action" onClick={onAction}>{shown.action}<Icon name="chevron" /></button>}
    <button type="button" className="companion-dismiss" aria-label="Dismiss companion message" onClick={onDismiss}>
      <Icon name="x" />{countdown && !closing && <Countdown {...countdown} />}
    </button>
  </div>;
}
