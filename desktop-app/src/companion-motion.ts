import type { CompanionHome } from "../shared/companion";

export interface Point { x: number; y: number }
export interface Bounds { left: number; top: number; right: number; bottom: number }
export interface Obstacle extends Bounds {}
export const PET_WIDTH = 96, PET_HEIGHT = 104;

export function clampPoint(point: Point, bounds: Bounds): Point {
  return { x: Math.max(bounds.left, Math.min(Math.max(bounds.left, bounds.right - PET_WIDTH), point.x)),
    y: Math.max(bounds.top, Math.min(Math.max(bounds.top, bounds.bottom - PET_HEIGHT), point.y)) };
}
export function positionFromHome(home: CompanionHome | undefined, bounds: Bounds, rightDefault = false): Point {
  return clampPoint({ x: home ? bounds.left + home.x * Math.max(0, bounds.right - bounds.left - PET_WIDTH) : rightDefault ? bounds.right - PET_WIDTH - 12 : bounds.left + 12,
    y: home ? bounds.top + home.y * Math.max(0, bounds.bottom - bounds.top - PET_HEIGHT) : bounds.bottom - PET_HEIGHT - 12 }, bounds);
}
export function homeFromPosition(point: Point, bounds: Bounds): CompanionHome {
  const clamped = clampPoint(point, bounds);
  return { x: (clamped.x - bounds.left) / Math.max(1, bounds.right - bounds.left - PET_WIDTH),
    y: (clamped.y - bounds.top) / Math.max(1, bounds.bottom - bounds.top - PET_HEIGHT) };
}
export function intersects(point: Point, rect: Obstacle, gap = 6): boolean {
  return point.x < rect.right + gap && point.x + PET_WIDTH > rect.left - gap && point.y < rect.bottom + gap && point.y + PET_HEIGHT > rect.top - gap;
}
export function pathIsClear(from: Point, to: Point, obstacles: Obstacle[]): boolean {
  // A saved home may already overlap a control after a responsive layout change.
  // Let the companion leave that spot; never route it through another control.
  const newObstacles = obstacles.filter((rect) => !intersects(from, rect));
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 24));
  for (let step = 1; step <= steps; step++) {
    const point = { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps };
    if (newObstacles.some((rect) => intersects(point, rect))) return false;
  }
  return true;
}
export function wanderTarget(home: Point, bounds: Bounds, obstacles: Obstacle[], random: () => number): Point | undefined {
  // A home saved over a large clickable card cannot instantly become clear.
  // Moving within that same card does not cover a new control, so only block
  // obstacles that were not already underneath the companion at home.
  const newObstacles = obstacles.filter((rect) => !intersects(home, rect));
  const candidates: Point[] = [];
  for (const distance of [48, 80, 120, 160, 200]) {
    for (let direction = 0; direction < 16; direction++) {
      const angle = direction * Math.PI / 8;
      const target = clampPoint({ x: home.x + Math.cos(angle) * distance, y: home.y + Math.sin(angle) * distance }, bounds);
      if (Math.hypot(target.x - home.x, target.y - home.y) < 35) continue;
      if (newObstacles.some((rect) => intersects(target, rect))) continue;
      if (pathIsClear(home, target, newObstacles)) candidates.push(target);
    }
  }
  return candidates.length ? candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))] : undefined;
}
