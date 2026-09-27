import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Spring } from "./motion";

const PILL = 44;

/**
  The search pill and its results are one surface. At rest the surface is the pill; when the palette opens, the same
  surface grows down around the results (height and corner radius on the glide spring) and the results are revealed
  by its edge as it passes, so the palette visibly comes out of the pill and goes back into it.
*/
export function useSearchMorph(box: RefObject<HTMLElement | null>, surface: RefObject<HTMLElement | null>, open: boolean): void {
  const springs = useRef<{ height: Spring; radius: Spring }>(null);
  const apply = () => {
    const node = surface.current, parts = springs.current;
    if (!node || !parts) return;
    const height = parts.height.x;
    node.style.height = `${height}px`;
    node.style.borderRadius = `${parts.radius.x}px`;
    node.style.setProperty("--open", String(Math.min(1, Math.max(0, (height - PILL) / 48))));
    const palette = box.current?.querySelector<HTMLElement>(".palette");
    if (palette) palette.style.clipPath = `inset(0 0 ${Math.max(0, palette.offsetHeight - (height - PILL))}px 0 round 0 0 10px 10px)`;
  };
  springs.current ??= { height: new Spring(PILL, "glide", apply, 0.2), radius: new Spring(PILL / 2, "glide", apply, 0.05) };

  const target = () => {
    const palette = box.current?.querySelector<HTMLElement>(".palette");
    return open && palette ? PILL + palette.offsetHeight : PILL;
  };
  useLayoutEffect(() => {
    apply();
    springs.current!.height.to(target());
    springs.current!.radius.to(open ? 10 : PILL / 2);
  }, [open]);

  // New results change the palette's height; the surface follows it on the same spring.
  useEffect(() => {
    const palette = box.current?.querySelector<HTMLElement>(".palette");
    if (!open || !palette || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => springs.current!.height.to(target()));
    observer.observe(palette);
    return () => observer.disconnect();
  }, [open]);
}
