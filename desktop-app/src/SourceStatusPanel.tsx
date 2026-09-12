import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProviderName, ProviderSourceStatus, Settings } from "../shared/contracts";
import { catalogRequestId } from "./catalog-request";
import Switch from "./Switch";
import { catalogScope } from "../shared/settings";
import { messageFrom } from "./errors";

const SOURCES = [
  { provider: "aniwave", name: "AniWave", address: "aniwaveBaseUrl" },
  { provider: "anidb", name: "AniDB", address: "anidbBaseUrl" },
  { provider: "hianime", name: "HiAnime", address: "hianimeBaseUrl" }
] as const;
interface Session { active: boolean; requests: Map<ProviderName, string>; refresh: () => Promise<void>; }

export default function SourceStatusPanel({ saved, draft, onChange, children }: { saved: Settings; draft: Settings; onChange: (settings: Settings) => void; children?: ReactNode }) {
  const [statuses, setStatuses] = useState<ProviderSourceStatus[]>([]);
  const [checking, setChecking] = useState<Partial<Record<ProviderName, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<ProviderName, string>>>({});
  const [readError, setReadError] = useState<string>();
  const session = useRef<Session | undefined>(undefined);
  const scope = catalogScope(saved);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, revision = 0;
    const current: Session = { active: true, requests: new Map(), refresh: async () => {
      const token = ++revision;
      try {
        const values = await window.aniDesktop.sourceStatus();
        if (current.active && token === revision) { setStatuses(values); setReadError(undefined); }
      } catch (error) { if (current.active && token === revision) setReadError(messageFrom(error)); }
    } };
    session.current = current;
    setStatuses([]); setChecking({}); setErrors({}); setReadError(undefined);
    const poll = async () => {
      await current.refresh();
      if (current.active) timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => {
      current.active = false; clearTimeout(timer);
      for (const id of current.requests.values()) window.aniDesktop.cancelCatalog(id);
    };
  }, [scope]);

  const check = async (provider: ProviderName) => {
    const current = session.current;
    if (!current?.active || current.requests.has(provider)) return;
    const id = catalogRequestId("source-check"); current.requests.set(provider, id);
    setChecking((values) => ({ ...values, [provider]: true }));
    setErrors((values) => ({ ...values, [provider]: undefined }));
    try { await window.aniDesktop.checkSource(provider, { id, priority: "selected", refresh: true, checkNow: true }); }
    catch (error) { if (current.active) setErrors((values) => ({ ...values, [provider]: messageFrom(error) })); }
    finally {
      current.requests.delete(provider);
      if (current.active) {
        await current.refresh();
        if (current.active) setChecking((values) => ({ ...values, [provider]: false }));
      }
    }
  };

  return <div className="group source-status"><h3>Sources</h3>
    {readError && <p className="msg err" role="alert">Could not read source status: {readError}</p>}
    <div className="box">{SOURCES.map(({ provider, name, address }) => {
      const status = statuses.find((item) => item.provider === provider);
      const busy = checking[provider] || status?.state === "checking";
      const changed = draft[address] !== saved[address];
      const seconds = Math.max(0, Math.ceil(((status?.retryAt ?? 0) - Date.now()) / 1000));
      const wait = seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
      const checked = status?.checkedAt ? new Date(status.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined;
      const state = busy ? "checking" : status?.state ?? "unknown";
      const on = !(draft.disabledSources ?? []).includes(provider);
      const word = !on ? "Off" : busy ? "Checking…" : status?.state === "reachable" ? "Reachable" : status?.state === "paused" ? (seconds ? "Paused" : "Awaiting check")
        : status ? "Not checked" : readError ? "Status unavailable" : "Loading status";
      const detail = !on ? "not searched or loaded" : busy ? undefined : status?.state === "reachable" ? (checked && `checked ${checked}`)
        : status?.state === "paused" ? (seconds ? `${status.serverRequested ? "server requested a wait" : "automatic checks paused"} · ${wait}` : "the next request checks recovery") : undefined;
      const hint = on && changed ? "Save this address before checking." : undefined;
      const toggle = () => {
        const disabledSources = on ? [...(draft.disabledSources ?? []), provider] : (draft.disabledSources ?? []).filter((name) => name !== provider);
        // Switching off the preferred source would search nothing, so the preference returns to auto.
        onChange({ ...draft, disabledSources, preferredProvider: on && draft.preferredProvider === provider ? "auto" : draft.preferredProvider });
      };
      // Errors and hints share the status line rather than adding one, so rows keep one height; the title carries the full text.
      const tail = errors[provider] ?? hint ?? detail;
      return <div className="r source-row" key={provider} data-off={on ? undefined : "true"}>
        <span className="k" title={status?.origin}>
          <label htmlFor={provider} className="source-name"><i className="source-dot" data-state={on ? state : "off"} aria-hidden="true" />{name}</label>
          <small className="source-state" data-state={on ? state : "off"} role="status" title={[word, detail, hint, errors[provider]].filter(Boolean).join(" · ")}>
            {word}{tail && " · "}{errors[provider] ? <span className="err" role="alert">{errors[provider]}</span> : tail}
          </small>
        </span>
        <input id={provider} aria-label={`${name} address`} value={draft[address]} spellCheck={false}
          onChange={(event) => onChange({ ...draft, [address]: event.target.value })} />
        <button type="button" className="btn small" aria-label={`Check ${name} now`} disabled={!on || busy || changed || status?.canRetry === false}
          onClick={() => { void check(provider); }}>{busy ? "Checking…" : status?.state === "paused" ? "Retry" : "Check now"}</button>
        <Switch checked={on} label={`Use ${name}`} onChange={toggle} />
      </div>;
    })}{children}</div>
    <p className="group-note">Status reflects recent catalog requests. Playback hosts can have separate outages.</p>
  </div>;
}
