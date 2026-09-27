import { useEffect, useLayoutEffect, useRef, useState, type Ref, type RefObject } from "react";
import type { EpisodeUpdate, EpisodeUpdateStatus } from "../shared/contracts";
import Art from "./Art";
import { Icon } from "./icons";
import { play, stagger } from "./transition";
import { springCurve } from "./motion";

interface Actions {
  status?: EpisodeUpdateStatus;
  posterFor: (update: EpisodeUpdate) => string | undefined;
  onEpisode: (id: string) => void;
  onSeries: (id: string) => void;
  onMarkRead: (id?: string) => void;
  /** Resolves false when the removal could not be saved. */
  onDismiss: (id?: string) => Promise<boolean>;
}

interface PanelProps extends Actions { panelRef?: Ref<HTMLElement>; closing?: boolean; onClose: () => void; onViewAll: () => void }

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  return now;
}

export function notificationAge(time: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(time).toLocaleDateString();
}

const title = (update: EpisodeUpdate) => `Episode ${update.episodeNumber} of ${update.title}`;
const message = (update: EpisodeUpdate) => `Episode ${update.episodeNumber} is now available!`;

// Each step of these sequences eases on the glide spring; the panel closes on the quick "out" spring.
const EASE = springCurve("glide").easing;
const OUT = springCurve("out");

