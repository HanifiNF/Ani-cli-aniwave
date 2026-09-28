import type { CSSProperties, ReactNode } from "react";
import type { SubtitleAppearance } from "../shared/contracts";
import { DEFAULT_SUBTITLE_APPEARANCE } from "../shared/subtitle-appearance";
import Chips from "./Chips";
import Switch from "./Switch";
import "./subtitle-appearance.css";

const FONTS = ["sans", "serif", "mono"] as const;
const EDGES = ["none", "outline", "shadow"] as const;
/** Quick picks for the text colour; the swatch beside them takes any other. */
const TEXT_COLOURS: readonly { value: string; name: string }[] = [
  { value: "#ffffff", name: "white" }, { value: "#f5e663", name: "yellow" }, { value: "#7fd6ff", name: "cyan" }, { value: "#b6f0b0", name: "green" }
];

export function subtitleVariables(value: SubtitleAppearance): Record<`--${string}`, string> {
  const family = value.font === "serif" ? "Georgia, 'Times New Roman', serif" : value.font === "mono" ? "Menlo, Consolas, monospace" : "Arial, Helvetica, sans-serif";
  const shadow = value.edge === "outline"
    ? "-1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 1px 1px 1px #000"
    : value.edge === "shadow" ? "2px 2px 3px #000" : "none";
  return {
    "--app-subtitle-font": family,
    "--app-subtitle-size": String(value.size / 100),
    "--app-subtitle-color": value.textColor,
    "--app-subtitle-background": value.backgroundColor,
    "--app-subtitle-background-resolved": value.backgroundEnabled
      ? `color-mix(in srgb, ${value.backgroundColor} ${value.backgroundOpacity}%, transparent)` : "transparent",
    "--app-subtitle-shadow": shadow,
    "--app-subtitle-bottom-inset": `${value.bottomInset}%`
  };
}

/** One line for a closed disclosure: "sans · 100% · outline · no background". */
export function subtitleSummary(value: SubtitleAppearance): string {
  return [value.font, `${value.size}%`, value.edge === "none" ? "no edge" : value.edge, value.backgroundEnabled ? `background ${value.backgroundOpacity}%` : "no background"].join(" · ");
}

export function isDefaultSubtitleAppearance(value: SubtitleAppearance): boolean {
  return (Object.keys(DEFAULT_SUBTITLE_APPEARANCE) as (keyof SubtitleAppearance)[]).every((key) => value[key] === DEFAULT_SUBTITLE_APPEARANCE[key]);
}

/** A sample cue over a still, at the preset's size and colour. `thumb` is the one-line sample on the closed row, sized like a text field. */
export function SubtitlePreview({ value, thumb = false }: { value: SubtitleAppearance; thumb?: boolean }) {
  return <div className={thumb ? "subtitle-preview subtitle-thumb" : "subtitle-preview"} style={subtitleVariables(value) as CSSProperties} role="img" aria-label={`Subtitle preview: ${subtitleSummary(value)}`}>
    {!thumb && <span className="subtitle-preview-tag">Preview</span>}
    {thumb
      ? <span className="subtitle-sample"><span>Sample · 字幕</span></span>
      : <span className="subtitle-sample"><span>Sample subtitle · 字幕</span><br /><span>Second line of text</span></span>}
  </div>;
}

export function Stepper({ label, value, min, max, step, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void }) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  // Values off the step (an older file, say) move to the next step rather than staying off it.
  const down = clamp(Math.ceil((value - step) / step) * step);
  const up = clamp(Math.floor((value + step) / step) * step);
  return <span className="stepper" role="group" aria-label={label}>
    <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(down)}>−</button>
    <output aria-live="polite"><span key={value} className="stepper-value">{value}%</span></output>
    <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(up)}>+</button>
  </span>;
}

