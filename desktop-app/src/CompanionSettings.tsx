import { useRef, useState, type CSSProperties } from "react";
import type { Settings } from "../shared/contracts";
import { COMPANION_PETS, COMPANION_FREQUENCIES, COMPANION_REGISTRY, companionImageUrl, normalizeCompanionPreferences, type CompanionPetId, type CustomCompanion } from "../shared/companion";
import Chips from "./Chips";
import Switch from "./Switch";
import Reveal from "./Reveal";
import { Icon } from "./icons";
import { Stepper } from "./SubtitleAppearanceEditor";
import { useIndicator } from "./useIndicator";
import { pressProps } from "./press";
import { messageFrom } from "./errors";

interface Props {
  draft: Settings; setDraft: (settings: Settings) => void; onHello: () => void;
  customCompanions: CustomCompanion[]; customCompanionImage?: string; companionIssue?: string;
  onImportCompanion: (name: string) => Promise<void>; onRemoveCompanion: (id: string) => Promise<void>;
}

const builtIn = (id: string): id is CompanionPetId => (COMPANION_PETS as readonly string[]).includes(id);

/** The first idle frame at `height`, whole. */
function Sprite({ image, height }: { image: string; height: number }) {
  return <span className="companion-sprite" style={{ "--h": `${height}px`, backgroundImage: `url(${image})` } as CSSProperties} />;
}

/**
 * The Companion section: an on switch, then one disclosure row in the Subtitle appearance idiom (name and summary on the
 * left, the character's face where a control would sit) that opens the picker, the import, and the behaviour rows.
 */
