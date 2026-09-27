import { useLayoutEffect, useRef } from "react";
import { Edges, rubber, velocityTracker } from "./motion";

// The knob's left edge runs from 3px (off) to 17px (on); it is 16px wide.
const OFF = 3, ON = 17, KNOB = 16, DRAG = 3;

/**
  An on/off control for a single boolean setting; choices between named options stay as chips. The knob moves on two
  edges, so it stretches toward the new side. It can be dragged: it follows the pointer exactly, stretches with
  resistance past either end, and on release springs to the side it was thrown toward, keeping its speed.
*/
export default function Switch({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  const knob = useRef<HTMLElement>(null);
  const edges = useRef<Edges>(null);
  const drag = useRef<{ pointer: number; x: number; from: number; moved: boolean; tracker: ReturnType<typeof velocityTracker> }>(null);
  const release = useRef<number | undefined>(undefined);
  const skipClick = useRef(false);

  edges.current ??= new Edges((start, end) => {
    if (knob.current) { knob.current.style.left = `${start}px`; knob.current.style.width = `${end - start}px`; }
    button.current?.style.setProperty("--on", String(Math.min(1, Math.max(0, (start - OFF) / (ON - OFF)))));
  });
  const first = useRef(true);
  useLayoutEffect(() => {
    const at = checked ? ON : OFF;
    edges.current!.to(at, at + KNOB, { instant: first.current, velocity: release.current });
    first.current = false; release.current = undefined;
  }, [checked]);

  const down = (event: React.PointerEvent<HTMLButtonElement>) => {
    skipClick.current = false;
    if (event.button !== 0 || disabled) return;
    const tracker = velocityTracker();
    tracker.add(event.clientX, 0);
    drag.current = { pointer: event.pointerId, x: event.clientX, from: edges.current!.a.x, moved: false, tracker };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) <= DRAG) return;
    state.moved = true;
    state.tracker.add(event.clientX, 0);
    let at = state.from + dx;
    if (at < OFF) at = OFF + rubber(at - OFF, 6);
    if (at > ON) at = ON + rubber(at - ON, 6);
    edges.current!.hold(at, at + KNOB);
  };
  const up = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    drag.current = null;
    if (!state.moved) return; // A tap: the click that follows toggles.
    skipClick.current = true;
    const velocity = state.tracker.velocity().x;
    const next = edges.current!.a.x + velocity * 0.08 > (OFF + ON) / 2;
    if (next === checked) { const at = checked ? ON : OFF; edges.current!.to(at, at + KNOB, { velocity }); }
    else { release.current = velocity; onChange(next); }
  };

  return (
    <button type="button" ref={button} className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClick={() => { if (skipClick.current) { skipClick.current = false; return; } onChange(!checked); }}><i ref={knob} /></button>
  );
}
