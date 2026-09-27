import { useRef, useState, type ReactNode } from "react";
import { motionAllowed } from "./motion";

/**
  Inner content that changes in place (a label, a count, an icon) swaps with a short blur crossfade: the old copy blurs
  out on the quick "out" curve while the new one blurs in a beat later on its own, so the two never read as one.
  `id` names the content; a new id starts a swap. The first content appears as it is.
*/
export default function Swap({ id, children, className }: { id: string | number; children: ReactNode; className?: string }) {
  const [leaving, setLeaving] = useState<{ id: string | number; node: ReactNode }[]>([]);
  const current = useRef({ id, node: children as ReactNode, swapped: false });
  if (current.current.id !== id) {
    const previous = { id: current.current.id, node: current.current.node };
    if (motionAllowed()) setLeaving((list) => [...list.filter((item) => item.id !== id && item.id !== previous.id), previous]);
    current.current = { id, node: children, swapped: true };
  } else current.current.node = children;
  return (
    <span className={className ? `swap ${className}` : "swap"}>
      {leaving.map((item) => <span key={`out-${item.id}`} className="swap-out" aria-hidden="true"
        onAnimationEnd={() => setLeaving((list) => list.filter((entry) => entry !== item))}>{item.node}</span>)}
      <span key={`in-${id}`} className={current.current.swapped ? "swap-in" : undefined}>{children}</span>
    </span>
  );
}
