import type { CSSProperties } from "react";
import { flushSync } from "react-dom";

/** The furthest a staggered entrance waits, in list positions, so long lists finish with the first screenful. */
export const stagger = (index: number, cap: number) => ({ "--i": Math.min(Math.max(index, 0), cap) }) as CSSProperties;

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/** Apply a state change inside a view transition when the platform offers one and motion is welcome. */
export function withTransition(update: () => void): void {
  const doc = document as TransitionDocument;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduced) { update(); return; }
  doc.startViewTransition(() => flushSync(update));
}
