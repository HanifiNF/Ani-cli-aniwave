import { describe, expect, it } from "vitest";
import { clampPoint, homeFromPosition, petSize, positionFromHome, pathIsClear, wanderTarget } from "../src/companion-motion";

const bounds = { left: 20, top: 80, right: 500, bottom: 450 };
describe("companion movement", () => {
  it("round-trips normalized home and clamps to resized content", () => {
    const point = positionFromHome({ x: 0.7, y: 0.3 }, bounds);
    expect(homeFromPosition(point, bounds).x).toBeCloseTo(0.7);
    expect(homeFromPosition(point, bounds).y).toBeCloseTo(0.3);
    expect(clampPoint({ x: -100, y: 999 }, bounds)).toEqual({ x: 20, y: 346 });
  });
  it("never chooses a destination across controls or outside the content area", () => {
    const home = { x: 30, y: 300 };
    expect(pathIsClear(home, { x: 240, y: 300 }, [{ left: 140, top: 280, right: 180, bottom: 410 }])).toBe(false);
    expect(wanderTarget({ x: 0, y: 0 }, { left: 0, top: 0, right: 96, bottom: 104 }, [], () => 0.5)).toBeUndefined();
    const target = wanderTarget(home, bounds, [], () => 0);
    expect(target).toBeDefined();
    expect(target!.x).toBeGreaterThanOrEqual(bounds.left);
  });
  it("can walk away from a home already overlapping a clickable card", () => {
    const home = { x: 20, y: 300 };
    const card = { left: 40, top: 260, right: 200, bottom: 430 };
    const target = wanderTarget(home, bounds, [card], () => 0);
    expect(target).toBeDefined();
    expect(Math.hypot(target!.x - home.x, target!.y - home.y)).toBeGreaterThanOrEqual(35);
    expect(pathIsClear(home, target!, [card])).toBe(true);
  });
  it("does not need a lucky random direction to find the only clear lane", () => {
    const home = { x: 200, y: 300 };
    const obstacles = [
      { left: 100, top: 170, right: 194, bottom: 430 },
      { left: 302, top: 170, right: 400, bottom: 430 },
      { left: 180, top: 170, right: 310, bottom: 294 },
    ];
    const target = wanderTarget(home, bounds, obstacles, () => 0);
    expect(target).toBeDefined();
    expect(target!.y).toBeGreaterThan(home.y);
    expect(pathIsClear(home, target!, obstacles)).toBe(true);
  });
  it("clamps and restores the home using the displayed size", () => {
    for (const percent of [50, 100, 200]) {
      const size = petSize(percent);
      const point = positionFromHome({ x: 1, y: 1 }, bounds, false, size);
      expect(point).toEqual({ x: bounds.right - size.width, y: bounds.bottom - size.height });
      expect(homeFromPosition(point, bounds, size)).toEqual({ x: 1, y: 1 });
      const target = wanderTarget({ x: bounds.left, y: bounds.top }, bounds, [], () => 0, size);
      expect(target).toBeDefined();
      expect(target!.x + size.width).toBeLessThanOrEqual(bounds.right);
      expect(target!.y + size.height).toBeLessThanOrEqual(bounds.bottom);
    }
  });
});
