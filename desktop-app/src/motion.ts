/*
  Springs for every movement. Three presets carry the design language: snap for controls, glide for layout and shared
  elements, and stretch (a leading and a trailing edge) for indicators; "out" is the quick exit of crossfaded content.

  Each spring is launched: a new target from rest starts at the speed it would have if it were already heading there
  (distance × ω). That puts about a quarter of the travel in the first frame, so a change answers input at once, and the
  rest settles calmly. A new target mid-flight keeps the current position and velocity, so a movement only ever turns.
*/

export type Preset = "snap" | "glide" | "lead" | "trail" | "out";

/** Response is the period of the undamped spring in seconds; damping 1 never overshoots. */
export const PRESETS: Record<Preset, { response: number; damping: number }> = {
  snap: { response: 0.25, damping: 1 },
  glide: { response: 0.4, damping: 0.95 },
  lead: { response: 0.2, damping: 0.95 },
  trail: { response: 0.32, damping: 1 },
  out: { response: 0.12, damping: 1 }
};

const REDUCED = "(prefers-reduced-motion: reduce)";
/** jsdom has no layout or frames worth animating; there and with reduced motion, changes apply at once. */
export function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return false;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
  return !(typeof matchMedia === "function" && matchMedia(REDUCED).matches);
}

const live = new Set<Spring>();
let frame = 0;
let last = 0;
/** Motion recordings (design/record-app-motion.cjs) slow every spring along with Chromium's animation rate. */
const captureRate = () => (globalThis as { __aniMotionRate?: number }).__aniMotionRate ?? 1;
function tick(now: number) {
  // A late frame never jumps more than 50 ms of motion.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000) * captureRate());
  last = now;
  for (const spring of [...live]) spring.step(dt);
  frame = live.size ? requestAnimationFrame(tick) : 0;
}
function wake(spring: Spring) {
  live.add(spring);
  if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
}

export interface SpringTarget { preset?: Preset; velocity?: number; done?: () => void; instant?: boolean }

export class Spring {
  x: number;
  v = 0;
  target: number;
  preset: Preset;
  private done?: () => void;

  /** `epsilon` is the distance that counts as arrived, in the value's own units. */
  constructor(x: number, preset: Preset, private readonly apply: (x: number) => void, private readonly epsilon = 0.1) {
    this.x = x; this.target = x; this.preset = preset;
  }

  get moving(): boolean { return live.has(this); }

  to(target: number, options: SpringTarget = {}): this {
    if (options.preset) this.preset = options.preset;
    this.done = options.done;
    if (options.instant || !motionAllowed()) { this.set(target); this.finish(); return this; }
    if (options.velocity !== undefined) this.v = options.velocity;
    else {
      // Launch: at rest, start at distance × ω. Moving the same way, never slower than that; the other way, keep going and turn.
      const distance = target - this.x, launch = distance * 2 * Math.PI / PRESETS[this.preset].response;
      if (Math.abs(this.v) < 1e-3 || Math.sign(this.v) === Math.sign(distance)) this.v = Math.sign(distance) * Math.max(Math.abs(this.v), Math.abs(launch));
    }
    this.target = target;
    if (this.x === target && this.v === 0) { this.apply(target); this.finish(); return this; }
    wake(this);
    return this;
  }

  /** Direct manipulation: the value sits exactly where the pointer puts it. */
  set(x: number): this {
    this.x = x; this.target = x; this.v = 0;
    live.delete(this);
    this.apply(x);
    return this;
  }

  stop(): void { live.delete(this); this.v = 0; this.done = undefined; }

  step(dt: number): void {
    const { response, damping } = PRESETS[this.preset];
    const k = (2 * Math.PI / response) ** 2, c = 4 * Math.PI * damping / response;
    const steps = Math.max(1, Math.ceil(dt * 600)), h = dt / steps;
    for (let i = 0; i < steps; i++) { this.v += (-k * (this.x - this.target) - c * this.v) * h; this.x += this.v * h; }
    if (Math.abs(this.x - this.target) < this.epsilon && Math.abs(this.v) < this.epsilon * 10) {
      this.x = this.target; this.v = 0; live.delete(this); this.apply(this.x); this.finish(); return;
    }
    this.apply(this.x);
  }

  private finish() { const done = this.done; this.done = undefined; done?.(); }
}

/**
  An indicator moved by two edges, each on its own spring: the edge in front runs on the fast "lead" spring and the one
  behind follows on "trail", so the indicator stretches ahead and gathers up as it lands.
*/
export class Edges {
  readonly a: Spring;
  readonly b: Spring;
  private placed = false;
  constructor(private readonly apply: (start: number, end: number) => void) {
    this.a = new Spring(0, "trail", () => this.apply(this.a.x, this.b.x), 0.05);
    this.b = new Spring(0, "lead", () => this.apply(this.a.x, this.b.x), 0.05);
  }
  to(start: number, end: number, options: { instant?: boolean; velocity?: number } = {}): void {
    if (!this.placed || options.instant) { this.placed = true; this.a.set(start); this.b.set(end); return; }
    const forward = start + end > this.a.target + this.b.target;
    this.a.to(start, { preset: forward ? "trail" : "lead", velocity: options.velocity });
    this.b.to(end, { preset: forward ? "lead" : "trail", velocity: options.velocity });
  }
  /** Both edges where the pointer puts them. */
  hold(start: number, end: number): void { this.placed = true; this.a.set(start); this.b.set(end); }
}

/** Past a limit a dragged value keeps moving with resistance, approaching (never passing) `limit` more. */
export function rubber(over: number, limit: number): number {
  return Math.sign(over) * limit * (1 - 1 / (Math.abs(over) * 0.55 / limit + 1));
}

/** Pointer speed over the last ~90 ms, in pixels per second, so a release keeps its throw. */
export function velocityTracker() {
  const points: { x: number; y: number; t: number }[] = [];
  return {
    add(x: number, y: number) {
      const t = performance.now();
      points.push({ x, y, t });
      while (points.length > 2 && t - points[0].t > 90) points.shift();
    },
    velocity(): { x: number; y: number } {
      if (points.length < 2) return { x: 0, y: 0 };
      const a = points[0], b = points[points.length - 1], dt = Math.max(0.008, (b.t - a.t) / 1000);
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    },
    reset() { points.length = 0; }
  };
}

/** A launched spring's step response sampled at 60 fps, as a CSS linear() curve and the time it takes to settle. */
export function springCurve(preset: Preset): { easing: string; ms: number } {
  const { response, damping } = PRESETS[preset];
  const w = 2 * Math.PI / response, k = w * w, c = 2 * damping * w;
  let x = 0, v = w;
  const points = [0];
  for (let i = 0; i < 90 && !(Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.02); i++) {
    for (let j = 0; j < 10; j++) { v += (-k * (x - 1) - c * v) / 600; x += v / 600; }
    points.push(Math.round(x * 10000) / 10000);
  }
  points.push(1);
  return { easing: `linear(${points.join(", ")})`, ms: Math.round((points.length - 1) * 1000 / 60) };
}

/** CSS moves the things that only enter or fade (rises, hovers, colours); it gets the same springs as curves. */
export function installMotionCurves(root: HTMLElement = document.documentElement): void {
  for (const preset of ["snap", "glide", "out"] as const) {
    const curve = springCurve(preset);
    root.style.setProperty(`--spring-${preset}`, curve.easing);
    root.style.setProperty(`--spring-${preset}-ms`, `${curve.ms}ms`);
  }
}
