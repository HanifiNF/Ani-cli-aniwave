import { Spring, motionAllowed } from "./motion";

/*
  Shared posters. Opening a title from a card or a search row flies that poster to the series page's poster; going
  back flies the series poster home to the very card that opened it (the Saved card stays the Saved card, even when
  the title also sits in Continue watching). The flyer is a copy of the image on four springs, one per side of its
  rectangle, on the flight preset (the glide's shape, 20% quicker); a new destination mid-flight (Escape while it is
  still moving) turns it from where it is, at its speed. When the destination shows a different picture (a Browse card's
  AniList cover opening a series that shows the streaming site's), the flyer crossfades to it in the air, and it hands
  over only once it shows what the destination shows, waiting a moment for a picture that is still loading.

  Cards take part by carrying data-origin (unique within their group) inside an element with data-origin-group
  (a section, the Browse grid, the search results, the notifications list). A scrolling list inside the page (the
  search results) carries data-scroll-memory: its scroll is remembered with the card and put back on the way home, and
  the card is then revealed within it if it still is not fully in view, before the poster lands.
*/

interface Rect { x: number; y: number; w: number; h: number }
const KEYS = ["x", "y", "w", "h"] as const;
const FRESH = 1_500; // A launch that finds no destination this soon is dropped.
const WAIT = 700; // How long a return waits for its card on a page that fills in asynchronously.
const HOLD = 700; // How long a landed poster waits for its destination's picture to load before handing over.
const POSTER = ":is(.poster, .thumb, .notification-poster)";

let origin: { rect: Rect; src?: string; at: number; back?: string } | undefined;
/** Where the open series came from, as a selector for its card; set when the series poster receives a launch. */
let cameFrom: string | undefined;
interface Flight {
  node: HTMLElement; springs: Record<(typeof KEYS)[number], Spring>; target?: HTMLElement;
  /** The picture the flyer shows (or is crossfading to), and whether a crossfade is running. */
  src?: string; fading?: boolean;
  /** When the springs first came to rest with the destination's picture still loading. */
  rest?: number;
}
let flight: Flight | undefined;
let waiting: { selectors: string[]; at: number } | undefined;
/** Scroll positions of the lists around the card that opened the title: taken at the launch, kept with the title, restored on return. */
let launchScrolls: { at: number; scrolls: ScrollMemory } | undefined;
let cameFromScrolls: ScrollMemory | undefined;
/** The title whose page last received a launch, so a repeat call for it is recognised. */
let openTitle: string | undefined;
let returnScrolls: ScrollMemory | undefined;
type ScrollMemory = { key: string; top: number }[];

function scrollsAround(element: Element): ScrollMemory {
  const out: ScrollMemory = [];
  for (let node = element.parentElement; node; node = node.parentElement) if (node.dataset.scrollMemory) out.push({ key: node.dataset.scrollMemory, top: node.scrollTop });
  return out;
}

/** Scrolls each remembered list around the card just enough to show it whole. */
function reveal(target: Element) {
  const card = target.closest("[data-origin]") ?? target;
  for (let node = card.parentElement; node; node = node.parentElement) {
    if (!node.dataset.scrollMemory) continue;
    const box = node.getBoundingClientRect(), r = card.getBoundingClientRect();
    if (r.top < box.top) node.scrollTop -= box.top - r.top;
    else if (r.bottom > box.bottom) node.scrollTop += r.bottom - box.bottom;
  }
}

