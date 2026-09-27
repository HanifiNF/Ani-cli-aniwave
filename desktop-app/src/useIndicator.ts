import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Edges } from "./motion";

interface Options {
  axis?: "x" | "y";
  /** Also size the indicator across the axis from the current item, for rings that wrap it. */
  cross?: boolean;
  /** Extra room around the item on every side, for rings. */
  pad?: number;
  /** Called with the indicator's edges each frame, in the container's coordinates. */
  onPlace?: (start: number, end: number) => void;
}

/**
  Moves one indicator element to the container's current item (found by `selector`) on two springs, one per edge, so
  it stretches ahead of the change and gathers up as it lands. `key` names the current item; a change animates, a
  resize re-places at once, and no current item hides the indicator. The container must be the items' offset parent.
*/
export function useIndicator(container: RefObject<HTMLElement | null>, indicator: RefObject<HTMLElement | null>, selector: string, key: unknown, options: Options = {}): void {
  const edges = useRef<Edges>(null);
  const settings = useRef(options);
  settings.current = options;
  const place = useRef<(instant: boolean) => void>(() => undefined);
  place.current = (instant) => {
    const box = container.current, mark = indicator.current;
    if (!box || !mark) return;
    const { axis = "x", cross = false, pad = 0 } = settings.current;
    edges.current ??= new Edges((start, end) => {
      const node = indicator.current;
      if (node) {
        if ((settings.current.axis ?? "x") === "x") { node.style.transform = `translateX(${start}px)`; node.style.width = `${end - start}px`; }
        else { node.style.transform = `translateY(${start}px)`; node.style.height = `${end - start}px`; }
      }
      settings.current.onPlace?.(start, end);
    });
    const item = box.querySelector<HTMLElement>(selector);
    if (!item) { mark.removeAttribute("data-placed"); return; }
    const [start, size] = axis === "x" ? [item.offsetLeft, item.offsetWidth] : [item.offsetTop, item.offsetHeight];
    if (cross) {
      if (axis === "x") { mark.style.top = `${item.offsetTop - pad}px`; mark.style.height = `${item.offsetHeight + 2 * pad}px`; }
      else { mark.style.left = `${item.offsetLeft - pad}px`; mark.style.width = `${item.offsetWidth + 2 * pad}px`; }
    }
    // An indicator that was hidden appears in place rather than sliding in from where it was.
    const appearing = !mark.hasAttribute("data-placed");
    mark.setAttribute("data-placed", "");
    edges.current.to(start - pad, start + size + pad, { instant: instant || appearing });
  };

  const first = useRef(true);
  useLayoutEffect(() => {
    place.current(first.current);
    first.current = false;
  }, [key]);

  useEffect(() => {
    const box = container.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place.current(true));
    observer.observe(box);
    return () => observer.disconnect();
  }, [container]);
}
