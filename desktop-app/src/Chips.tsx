import { useRef, type RefObject } from "react";
import { pressProps } from "./press";
import { useIndicator } from "./useIndicator";

/** Clips a lit copy of a track's labels (inside the track's 3px padding) to the indicator's edges. */
export const clipLit = (lit: RefObject<HTMLElement | null>) => (start: number, end: number) => {
  const layer = lit.current;
  if (layer) layer.style.clipPath = `inset(0 ${layer.clientWidth - (end - 3)}px 0 ${start - 3}px round 5px)`;
};

/**
  A choice between named options: a track with one indicator that moves between the options on two edges. A lit
  copy of the labels, clipped to the indicator, brightens each label exactly where the indicator covers it.
*/
export default function Chips<T extends string>({ label, ariaLabel, value, options, onChange, names }: { label?: string; ariaLabel?: string; value: T; options: readonly T[]; onChange: (value: T) => void; names?: Partial<Record<T, string>> }) {
  const track = useRef<HTMLSpanElement>(null);
  const indicator = useRef<HTMLElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  useIndicator(track, indicator, '[role="radio"][aria-checked="true"]', `${value}|${options.join(",")}`, { onPlace: clipLit(lit) });
  const name = (option: T) => names?.[option] ?? option;
  return (
    <span className="chips-row">
      {label && <span className="chips-lab">{label}</span>}
      <span className="chips" role="radiogroup" aria-label={label ?? ariaLabel} ref={track}>
        <i className="chips-ind" ref={indicator} aria-hidden="true" />
        {options.map((option) => (
          <button type="button" key={option} role="radio" aria-checked={option === value} className={option === value ? "on" : ""} {...pressProps(() => { if (option !== value) onChange(option); })}>{name(option)}</button>
        ))}
        <span className="chips-lit" ref={lit} aria-hidden="true">{options.map((option) => <span key={option}>{name(option)}</span>)}</span>
      </span>
    </span>
  );
}
