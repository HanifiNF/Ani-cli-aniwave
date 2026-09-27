import { useEffect, useRef, useState } from "react";
import type { EpisodeUpdateStatus, ProviderPreference, Settings, SubtitleAppearance, UpdateStatus, UpdateInstallStatus } from "../shared/contracts";
import { enabledProviders } from "../shared/catalog";
import { PLAYBACK_QUALITIES as QUALITIES } from "../shared/settings";
import { THEME_NAMES, resolveTheme } from "../shared/theme";
import { isMac } from "./keys";
import Chips from "./Chips";
import { Icon } from "./icons";
import Switch from "./Switch";
import SourceStatusPanel from "./SourceStatusPanel";
import BookmarkMetadataPanel from "./BookmarkMetadataPanel";
import IdentityIndexPanel from "./IdentityIndexPanel";
import { UpdateNotice, UpdatePanel, updatePending } from "./UpdateUI";
import { SubtitleAppearanceEditor, SubtitleAppearanceRow } from "./SubtitleAppearanceEditor";
import Reveal from "./Reveal";
import { COMPANION_PETS, COMPANION_FREQUENCIES, COMPANION_REGISTRY, companionImageUrl, normalizeCompanionPreferences, type CustomCompanion } from "../shared/companion";
import { messageFrom } from "./errors";

/** Every row applies as it changes; this is the page's word on how that went. Idle says nothing. */
export type SettingsSaveState = "idle" | "saved" | "saving" | "error";

interface Props {
  draft: Settings; setDraft: (settings: Settings) => void; saved: Settings; saveState: SettingsSaveState; onRetrySave: () => void;
  bookmarkCount: number; linkCount: number;
  onOpenLogs: () => void; onClearLinks: () => void;
  updateStatus?: UpdateStatus; updateChecking: boolean; onCheckUpdates: () => void; onOpenUpdate: () => void; onSkipUpdate: () => void;
  episodeUpdateStatus?: EpisodeUpdateStatus; onCheckEpisodes: () => void;
  updateInstall?: UpdateInstallStatus; onDownloadUpdate?: () => void; onInstallUpdate?: () => void;
  subtitleAppearance: SubtitleAppearance; onSubtitleAppearance: (value: SubtitleAppearance) => void;
  onCompanionHello: () => void;
  customCompanions: CustomCompanion[]; customCompanionImage?: string; companionIssue?: string;
  onImportCompanion: (name: string) => Promise<void>; onRemoveCompanion: (id: string) => Promise<void>;
}

interface Section { id: string; label: string }

/** The left rail lists every group heading on the page, so a new group with an id on its h3 joins it unprompted. */
function readSections(form: HTMLElement): { headings: HTMLElement[]; sections: Section[] } {
  const headings = [...form.querySelectorAll<HTMLElement>(":scope > .group > h3[id]")];
  return { headings, sections: headings.map((heading) => ({ id: heading.id, label: heading.textContent?.trim() || heading.id })) };
}

