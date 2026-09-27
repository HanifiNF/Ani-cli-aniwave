import { useEffect, useRef } from "react";
import type { LibraryEntry, SeriesMetadataCatalog } from "../shared/contracts";
import { animeSources, providerFromId } from "../shared/catalog";
import type { LibraryKind, LibraryRow } from "./library";
import Art from "./Art";
import { Icon } from "./icons";
import { stagger } from "./transition";

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const day = 86_400_000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= today) return `today ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (date.getTime() >= today - day) return "yesterday";
  if (date.getTime() >= today - 6 * day) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** How far a library entry is watched on its last source, and how many episodes that source has out (when known). */
export function cardProgress(entry: LibraryEntry, metadata: SeriesMetadataCatalog | undefined, freshCounts?: Record<string, number>): { watched: string; available?: number } {
  const provider = entry.lastProvider ?? providerFromId(entry.animeId);
  const watched = entry.progressByProvider?.[provider]?.lastEpisode ?? entry.lastEpisode;
  const sourceId = animeSources(entry).find((source) => source.provider === provider)?.id;
  const available = (sourceId ? freshCounts?.[sourceId] : undefined) ?? metadata?.sources.find((source) => source.sourceId === sourceId)?.availableEpisodes
    ?? metadata?.sources.find((source) => source.provider === provider)?.availableEpisodes;
  return { watched, available };
}

interface CardActions {
  onActivate: (row: LibraryRow) => void;
  onRemove: (row: LibraryRow) => void;
  onFocus: (index: number) => void;
  canMerge: (entry: LibraryEntry) => boolean;
  onMerge: (entry: LibraryEntry) => void;
  metadataFor: (entry: LibraryEntry) => SeriesMetadataCatalog | undefined;
  onMetadata: (entry: LibraryEntry) => void;
  freshCounts?: Record<string, number>;
}

function LibraryCard({ row, index, order, current, resuming, onActivate, onRemove, onFocus, canMerge, onMerge, metadataFor, onMetadata, freshCounts }: CardActions & { row: LibraryRow; index: number; order: number; current: boolean; resuming: boolean }) {
  const { entry } = row;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let requested = false;
    const load = () => { if (!requested) { requested = true; onMetadata(entry); } };
    const observer = "IntersectionObserver" in window ? new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: "160px" }) : undefined;
    if (observer && ref.current) observer.observe(ref.current); else load();
    return () => observer?.disconnect();
  }, [entry, onMetadata]);
  const { watched, available } = cardProgress(entry, metadataFor(entry), freshCounts);
  const progress = Object.entries(entry.progressByProvider ?? {}).map(([name, value]) => `${name} ${value?.lastEpisode}`).join(" · ");
  const sub = row.kind === "recent" ? `${entry.completed === false ? `Started ${watched} · ` : ""}${when(entry.updatedAt)}`
    : row.kind === "continue" ? `${entry.completed === false ? "Started" : "Watched through"} ${watched} · ${when(entry.updatedAt)}`
    : `${entry.completed === false ? "Started" : "Watched through"} ${progress || entry.lastEpisode}`;
  const label = row.kind === "saved" ? `open ${entry.title}` : entry.completed === false ? `resume ${entry.title}` : `play next episode of ${entry.title}`;
  // While its next episode is found, the card carries the travelling arc; a second press stops it.
  return <div ref={ref} className={`card ${current ? "cur" : ""} ${resuming ? "is-resolving" : ""}`} data-cursor={current} data-anime={entry.animeId} data-origin={entry.animeId} style={stagger(order, 10)}>
    <button type="button" className="hit" onClick={() => onActivate(row)} onFocus={() => { if (index >= 0) onFocus(index); }} aria-label={resuming ? `stop finding the next episode of ${entry.title}` : label} aria-busy={resuming || undefined}>
      <Art src={entry.poster} className="poster" />
      <span className="badges"><span className="badge hi">EP {watched}/{available ?? "?"}</span><span className="badge">{entry.mode.toUpperCase()}</span></span>
    </button>
    <span className="t">{entry.title}</span><span className="s">{sub}</span>
    <span className="card-acts">
      {canMerge(entry) && <button type="button" className="mini-act" title="Merge with a matching title" onClick={() => onMerge(entry)}>merge</button>}
      <button type="button" className="mini-act" aria-label={`remove ${entry.title}`} title="Remove" onClick={() => onRemove(row)}><Icon name="x" /></button>
    </span>
  </div>;
}

interface Props extends CardActions {
  kind: LibraryKind; heading: string; items: { row: LibraryRow; index: number }[]; cursor: number;
  onMore?: () => void; onClearHistory?: () => void;
  /** The card (by anime id) whose next episode is being found. */
  resumingId?: string;
}

export default function LibrarySection({ kind, heading, items, cursor, onMore, onClearHistory, resumingId, ...actions }: Props) {
  if (!items.length) return null;
  return <section className={`section section-${kind}`} aria-labelledby={`${kind}-heading`} data-origin-group={kind}>
    <div className="section-head">
      <h2 id={`${kind}-heading`}>{onMore ? <button type="button" onClick={onMore}>{heading}<Icon name="chevron" /></button> : heading}</h2>
      {!onMore && <span className="count">{items.length} {items.length === 1 ? "title" : "titles"}</span>}
      {onClearHistory && <button type="button" className="more" onClick={onClearHistory}>Clear history</button>}
      {onMore && <button type="button" className="more" onClick={onMore}>See all</button>}
    </div>
    <div className="cards" role="group" aria-labelledby={`${kind}-heading`}>
      {items.map(({ row, index }, order) => <LibraryCard key={row.entry.animeId} row={row} index={index} order={order} current={index === cursor} resuming={row.entry.animeId === resumingId} {...actions} />)}
    </div>
  </section>;
}
