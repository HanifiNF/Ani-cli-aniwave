import type { CSSProperties } from "react";

/** The furthest a staggered entrance waits, in list positions, so long lists finish with the first screenful. */
export const stagger = (index: number, cap: number) => ({ "--i": Math.min(Math.max(index, 0), cap) }) as CSSProperties;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Start a script animation when the platform offers one and motion is welcome; without one, the caller applies its change at once. */
export function play(element: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | undefined {
  if (!element || typeof element.animate !== "function" || reducedMotion()) return undefined;
  return element.animate(keyframes, options);
}