export default function CompanionSettings({ draft, setDraft, onHello, customCompanions, customCompanionImage, companionIssue, onImportCompanion, onRemoveCompanion }: Props) {
  const prefs = normalizeCompanionPreferences(draft);
  const selected = prefs.companionPetId;
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const tiles = useRef<HTMLSpanElement>(null), ring = useRef<HTMLElement>(null);
  useIndicator(tiles, ring, '.companion-tile[aria-checked="true"] .prev', `${selected}|${customCompanions.length}|${open}`, { cross: true, pad: 2 });

  const custom = customCompanions.find((pet) => pet.id === selected);
  const selectedName = builtIn(selected) ? COMPANION_REGISTRY[selected].name : custom?.name ?? "Companion";
  const faceImage = builtIn(selected) ? companionImageUrl(selected, import.meta.env.BASE_URL) : customCompanionImage;
  const summary = [`${prefs.companionFrequency} chattiness`, prefs.companionWander ? "wanders" : "stays home", `${prefs.companionSize}%`].join(" · ");
  const pick = (id: Settings["companionPetId"]) => { if (id !== selected) setDraft({ ...draft, companionPetId: id }); };
  const run = (task: () => Promise<void>) => { setBusy(true); setError(undefined); void task().catch((reason) => setError(messageFrom(reason))).finally(() => setBusy(false)); };
  const problem = error || companionIssue;

  return <div className="group"><h3 id="settings-companion" tabIndex={-1}>Companion</h3><div className="box">
    <div className="r"><span className="k">Watch companion<small>A little animated friend with preset comments while you browse and watch</small></span><span className="v-row">
      {prefs.companionEnabled && <button type="button" className="btn small ghost" onClick={onHello}>say hello</button>}
      <Switch checked={prefs.companionEnabled} label="Watch companion" onChange={(companionEnabled) => setDraft({ ...draft, companionEnabled })} />
    </span></div>
    <Reveal open={prefs.companionEnabled} className="reveal-row">
      <button type="button" className="r disclosure-row" aria-expanded={open} aria-controls="companion-editor" onClick={() => setOpen((value) => !value)}>
        <span className="k">{selectedName}<small>{summary}</small></span>
        <span className="v-row">
          {faceImage ? <span className="companion-face" style={{ backgroundImage: `url(${faceImage})` }} aria-hidden="true" /> : <span className="companion-face initial" aria-hidden="true">{selectedName[0]}</span>}
          <svg className="icon disclosure-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
        </span>
      </button>
      <Reveal id="companion-editor" className="disclosure-body" open={open}><div className="companion-editor">
        {problem && <div className="r"><span role="alert" className="companion-import-error">{problem}</span></div>}
        <div className="r stack"><span className="k">Character</span>
          <span className="tiles companion-tiles" role="radiogroup" aria-label="Watch companion character" ref={tiles}><i className="tile-ring" ref={ring} aria-hidden="true" />
            {COMPANION_PETS.map((id) => <button type="button" key={id} role="radio" aria-checked={selected === id} className={`tile companion-tile${selected === id ? " on" : ""}`} {...pressProps(() => pick(id))}>
              <span className="prev" aria-hidden="true"><Sprite image={companionImageUrl(id, import.meta.env.BASE_URL)} height={60} /></span><span>{COMPANION_REGISTRY[id].name}</span>
            </button>)}
            {customCompanions.map((pet) => <span className="companion-slot" key={pet.id} data-missing={pet.available === false || undefined}>
              <button type="button" role="radio" aria-checked={selected === pet.id} disabled={pet.available === false} className={`tile companion-tile${selected === pet.id ? " on" : ""}`} {...pressProps(() => pick(pet.id))}>
                <span className="prev" aria-hidden="true">{selected === pet.id && customCompanionImage ? <Sprite image={customCompanionImage} height={60} /> : <span className="companion-initial">{pet.name[0]}</span>}</span>
                <span>{pet.name}{pet.available === false ? " · missing" : ""}</span>
              </button>
              <button type="button" className="companion-remove" disabled={busy} aria-label={`Remove ${pet.name}`} onClick={() => run(() => onRemoveCompanion(pet.id))}><Icon name="x" /></button>
            </span>)}
            <button type="button" className="tile companion-tile add" aria-expanded={importing} aria-controls="companion-import" onClick={() => setImporting((value) => !value)}>
              <span className="prev" aria-hidden="true"><Icon name="plus" /></span><span>import</span>
            </button>
          </span>
        </div>
        <Reveal id="companion-import" className="companion-import" open={importing}>
          <div className="r"><label className="k" htmlFor="companion-name">Import a companion<small>A transparent 1536 × 1872 PNG or WebP sheet, 8 MB at most</small></label><span className="v-row">
            <input id="companion-name" value={name} maxLength={40} placeholder="Name" onChange={(event) => setName(event.target.value)} />
            <button type="button" className="btn small" disabled={busy || !name.trim() || customCompanions.length >= 20}
              onClick={() => run(() => onImportCompanion(name).then(() => { setName(""); setImporting(false); }))}>choose image</button>
          </span></div>
          <div className="companion-guide">
            <p><b>How to make one.</b> Make a transparent PNG or WebP image exactly 1536 × 1872 pixels. Divide it into 8 columns and 9 rows of 192 × 208 pixel cells, and leave unused cells transparent.</p>
            <p>Rows from top to bottom: idle (6 frames), run right (8), run left (8), wave (4), jump (5), failed (8), waiting (6), working (6), review (6). Place frames left to right in each row. The three included companions use this layout; this is Columbinya’s sheet.</p>
            <img className="companion-example-sheet" src={companionImageUrl("columbinya", import.meta.env.BASE_URL)} alt="Example 8-column, 9-row companion spritesheet" />
            <p>Enter a name and choose your file. The app checks its dimensions and decoding before saving it. The file is copied to this installation only; share the original image to use it on another computer. Imported companions use the same built-in dialogue.</p>
          </div>
        </Reveal>
        <div className="r"><span className="k">Chattiness<small>Preset comments are rate-limited; clicking the companion always makes it talk</small></span><Chips value={prefs.companionFrequency} options={COMPANION_FREQUENCIES} onChange={(companionFrequency) => setDraft({ ...draft, companionFrequency })} /></div>
        <div className="r"><span className="k">Wandering<small>Walks near its home while you browse. Reduced motion keeps it still</small></span><Switch checked={prefs.companionWander} label="Companion wandering" onChange={(companionWander) => setDraft({ ...draft, companionWander })} /></div>
        <div className="r"><span className="k">Size<small>The companion, its speech bubble, and its wandering space</small></span><Stepper label="Companion size" value={prefs.companionSize} min={50} max={200} step={10} onChange={(companionSize) => setDraft({ ...draft, companionSize })} /></div>
        <div className="r"><span className="k">Home<small>Drag the companion, or focus it and use the arrow keys, to move it</small></span><button type="button" className="btn small ghost" disabled={!draft.companionHome} onClick={() => setDraft({ ...draft, companionHome: undefined })}>reset</button></div>
      </div></Reveal>
    </Reveal>
  </div></div>;
}