function ColourSwatch({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <span className="swatch subtitle-swatch">
    <input type="color" value={value} aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    <span>{value}</span>
  </span>;
}

/**
 * The subtitle rows, in the settings idiom: chips, steppers, swatches, and a switch.
 * Renders inside a `.box`; the caller decides whether a preview sits above it.
 */
/** `lead` holds rows that come before the appearance rows (the language, in Settings). */
export function SubtitleAppearanceEditor({ value, onChange, note, lead }: { value: SubtitleAppearance; onChange: (value: SubtitleAppearance) => void; note?: ReactNode; lead?: ReactNode }) {
  const update = <K extends keyof SubtitleAppearance>(key: K, next: SubtitleAppearance[K]) => onChange({ ...value, [key]: next });
  const preset = TEXT_COLOURS.some((colour) => colour.value === value.textColor);
  return <div className="subtitle-editor">
    {note && <div className="r subtitle-note">{note}</div>}
    {lead}
    <div className="r"><span className="k">Font</span><Chips value={value.font} options={FONTS} onChange={(font) => update("font", font)} /></div>
    <div className="r"><span className="k">Size</span><Stepper label="Subtitle size" value={value.size} min={50} max={200} step={10} onChange={(size) => update("size", size)} /></div>
    <div className="r"><span className="k">Colour</span><span className="v-row">
      <span className="colour-dots" role="radiogroup" aria-label="Subtitle colour">
        {TEXT_COLOURS.map((colour) => <button type="button" key={colour.value} role="radio" aria-checked={value.textColor === colour.value} aria-label={colour.name}
          className={value.textColor === colour.value ? "on" : ""} style={{ background: colour.value }} onClick={() => update("textColor", colour.value)} />)}
      </span>
      <span className={preset ? "subtitle-custom" : "subtitle-custom on"}><ColourSwatch label="Custom subtitle colour" value={value.textColor} onChange={(textColor) => update("textColor", textColor)} /></span>
    </span></div>
    <div className="r"><span className="k">Edge<small>Keeps text readable over bright scenes</small></span><Chips value={value.edge} options={EDGES} onChange={(edge) => update("edge", edge)} /></div>
    <div className="r" data-disabled={!value.backgroundEnabled}><span className="k">Background<small>A box behind each line</small></span><span className="v-row">
      <ColourSwatch label="Background colour" value={value.backgroundColor} disabled={!value.backgroundEnabled} onChange={(backgroundColor) => update("backgroundColor", backgroundColor)} />
      <Stepper label="Background opacity" value={value.backgroundOpacity} min={10} max={100} step={10} disabled={!value.backgroundEnabled} onChange={(backgroundOpacity) => update("backgroundOpacity", backgroundOpacity)} />
      <Switch checked={value.backgroundEnabled} label="Subtitle background" onChange={(backgroundEnabled) => update("backgroundEnabled", backgroundEnabled)} />
    </span></div>
    <div className="r"><span className="k">Raise from bottom<small>Clears burnt-in text or a letterbox bar</small></span><span className="v-row">
      <Stepper label="Subtitle offset" value={value.bottomInset} min={0} max={20} step={5} onChange={(bottomInset) => update("bottomInset", bottomInset)} />
      <button type="button" className="btn small ghost" disabled={isDefaultSubtitleAppearance(value)} onClick={() => onChange({ ...DEFAULT_SUBTITLE_APPEARANCE })}>reset</button>
    </span></div>
  </div>;
}

/**
  The row in Playback: label and summary (led by the subtitle language when given), then the live sample where a control
  would sit, and a chevron. Opens the editor beneath it.
*/
export function SubtitleAppearanceRow({ value, language, open, onToggle }: { value: SubtitleAppearance; language?: string; open: boolean; onToggle: () => void }) {
  return <button type="button" className="r subtitle-row" aria-expanded={open} aria-controls="subtitle-editor" onClick={onToggle}>
    <span className="k">{language ? "Subtitles" : "Subtitle appearance"}<small>{language ? `${language} · ${subtitleSummary(value)}` : subtitleSummary(value)}</small></span>
    <span className="v-row">
      <SubtitlePreview value={value} thumb />
      <svg className="icon subtitle-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
    </span>
  </button>;
}
