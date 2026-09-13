import type { Dispatch, SetStateAction } from "react";
import type { ProviderPreference, Settings } from "../shared/contracts";
import { enabledProviders } from "../shared/catalog";
import { PLAYBACK_QUALITIES as QUALITIES } from "../shared/settings";
import { THEME_NAMES, resolveTheme } from "../shared/theme";
import Chips from "./Chips";
import Switch from "./Switch";
import { isMac } from "./keys";
import SourceStatusPanel from "./SourceStatusPanel";
import BookmarkMetadataPanel from "./BookmarkMetadataPanel";

interface Props {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings>>; saved: Settings;
  bookmarkCount: number; linkCount: number; dirty: boolean;
  onSave: () => void; onCancel: () => void; onOpenLogs: () => void; onClearLinks: () => void;
}

export default function SettingsScreen({ draft, setDraft, saved, bookmarkCount, linkCount, dirty, onSave, onCancel, onOpenLogs, onClearLinks }: Props) {
  return (
    <form className="settings" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <h1>Settings</h1>
      <div className="group"><h3>Playback</h3><div className="box">
        <div className="r"><span className="k">Player<small>Built-in works without installing another player</small></span><Chips value={draft.playbackTarget} options={["builtin", "external"] as const} onChange={(playbackTarget) => setDraft({ ...draft, playbackTarget })} names={{ builtin: "built-in" }} /></div>
        <div className="r"><span className="k">Start fullscreen<small>Enter fullscreen as soon as an episode starts</small></span><Switch checked={draft.startPlayerFullscreen} label="Start fullscreen" onChange={(startPlayerFullscreen) => setDraft({ ...draft, startPlayerFullscreen })} /></div>
        <div className="r"><span className="k">Autoplay next episode<small>Built-in player only. Waits five seconds and can be cancelled</small></span><Switch checked={draft.autoplayNext !== false} label="Autoplay next episode" onChange={(autoplayNext) => setDraft({ ...draft, autoplayNext })} /></div>
        <div className="r"><span className="k">Diagnostics<small>Local keyboard and playback logs for troubleshooting</small></span><span className="v-row"><button type="button" className="btn small" onClick={() => { onOpenLogs(); }}>open logs</button><Switch checked={draft.playerDiagnostics === true} label="Diagnostics logging" onChange={(playerDiagnostics) => setDraft({ ...draft, playerDiagnostics })} /></span></div>
        <div className="r"><label htmlFor="player" className="k">External player<small>Optional with the built-in player. {isMac() ? "mpv, VLC, or IINA's iina-cli" : "mpv or VLC, by name or full path"}</small></label><input id="player" value={draft.playerPath} placeholder={draft.playbackTarget === "external" ? (isMac() ? "iina-cli" : "mpv") : "optional"} spellCheck={false} onChange={(event) => setDraft({ ...draft, playerPath: event.target.value })} /></div>
      </div></div>
      <div className="group"><h3>Defaults</h3><div className="box">
        <div className="r"><span className="k">Quality<small>Best takes the highest stream a source offers</small></span><Chips value={draft.preferredQuality} options={QUALITIES} onChange={(preferredQuality) => setDraft({ ...draft, preferredQuality })} /></div>
        <div className="r"><span className="k">Audio<small>Used when a source offers both</small></span><Chips value={draft.preferredMode} options={["sub", "dub"] as const} onChange={(preferredMode) => setDraft({ ...draft, preferredMode })} /></div>
        <div className="r"><span className="k">Preferred source<small>Search checks every source that is on. Auto plays from the first available</small></span><Chips value={draft.preferredProvider} options={["auto", ...enabledProviders(draft)] as ProviderPreference[]} onChange={(preferredProvider) => setDraft({ ...draft, preferredProvider })} /></div>
      </div></div>
      <div className="group"><h3>Appearance</h3><div className="box">
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
        {draft.theme === "custom" && (
          <div className="r"><span className="k">Custom colours<small>Every other tone is mixed from these three</small></span><span className="swatches">
            {(["background", "text", "highlight"] as const).map((key) => (
              <span className="swatch" key={key}>
                <input type="color" value={draft.customTheme[key]} aria-label={`${key} colour`} onChange={(event) => setDraft({ ...draft, customTheme: { ...draft.customTheme, [key]: event.target.value } })} />
                <span>{key}</span>
                <input value={draft.customTheme[key]} aria-label={`${key} hex`} maxLength={7} spellCheck={false} onChange={(event) => setDraft({ ...draft, customTheme: { ...draft.customTheme, [key]: event.target.value } })} />
              </span>
            ))}
          </span></div>
        )}
      </div></div>
      <BookmarkMetadataPanel count={bookmarkCount} saved={saved} draft={draft} />
      <SourceStatusPanel saved={saved} draft={draft} onChange={setDraft}>
        <div className="r"><span className="k">Source links<small>{linkCount} remembered {linkCount === 1 ? "match" : "matches"} between providers. Forget them if a series shows the wrong records together</small></span><button type="button" className="btn small" disabled={!linkCount} onClick={() => onClearLinks()}>forget links</button></div>
      </SourceStatusPanel>
      <div className="acts-row"><button type="button" className="btn" onClick={onCancel}>cancel</button><button type="submit" className="btn primary" disabled={!dirty}>save changes</button></div>
    </form>
  );
}