function useSectionNavigation() {
  const formRef = useRef<HTMLFormElement>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState<string>("");
  // A jump names its section until the user scrolls by hand: the smooth scroll would otherwise flicker through
  // the sections on the way, and a short last section never reaches the line that decides the current one.
  const pinned = useRef(false);
  useEffect(() => {
    const page = formRef.current?.closest<HTMLElement>(".page-settings");
    const form = formRef.current;
    if (!page || !form) return;
    let headings: HTMLElement[] = [];
    const update = () => {
      if (pinned.current || !headings.length) return;
      const line = page.getBoundingClientRect().top + 76;
      let current = headings[0].id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= line) current = heading.id;
      }
      // At the end of the page the last section is the current one, however little of the window it fills.
      const scrollable = page.scrollHeight > page.clientHeight;
      if (scrollable && page.scrollTop + page.clientHeight >= page.scrollHeight - 2 && headings.length) current = headings[headings.length - 1].id;
      setActive(current);
    };
    const release = () => { pinned.current = false; };
    const releaseOnKey = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) release(); };
    page.addEventListener("wheel", release, { passive: true });
    page.addEventListener("touchmove", release, { passive: true });
    page.addEventListener("pointerdown", release, { passive: true });
    page.addEventListener("keydown", releaseOnKey);
    page.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const scan = () => {
      const found = readSections(form);
      headings = found.headings;
      setSections((previous) => previous.length === found.sections.length && previous.every((section, index) => section.id === found.sections[index].id && section.label === found.sections[index].label) ? previous : found.sections);
      observer?.disconnect();
      observer?.observe(page);
      headings.forEach((heading) => observer?.observe(heading.parentElement ?? heading));
      update();
    };
    // Groups that mount or leave later keep the rail in step with the page.
    const groups = new MutationObserver(scan);
    groups.observe(form, { childList: true });
    scan();
    return () => {
      page.removeEventListener("wheel", release);
      page.removeEventListener("touchmove", release);
      page.removeEventListener("pointerdown", release);
      page.removeEventListener("keydown", releaseOnKey);
      page.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
      groups.disconnect();
    };
  }, []);
  const jump = (id: string) => {
    const page = formRef.current?.closest<HTMLElement>(".page-settings");
    const heading = document.getElementById(id);
    if (!page || !heading || !sections.some((section) => section.id === id)) return;
    const offset = page.querySelector(".settings-jump")?.getBoundingClientRect().height || 0;
    const top = page.scrollTop + heading.getBoundingClientRect().top - page.getBoundingClientRect().top - offset - 16;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setActive(id);
    pinned.current = true;
    // Restart the arrival mark even when the same section is picked twice.
    heading.classList.remove("jump-hit");
    void heading.offsetWidth;
    heading.classList.add("jump-hit");
    heading.addEventListener("animationend", () => heading.classList.remove("jump-hit"), { once: true });
    heading.focus({ preventScroll: true });
    page.scrollTo({ top, behavior: reducedMotion ? "instant" : "smooth" });
  };
  return { formRef, sections, active, jump };
}

const SAVE_WORDS: Record<SettingsSaveState, string> = { idle: "", saved: "Saved", saving: "Saving…", error: "Not saved" };

