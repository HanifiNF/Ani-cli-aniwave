import type React from "react";
import { Spring } from "./motion";

let touchPress = false;

/**
  Props that act on press: a mouse or pen acts on pointer down, so the change answers the press itself rather than the
  release a moment later; keys and programmatic clicks (detail 0) act on click, and so does touch, which may scroll.
  Use it for controls that change a selection in place (chips, tabs, the nav).
*/
export function pressProps(act: () => void) {
  return {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      touchPress = event.pointerType === "touch";
      if (event.button === 0 && !touchPress && !(event.currentTarget as HTMLButtonElement).disabled) act();
    },
    onClick(event: React.MouseEvent<HTMLElement>) {
      if (event.detail === 0 || touchPress) act();
    }
  };
}

const PRESSABLE = ".btn:not(:disabled), .tile, .start-tile, .hit-row .hit";
const dips = new WeakMap<HTMLElement, Spring>();

function dip(element: HTMLElement, to: number) {
  let spring = dips.get(element);
  if (!spring) {
    spring = new Spring(1, "snap", (value) => { element.style.scale = value === 1 ? "" : String(value); }, 0.0005);
    dips.set(element, spring);
  }
  spring.to(to);
}

/**
  Cards, buttons, and tiles dip slightly under the pointer and act on release, since a drag may still start from them.
  Installed once on the document; returns its removal.
*/
export function installPressDip(root: Document = document): () => void {
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const card = event.target.closest(".card .hit");
    const element = (card ? card.querySelector<HTMLElement>(".poster") : event.target.closest<HTMLElement>(PRESSABLE));
    if (!element) return;
    dip(element, card ? 0.97 : 0.98);
    const up = () => { dip(element, 1); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };
  root.addEventListener("pointerdown", down, true);
  return () => root.removeEventListener("pointerdown", down, true);
}