const rectOf = (element: Element): Rect => { const r = element.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const imageOf = (element: Element) => (element instanceof HTMLImageElement ? element : element.querySelector("img"))?.currentSrc || undefined;

/** The destination's picture once it is showing, "" while it loads, undefined when it has none. */
function pictureOf(element: Element): string | undefined {
  const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
  if (!image) return undefined;
  const ready = image.complete && image.naturalWidth > 0 && (!image.closest(".art") || image.classList.contains("in"));
  return ready ? image.currentSrc || image.src : "";
}

/** Lays the new picture over the flyer's and blurs it in; the pictures underneath go once it is in. */
function crossfade(current: Flight, src: string) {
  current.src = src; current.fading = true;
  const image = document.createElement("img");
  image.src = src; image.alt = ""; image.className = "flyer-in";
  const done = () => {
    if (flight !== current || current.src !== src) return;
    for (const old of [...current.node.querySelectorAll("img")]) if (old !== image) old.remove();
    current.fading = false;
    arrive(current);
  };
  // The destination has already loaded this picture, so decoding is quick; it keeps a blank frame out of the fade.
  void image.decode().catch(() => undefined).then(() => {
    if (flight !== current || current.src !== src) return;
    image.addEventListener("animationend", done, { once: true });
    current.node.append(image);
  });
}

/** The selector that finds this card again after its page is rebuilt. */
function cardSelector(element: Element): string | undefined {
  const card = element.closest<HTMLElement>("[data-origin]");
  if (!card?.dataset.origin) return undefined;
  const group = card.closest<HTMLElement>("[data-origin-group]")?.dataset.originGroup;
  const own = `[data-origin="${CSS.escape(card.dataset.origin)}"]`;
  return group ? `[data-origin-group="${CSS.escape(group)}"] ${own}` : own;
}

/** Records the poster that is about to open a title, before the page changes. */
export function launchFrom(element: Element | null | undefined): void {
  // Scroll memory is not motion, so it is kept with reduced motion too.
  if (element) launchScrolls = { at: performance.now(), scrolls: scrollsAround(element) };
  if (!element || !motionAllowed()) return;
  origin = { rect: rectOf(element), src: imageOf(element), at: performance.now(), back: cardSelector(element) };
}

/**
  Called by the series page when a title opens there: lands a pending launch on its poster, and remembers the card it
  came from for the way back. A title opened without a card (a key, a notification) forgets any earlier card.
*/
export function landSeries(target: HTMLElement | null, title: string): void {
  // A repeat call for the same title (an effect run again) keeps what the first call recorded.
  const repeat = title === openTitle;
  openTitle = title;
  const fresh = origin && performance.now() - origin.at < FRESH;
  if (fresh) cameFrom = origin!.back;
  else if (!repeat) cameFrom = undefined;
  if (launchScrolls && performance.now() - launchScrolls.at < FRESH) cameFromScrolls = launchScrolls.scrolls;
  else if (!repeat) cameFromScrolls = undefined;
  launchScrolls = undefined;
  land(target);
}

/**
  Records the page's own poster before going back. The poster will land on the card that opened the series, or failing
  that on `fallback` (another card for the same title), once the page going back to renders.
*/
export function returnTo(from: Element | null | undefined, fallback?: string): void {
  const selectors = [cameFrom && `${cameFrom} ${POSTER}`, fallback].filter((value): value is string => Boolean(value));
  returnScrolls = cameFromScrolls;
  cameFrom = undefined; cameFromScrolls = undefined; openTitle = undefined;
  if (!from || !motionAllowed() || !selectors.length) { waiting = undefined; return; }
  if (!flight) origin = { rect: rectOf(from), src: imageOf(from), at: performance.now() };
  waiting = { selectors, at: performance.now() };
}

/**
  Called after a render: lands a pending return on its card. A page that fills in asynchronously (Browse) gets a short
  wait for the card to appear. `restore` runs first, once the card is there (or the wait is over), so a restored scroll
  position is in place before the landing spot is measured.
*/
export function resolveReturn(restore?: () => void): void {
  const pending = waiting, scrolls = returnScrolls;
  waiting = undefined; returnScrolls = undefined;
  const settle = () => {
    restore?.();
    for (const { key, top } of scrolls ?? []) {
      const list = document.querySelector<HTMLElement>(`[data-scroll-memory="${CSS.escape(key)}"]`);
      if (list) list.scrollTop = top;
    }
  };
  if (!pending) { settle(); return; }
  const find = () => { for (const selector of pending.selectors) { const found = document.querySelector<HTMLElement>(selector); if (found) return found; } return null; };
  const attempt = () => {
    const target = find();
    if (target) { settle(); reveal(target); land(target); return; }
    if (performance.now() - pending.at < WAIT && typeof requestAnimationFrame === "function") { requestAnimationFrame(attempt); return; }
    settle();
    origin = undefined; flight?.node.remove(); flight = undefined;
  };
  attempt();
}

/**
  Lands the pending or moving poster on `target`, which stays hidden until the flyer arrives. The landing spot is read
  again every frame, so a page that scrolls or shifts while the poster is in the air carries the landing spot with it.
*/
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
    const from = origin!.rect;
    const created: Flight = { node, springs: {} as Flight["springs"], src: origin!.src };
    const apply = () => {
      if (flight !== created) return;
      follow(created);
      const s = created.springs;
      node.style.transform = `translate(${s.x.x}px, ${s.y.x}px)`; node.style.width = `${s.w.x}px`; node.style.height = `${s.h.x}px`;
    };
    for (const key of KEYS) created.springs[key] = new Spring(from[key], "flight", apply, 0.3);
    flight = created;
    apply();
  }
  origin = undefined;
  const current: Flight = flight!;
  if (current.target && current.target !== target) current.target.style.visibility = "";
  current.target = target;
  target.style.visibility = "hidden";
  for (const key of KEYS) current.springs[key].to(to[key], { done: () => arrive(current) });
}

/**
  Moves the springs' targets to where the destination is drawn now (a spring already at rest sets off again), and starts
  a crossfade when the destination shows a picture the flyer does not.
*/
function follow(current: Flight) {
  const target = current.target;
  if (!target?.isConnected) return;
  const picture = pictureOf(target);
  if (picture && picture !== current.src) crossfade(current, picture);
  const now = rectOf(target);
  for (const key of KEYS) {
    const spring = current.springs[key];
    if (Math.abs(spring.target - now[key]) < 0.5) continue;
    if (spring.moving) spring.target = now[key];
    else spring.to(now[key], { done: () => arrive(current) });
  }
}

/** The flight ends when every side of the rectangle has come to rest on the destination, showing its picture. */
function arrive(current: Flight) {
  if (flight !== current || KEYS.some((key) => current.springs[key].moving)) return;
  const target = current.target;
  if (target) {
    // One last look: if the page moved in the final frame, keep flying.
    follow(current);
    if (KEYS.some((key) => current.springs[key].moving)) return;
    // A running crossfade calls back when it ends; a picture still loading gets a moment before the flyer lets go.
    if (current.fading) return;
    if (target.isConnected && pictureOf(target) === "" && performance.now() - (current.rest ??= performance.now()) < HOLD) {
      requestAnimationFrame(() => arrive(current));
      return;
    }
    target.style.visibility = "";
    target.closest(".card")?.removeAttribute("data-shared");
  }
  current.node.remove();
  flight = undefined;
}