export default function SettingsScreen({ draft, setDraft, saved, saveState, onRetrySave, bookmarkCount, linkCount, onOpenLogs, onClearLinks,
  updateStatus, updateChecking, onCheckUpdates, onOpenUpdate, onSkipUpdate, episodeUpdateStatus, onCheckEpisodes, updateInstall, onDownloadUpdate, onInstallUpdate, subtitleAppearance, onSubtitleAppearance, onCompanionHello,
  customCompanions, customCompanionImage, companionIssue, onImportCompanion, onRemoveCompanion }: Props) {
  const { formRef, sections, active, jump } = useSectionNavigation();
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const [companionName, setCompanionName] = useState("");
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionError, setCompanionError] = useState<string>();
  return (
    <div className="settings-layout">
    <div className="settings-head"><h1>Settings</h1><UpdateNotice status={updateStatus} onJump={() => jump("settings-updates")} /><span className="save-state" data-state={saveState}><span key={saveState} className="save-word" role="status" aria-live="polite">{saveState === "saved" && <Icon name="check" />}{SAVE_WORDS[saveState]}</span>{saveState === "error" && <button type="button" className="save-retry" onClick={onRetrySave}>retry</button>}</span></div>
    <nav className="settings-section-nav" aria-label="Settings sections" style={{ "--i": Math.max(0, sections.findIndex((section) => section.id === active)) } as React.CSSProperties}><span className="rail-pill" aria-hidden="true" />{sections.map((section) => <button type="button" key={section.id} aria-current={active === section.id ? "location" : undefined} onClick={() => jump(section.id)}>{section.label}{section.id === "settings-updates" && updatePending(updateStatus) && <i className="rail-dot" aria-label="update available" />}</button>)}</nav>
    <form ref={formRef} className="settings" onSubmit={(event) => event.preventDefault()}>
      <div className="settings-jump"><label htmlFor="settings-section-jump">Jump to section</label><select id="settings-section-jump" value={active} onChange={(event) => jump(event.target.value)}>{sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></div>
      <div className="group"><h3 id="settings-playback" tabIndex={-1}>Playback</h3><div className="box">
        <div className="r"><span className="k">Player<small>Built-in works without installing another player</small></span><Chips value={draft.playbackTarget} options={["builtin", "external"] as const} onChange={(playbackTarget) => setDraft({ ...draft, playbackTarget })} names={{ builtin: "built-in" }} /></div>
        <div className="r"><span className="k">Start fullscreen<small>Enter fullscreen as soon as an episode starts</small></span><Switch checked={draft.startPlayerFullscreen} label="Start fullscreen" onChange={(startPlayerFullscreen) => setDraft({ ...draft, startPlayerFullscreen })} /></div>
        <div className="r"><span className="k">Autoplay next episode<small>Built-in player only. Waits five seconds and can be cancelled</small></span><Switch checked={draft.autoplayNext !== false} label="Autoplay next episode" onChange={(autoplayNext) => setDraft({ ...draft, autoplayNext })} /></div>
        <div className="r"><span className="k">Diagnostics<small>Local keyboard and playback logs for troubleshooting</small></span><span className="v-row"><button type="button" className="btn small" onClick={() => { onOpenLogs(); }}>open logs</button><Switch checked={draft.playerDiagnostics === true} label="Diagnostics logging" onChange={(playerDiagnostics) => setDraft({ ...draft, playerDiagnostics })} /></span></div>
        <div className="r"><label htmlFor="player" className="k">External player<small>Optional with the built-in player. {isMac() ? "mpv, VLC, or IINA's iina-cli" : "mpv or VLC, by name or full path"}</small></label><input id="player" value={draft.playerPath} placeholder={draft.playbackTarget === "external" ? (isMac() ? "iina-cli" : "mpv") : "optional"} spellCheck={false} onChange={(event) => setDraft({ ...draft, playerPath: event.target.value })} /></div>
        <SubtitleAppearanceRow value={subtitleAppearance} open={subtitlesOpen} onToggle={() => setSubtitlesOpen((open) => !open)} />
        <Reveal id="subtitle-editor" className="subtitle-body" open={subtitlesOpen}><SubtitleAppearanceEditor value={subtitleAppearance} onChange={onSubtitleAppearance} /></Reveal>
      </div></div>
      <div className="group"><h3 id="settings-defaults" tabIndex={-1}>Defaults</h3><div className="box">
        <div className="r"><span className="k">Quality<small>Best takes the highest stream a source offers</small></span><Chips value={draft.preferredQuality} options={QUALITIES} onChange={(preferredQuality) => setDraft({ ...draft, preferredQuality })} /></div>
        <div className="r"><span className="k">Audio<small>Used when a source offers both</small></span><Chips value={draft.preferredMode} options={["sub", "dub"] as const} onChange={(preferredMode) => setDraft({ ...draft, preferredMode })} /></div>
        <div className="r"><span className="k">Preferred source<small>Search checks every source that is on. Auto plays from the first available</small></span><Chips value={draft.preferredProvider} options={["auto", ...enabledProviders(draft)] as ProviderPreference[]} onChange={(preferredProvider) => setDraft({ ...draft, preferredProvider })} /></div>
      </div></div>
      <div className="group"><h3 id="settings-appearance" tabIndex={-1}>Appearance</h3><div className="box">
        <div className="r stack"><span className="k">Theme<small>Presets match common terminal schemes</small></span><span className="tiles" role="radiogroup" aria-label="theme">
          {THEME_NAMES.map((name) => {
            const colours = resolveTheme(name, draft.customTheme);
            return (
              <button type="button" key={name} role="radio" aria-checked={draft.theme === name} className={`tile${draft.theme === name ? " on" : ""}`}
                style={{ "--t-bg": colours.background, "--t-text": colours.text, "--t-cur": colours.highlight } as React.CSSProperties}
                onClick={() => setDraft({ ...draft, theme: name, customTheme: name === "custom" && draft.theme !== "custom" ? { ...resolveTheme(draft.theme, draft.customTheme) } : draft.customTheme })}>
                <span className="prev" aria-hidden="true"><i /><i /><b /></span><span>{name.replace("-", " ")}</span>
              </button>
            );
          })}
        </span></div>
        <Reveal open={draft.theme === "custom"} className="reveal-row">
          <div className="r"><span className="k">Custom colours<small>Every other tone is mixed from these three</small></span><span className="swatches">
            {(["background", "text", "highlight"] as const).map((key) => (
              <span className="swatch" key={key}>
                <input type="color" value={draft.customTheme[key]} aria-label={`${key} colour`} onChange={(event) => setDraft({ ...draft, customTheme: { ...draft.customTheme, [key]: event.target.value } })} />
                <span>{key}</span>
                <input value={draft.customTheme[key]} aria-label={`${key} hex`} maxLength={7} spellCheck={false} onChange={(event) => setDraft({ ...draft, customTheme: { ...draft.customTheme, [key]: event.target.value } })} />
              </span>
            ))}
          </span></div>
        </Reveal>
        <div className="r"><span className="k">Backdrop art<small>An illustration behind the home, browse, saved, and recent pages, from a hand-picked set on nekosapi.com. Off keeps them plain and fetches nothing</small></span><Switch checked={draft.emptyBackdrop !== false} label="Backdrop art" onChange={(emptyBackdrop) => setDraft({ ...draft, emptyBackdrop })} /></div>
        <div className="r"><span className="k">Watch companion<small>A little animated friend with preset comments while you browse and watch</small></span><Switch checked={draft.companionEnabled !== false} label="Watch companion" onChange={(companionEnabled) => setDraft({ ...draft, companionEnabled })} /></div>
        {draft.companionEnabled !== false && <>
          <div className="r stack"><span className="k">Choose your companion</span><div className="companion-choices" role="radiogroup" aria-label="Watch companion character">
            {COMPANION_PETS.map((id) => <button type="button" role="radio" aria-checked={normalizeCompanionPreferences(draft).companionPetId === id} className={`companion-choice ${normalizeCompanionPreferences(draft).companionPetId === id ? "on" : ""}`} key={id} onClick={() => setDraft({ ...draft, companionPetId: id })}>
              <span className="companion-choice-art" style={{ backgroundImage: `url(${companionImageUrl(id, import.meta.env.BASE_URL)})` }} aria-hidden="true" /><span>{COMPANION_REGISTRY[id].name}</span>
            </button>)}
            {customCompanions.map((pet) => <span className="companion-custom-entry" key={pet.id}>
              <button type="button" role="radio" aria-checked={draft.companionPetId === pet.id} disabled={pet.available === false} className={`companion-choice ${draft.companionPetId === pet.id ? "on" : ""}`} onClick={() => setDraft({ ...draft, companionPetId: pet.id })}>
                {draft.companionPetId === pet.id && customCompanionImage ? <span className="companion-choice-art" style={{ backgroundImage: `url(${customCompanionImage})` }} aria-hidden="true" /> : <span className="companion-choice-initial" aria-hidden="true">{pet.name[0]}</span>}
                <span>{pet.name}{pet.available === false ? " · missing" : ""}</span>
              </button>
              <button type="button" className="btn small" disabled={companionBusy} aria-label={`Remove ${pet.name}`} onClick={() => { setCompanionBusy(true); void onRemoveCompanion(pet.id).catch((error) => setCompanionError(messageFrom(error))).finally(() => setCompanionBusy(false)); }}>Remove</button>
            </span>)}
          </div></div>
          <div className="r"><span className="k">Allow wandering<small>Walks near its saved home while you browse. Reduced motion always stops wandering</small></span><Switch checked={draft.companionWander !== false} label="Allow companion wandering" onChange={(companionWander) => setDraft({ ...draft, companionWander })} /></div>
          <div className="r"><label className="k" htmlFor="companion-size">Companion size<small>Changes the companion, its speech bubble position, and wandering space</small></label><span className="companion-size-control"><input id="companion-size" type="range" min="50" max="200" step="10" value={normalizeCompanionPreferences(draft).companionSize} onChange={(event) => setDraft({ ...draft, companionSize: Number(event.target.value) })} /><output htmlFor="companion-size">{normalizeCompanionPreferences(draft).companionSize}%</output></span></div>
          <div className="r"><span className="k">Home position<small>Drag the companion, or focus it and use arrow keys, to move its home</small></span><button type="button" className="btn small" disabled={!draft.companionHome} onClick={() => setDraft({ ...draft, companionHome: undefined })}>Reset position</button></div>
          <div className="r"><label className="k" htmlFor="companion-name">Import companion<small>Choose a transparent 1536 × 1872 PNG or WebP sheet (8 MB maximum)</small></label><span className="v-row"><input id="companion-name" value={companionName} maxLength={40} placeholder="Companion name" onChange={(event) => setCompanionName(event.target.value)} /><button type="button" className="btn small" disabled={companionBusy || !companionName.trim() || customCompanions.length >= 20} onClick={() => { setCompanionBusy(true); setCompanionError(undefined); void onImportCompanion(companionName).then(() => setCompanionName(""), (error) => setCompanionError(messageFrom(error))).finally(() => setCompanionBusy(false)); }}>Import image</button></span></div>
          {(companionError || companionIssue) && <div className="r"><span role="alert" className="companion-import-error">{companionError || companionIssue}</span></div>}
          <div className="r stack companion-guide"><details><summary>How to make a custom companion</summary>
            <p>Make a transparent PNG or WebP image exactly 1536 × 1872 pixels. Divide it into 8 columns and 9 rows of 192 × 208 pixel cells. Leave unused cells transparent.</p>
            <p>Rows from top to bottom: idle (6 frames), run right (8), run left (8), wave (4), jump (5), failed (8), waiting (6), working (6), review (6). Place frames left to right in each row. The three included companions use this layout; this example shows Columbinya’s first frame.</p>
            <img className="companion-example-sheet" src={companionImageUrl("columbinya", import.meta.env.BASE_URL)} alt="Example 8-column, 9-row companion spritesheet" />
            <p>Enter a name and choose your file. The app checks its dimensions and decoding before saving it. The file is copied to this installation only; share the original image to use it on another computer. Imported companions use the same built-in dialogue.</p>
          </details></div>
          <div className="r"><span className="k">Chattiness<small>Preset comments are rate-limited; clicking the companion always makes it talk</small></span><Chips value={normalizeCompanionPreferences(draft).companionFrequency} options={COMPANION_FREQUENCIES} onChange={(companionFrequency) => setDraft({ ...draft, companionFrequency })} /></div>
          <div className="r"><span className="k">Preview<small>Say hello without changing your settings</small></span><button type="button" className="btn small" onClick={onCompanionHello}>Say hello</button></div>
        </>}
      </div></div>
      <IdentityIndexPanel saved={saved} draft={draft} onChange={setDraft} />
      <BookmarkMetadataPanel count={bookmarkCount} saved={saved} draft={draft} />
      <SourceStatusPanel saved={saved} draft={draft} onChange={setDraft}>
        <div className="r"><span className="k">Source links<small>{linkCount} remembered {linkCount === 1 ? "anime" : "anime"} with records on more than one source. Forget them if series show the wrong records together; splitting one source on its series page is the smaller fix</small></span><button type="button" className="btn small" disabled={!linkCount} onClick={onClearLinks}>forget links</button></div>
      </SourceStatusPanel>
      <div className="group"><h3 id="settings-episode-updates" tabIndex={-1}>Episode updates</h3><div className="box">
        <div className="r"><span className="k">Saved anime<small>{episodeUpdateStatus?.checking ? "Checking saved titles…" : episodeUpdateStatus?.error ?? (episodeUpdateStatus?.checkedAt ? `Last checked ${new Date(episodeUpdateStatus.checkedAt).toLocaleString()}` : "Checks shortly after startup and every six hours")}</small></span><button type="button" className="btn small" disabled={episodeUpdateStatus?.checking} onClick={onCheckEpisodes}>Check now</button></div>
        <div className="r"><span className="k">Desktop notifications<small>New episodes also remain in the app’s bell when system notifications are unavailable</small></span><Switch checked={draft.desktopEpisodeNotifications !== false} label="Desktop episode notifications" onChange={(desktopEpisodeNotifications) => setDraft({ ...draft, desktopEpisodeNotifications })} /></div>
      </div></div>
      <UpdatePanel status={updateStatus} checking={updateChecking} onCheck={onCheckUpdates} onOpen={onOpenUpdate} onSkip={onSkipUpdate}
        installStatus={updateInstall} onDownload={onDownloadUpdate} onInstall={onInstallUpdate} />
    </form>
    </div>
  );
}
