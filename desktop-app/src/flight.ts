import { Spring, motionAllowed } from "./motion";

/*
  Shared posters. Opening a title from a card or a search row flies that poster to the series page's poster; going
  back flies the series poster to its card. The flyer is a copy of the image on the four glide springs of its rectangle;
  a new destination mid-flight (Escape while it is still moving) turns it from where it is, at its speed.
*/

interface Rect { x: number; y: number; w: number; h: number }
const KEYS = ["x", "y", "w", "h"] as const;
const FRESH = 1_500; // A launch that finds no destination this soon is dropped.

let origin: { rect: Rect; src?: string; at: number } | undefined;
let flight: { node: HTMLElement; springs: Record<(typeof KEYS)[number], Spring>; target?: HTMLElement; settled: number } | undefined;
let waiting: { selector: string; at: number } | undefined;

const rectOf = (element: Element): Rect => { const r = element.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const imageOf = (element: Element) => (element instanceof HTMLImageElement ? element : element.querySelector("img"))?.currentSrc || undefined;

/** Records the poster that is about to open a title, before the page changes. */
export function launchFrom(element: Element | null | undefined): void {
  if (!element || !motionAllowed()) return;
  origin = { rect: rectOf(element), src: imageOf(element), at: performance.now() };
}

/** Records the page's own poster before going back, and the card it should land on once the next page renders. */
export function returnTo(from: Element | null | undefined, selector: string): void {
  if (!from || !motionAllowed()) return;
  if (!flight) origin = { rect: rectOf(from), src: imageOf(from), at: performance.now() };
  waiting = { selector, at: performance.now() };
}

/** Called after a render: lands a pending return on its card when that card is on the page now. */
export function resolveReturn(): void {
  if (!waiting) return;
  const { selector, at } = waiting;
  waiting = undefined;
  if (performance.now() - at > FRESH) { origin = undefined; return; }
  const target = document.querySelector<HTMLElement>(selector);
  if (target) land(target); else { origin = undefined; flight?.node.remove(); flight = undefined; }
}

/** Lands the pending or moving poster on `target`, which stays hidden until the flyer arrives. */
export function land(target: HTMLElement | null): void {
  if (!target || !motionAllowed()) { origin = undefined; return; }
  const fresh = origin && performance.now() - origin.at < FRESH;
  if (!flight && !fresh) { origin = undefined; return; }
  // The destination card must not rise while the poster lands on it.
  target.closest(".card")?.setAttribute("data-shared", "");
  const to = rectOf(target);
  if (!flight) {
    const node = document.createElement("div");
    node.className = "flyer";
    node.setAttribute("aria-hidden", "true");
    if (origin!.src) { const image = document.createElement("img"); image.src = origin!.src; image.alt = ""; node.append(image); }
    document.body.append(node);
    const apply = () => {
      const s = flight?.springs; if (!s) return;
      node.style.transform = `translate(${s.x.x}px, ${s.y.x}px)`; node.style.width = `${s.w.x}px`; node.style.height = `${s.h.x}px`;
    };
    const from = origin!.rect;
    flight = { node, springs: { x: new Spring(from.x, "glide", apply, 0.3), y: new Spring(from.y, "glide", apply, 0.3), w: new Spring(from.w, "glide", apply, 0.3), h: new Spring(from.h, "glide", apply, 0.3) }, settled: 0 };
    apply();
  }
  origin = undefined;
  const current = flight;
  if (current.target && current.target !== target) current.target.style.visibility = "";
  current.target = target;
  target.style.visibility = "hidden";
  current.settled = 0;
  for (const key of KEYS) current.springs[key].to(to[key], { done: () => {
    if (++current.settled < KEYS.length || flight !== current) return;
    target.style.visibility = "";
    target.closest(".card")?.removeAttribute("data-shared");
    current.node.remove();
    flight = undefined;
  } });
}
