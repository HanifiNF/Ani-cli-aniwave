/*
  Hand-offs for the player's movement (see PlayerScreen). The element that starts playback is remembered so the player
  can grow out of it, and the player's rectangle is captured before a dock or an expand changes its layout, so the box
  moves from where it was seen rather than jumping.
*/

export interface Rect { x: number; y: number; w: number; h: number }

let origin: { element: Element; fill: boolean; at: number; rect?: Rect } | undefined;
// Finding a stream can take a while; an origin older than this no longer explains where the player came from.
const ORIGIN_LIFETIME = 15_000;
let captured: Rect | undefined;

/** The Play button (filled with the highlight) or an episode row that asked for playback. */
export function setPlayOrigin(element: Element | null | undefined): void {
  origin = element ? { element, fill: element.classList.contains("primary"), at: Date.now() } : undefined;
}

const rectOf = (element: Element): Rect | undefined => {
  const r = element.getBoundingClientRect();
  return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : undefined;
};

/** Notes where the origin is drawn now; called just before the player takes the screen and the origin's page goes. */
export function notePlayOrigin(): void {
  if (origin?.element.isConnected) origin.rect = rectOf(origin.element) ?? origin.rect;
}

/** Where the origin was last seen, if recently; it is used once. */
export function takePlayOrigin(): { rect: Rect; fill: boolean } | undefined {
  const current = origin;
  origin = undefined;
  if (!current || Date.now() - current.at > ORIGIN_LIFETIME) return undefined;
  const rect = current.element.isConnected ? rectOf(current.element) : current.rect;
  return rect ? { rect, fill: current.fill } : undefined;
}

/** Records where the player is drawn right now, before its layout changes. */
export function capturePlayer(): void {
  const shell = document.querySelector(".player-shell");
  if (!shell) { captured = undefined; return; }
  const r = shell.getBoundingClientRect();
  captured = { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function takeCapturedPlayer(): Rect | undefined {
  const rect = captured;
  captured = undefined;
  return rect;
}
