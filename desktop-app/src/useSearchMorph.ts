import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Spring } from "./motion";

/** The field's own height: the surface's size at rest. */
const FIELD = 44;

/**
  The search field and its results are one surface. At rest the surface is the field; when the palette opens, the same
  surface grows down around the results (its height on the glide spring) and the results are revealed by its edge as it
  passes, so the palette visibly comes out of the field and goes back into it.
*/
/**
  `appearAtOnce` is read when the palette opens: a page returned to shows its results as they were, already open,
  instead of growing them out of the field again.
*/
export function useSearchMorph(box: RefObject<HTMLElement | null>, surface: RefObject<HTMLElement | null>, open: boolean, appearAtOnce?: RefObject<boolean>): void {
  const spring = useRef<Spring>(null);
  const apply = () => {
    const node = surface.current, height = spring.current?.x;
    if (!node || height === undefined) return;
    node.style.height = `${height}px`;
    node.style.setProperty("--open", String(Math.min(1, Math.max(0, (height - FIELD) / 48))));
    const palette = box.current?.querySelector<HTMLElement>(".palette");
    if (palette) palette.style.clipPath = `inset(0 0 ${Math.max(0, palette.offsetHeight - (height - FIELD))}px 0 round 0 0 10px 10px)`;
  };
  spring.current ??= new Spring(FIELD, "glide", apply, 0.2);

  const target = () => {
    const palette = box.current?.querySelector<HTMLElement>(".palette");
    return open && palette ? FIELD + palette.offsetHeight : FIELD;
  };
  useLayoutEffect(() => {
    apply();
    const instant = open && appearAtOnce?.current === true;
    if (open && appearAtOnce) appearAtOnce.current = false;
    spring.current!.to(target(), { instant });
  }, [open]);

  // New results change the palette's height; the surface follows it on the same spring.
  useEffect(() => {
    const palette = box.current?.querySelector<HTMLElement>(".palette");
    if (!open || !palette || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => spring.current!.to(target()));
    observer.observe(palette);
    return () => observer.disconnect();
  }, [open]);
}