// A row's box, and the same box flattened to nothing; the negative margin takes up the list's gap.
function box(row: HTMLElement): Keyframe {
  const style = getComputedStyle(row);
  return { height: `${row.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth, marginBottom: "0px" };
}
function flat(row: HTMLElement): Keyframe {
  const gap = row.parentElement ? parseFloat(getComputedStyle(row.parentElement).rowGap) || 0 : 0;
  return { height: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px", marginBottom: `${-gap}px` };
}

/** A removed row slides aside and fades, then closes its gap so the rows below glide up. */
function leave(row: HTMLElement, delay: number) {
  const from = box(row);
  const run = play(row, [
    { ...from, opacity: getComputedStyle(row).opacity, transform: "none", easing: EASE },
    { ...from, opacity: 0, transform: "translateX(14px)", offset: .4, easing: EASE },
    { ...flat(row), opacity: 0, transform: "translateX(14px)" }
  ], { duration: 380, delay, fill: "forwards" });
  if (run) row.style.overflow = "hidden";
  return run;
}

/** Play rows out 30 ms apart, then remove them; if the removal fails they come back. */
function removeRows(rows: HTMLElement[], remove: () => Promise<boolean>) {
  const fresh = rows.filter((row) => !row.dataset.leaving);
  if (rows.length && !fresh.length) return;
  const runs = fresh.flatMap((row, index) => {
    const run = leave(row, index * 30);
    if (!run) return [];
    row.dataset.leaving = "true";
    return [{ row, run }];
  });
  if (!runs.length) { void remove(); return; }
  void Promise.all(runs.map(({ run }) => run.finished)).then(remove).then((saved) => {
    if (saved) return;
    for (const { row, run } of runs) { run.cancel(); row.style.overflow = ""; delete row.dataset.leaving; }
  }, () => undefined);
}

/** A row that joins a list already on screen opens a gap at its place, then fades in. */
function arrive(row: HTMLElement) {
  const to = box(row);
  const run = play(row, [
    { ...flat(row), opacity: 0, transform: "translateY(-6px)", easing: EASE },
    { ...to, opacity: 0, transform: "translateY(-6px)", offset: .45, easing: EASE },
    { ...to, transform: "none" }
  ], { duration: 420 });
  if (!run) return;
  row.style.overflow = "hidden";
  void run.finished.then(() => { row.style.overflow = ""; }, () => undefined);
}

/** Rows present on the first render keep their staggered rise; later ones make room for themselves. */
function useArrivals(list: RefObject<HTMLElement | null>, updates: EpisodeUpdate[] | undefined) {
  const seen = useRef<Set<string>>(undefined);
  useLayoutEffect(() => {
    if (!updates) return;
    const previous = seen.current;
    seen.current = new Set(updates.map((update) => update.id));
    if (!previous || !list.current) return;
    for (const row of list.current.querySelectorAll<HTMLElement>("[data-id]")) if (!previous.has(row.dataset.id!)) arrive(row);
  }, [list, updates]);
}

/** Keeps the bell panel on screen while it plays its closing pop after `open` turns false. */
export function usePanelPresence(open: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(open);
  useLayoutEffect(() => {
    if (open) { setShown(true); return; }
    const run = play(ref.current, [{ opacity: 0, transform: "scale(.98)" }], { duration: OUT.ms, easing: OUT.easing, fill: "forwards" });
    if (!run) { setShown(false); return; }
    void run.finished.then(() => setShown(false), () => undefined);
    return () => run.cancel();
  }, [open]);
  return { ref, shown: open || shown, closing: !open && shown };
}

function Poster({ update, posterFor }: { update: EpisodeUpdate; posterFor: Actions["posterFor"] }) {
  return <Art src={posterFor(update)} className="notification-poster" />;
}

export default function EpisodeUpdatesPanel({ status, posterFor, onEpisode, onDismiss, onClose, onViewAll, panelRef, closing }: PanelProps) {
  const now = useClock();
  const list = useRef<HTMLDivElement>(null);
  useArrivals(list, status?.updates);
  const clear = () => removeRows([...(list.current?.querySelectorAll<HTMLElement>(".notification-preview") ?? [])], () => onDismiss());
  return <section ref={panelRef} className={`episode-updates-panel${closing ? " closing" : ""}`} aria-label="Notifications" inert={closing}>
    <header><strong>Notifications</strong><span className="notification-panel-actions"><button type="button" onClick={clear} disabled={!status?.updates.length}>Clear <Icon name="trash" /></button><button type="button" onClick={onClose} aria-label="Close notifications"><Icon name="x" /></button></span></header>
    <div className="episode-updates-list" ref={list}>
      {status?.updates.length ? status.updates.map((update, index) => <article className={`notification-preview${update.readAt ? " read" : " unread"}`} key={update.id} data-id={update.id} style={stagger(index, 10)}>
        <Poster update={update} posterFor={posterFor} />
        <div className="notification-preview-copy"><b><span className="notification-dot" aria-hidden="true" />{title(update)}</b><p>{message(update)}</p>
          <div className="notification-preview-foot"><button type="button" onClick={() => onEpisode(update.id)}>View episode <Icon name="chevron" /></button><time dateTime={new Date(update.detectedAt).toISOString()}>{notificationAge(update.detectedAt, now)}</time></div>
        </div>
      </article>) : <p className="notification-empty">No notifications yet.</p>}
    </div>
    <button type="button" className="episode-updates-view-all" onClick={onViewAll}>View all notifications <Icon name="chevron" /></button>
  </section>;
}

export function EpisodeUpdatesPage({ status, posterFor, onEpisode, onSeries, onMarkRead, onDismiss }: Actions) {
  const now = useClock();
  const list = useRef<HTMLDivElement>(null);
  useArrivals(list, status?.updates);
  const unread = status?.unreadCount ?? 0;
  return <section className="notifications-page" aria-labelledby="notifications-heading">
    <div className="notifications-page-head"><div><h1 id="notifications-heading">Notifications</h1><span className="notifications-unread-count"><span key={unread}>{unread}</span> new</span></div>
      <button type="button" className="btn" onClick={() => onMarkRead()} disabled={!unread}><Icon name="check" /> Mark all as read</button>
    </div>
    <div className="notifications-page-list" ref={list} data-origin-group="notifications">{status?.updates.length ? status.updates.map((update, index) => <article className={`notification-card${update.readAt ? " read" : " unread"}`} key={update.id} data-id={update.id} data-origin={update.id} style={stagger(index, 8)}>
      <div className="notification-card-head"><Poster update={update} posterFor={posterFor} /><h2>{title(update)}</h2><span className="notification-card-actions">
        {/* Stays mounted once read so it can fold away rather than vanish. */}
        <button type="button" className="notification-mark-read" aria-label={`Mark ${title(update)} as read`} title="Mark as read" disabled={Boolean(update.readAt)} onClick={() => onMarkRead(update.id)}><Icon name="check" /></button>
        <button type="button" aria-label={`Delete ${title(update)}`} title="Delete notification" onClick={(event) => removeRows([event.currentTarget.closest("article")!], () => onDismiss(update.id))}><Icon name="x" /></button>
      </span></div>
      <p>{message(update)}</p>
      <div className="notification-card-foot"><time dateTime={new Date(update.detectedAt).toISOString()}>{notificationAge(update.detectedAt, now)}</time><span>
        <button type="button" className="btn small" onClick={() => onSeries(update.id)}>Series <Icon name="chevron" /></button>
        <button type="button" className="btn small" onClick={() => onEpisode(update.id)}>View episode <Icon name="chevron" /></button>
      </span></div>
    </article>) : <p className="notification-empty">No notifications yet. Updates for saved anime will appear here.</p>}</div>
  </section>;
}
