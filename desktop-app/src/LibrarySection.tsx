import type { LibraryEntry } from "../shared/contracts";
import type { LibraryKind, LibraryRow } from "./library";
import { episodeValue } from "./episodes";
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

interface CardActions {
  onActivate: (row: LibraryRow) => void;
  onRemove: (row: LibraryRow) => void;
  onFocus: (index: number) => void;
  canMerge: (entry: LibraryEntry) => boolean;
  onMerge: (entry: LibraryEntry) => void;
}

function LibraryCard({ row, index, order, current, onActivate, onRemove, onFocus, canMerge, onMerge }: CardActions & { row: LibraryRow; index: number; order: number; current: boolean }) {
  const { entry } = row;
  const next = entry.completed === false ? entry.lastEpisode : String(Number.isFinite(episodeValue(entry.lastEpisode)) ? episodeValue(entry.lastEpisode) + 1 : entry.lastEpisode);
  const progress = Object.entries(entry.progressByProvider ?? {}).map(([name, value]) => `${name} ${value?.lastEpisode}`).join(" · ");
  const sub = row.kind === "recent" ? when(entry.updatedAt)
    : row.kind === "continue" ? `Ep ${entry.lastEpisode} · ${when(entry.updatedAt)}`
    : `${entry.completed === false ? "Started" : "Watched through"} ${progress || entry.lastEpisode}`;
  const label = row.kind === "saved" ? `open ${entry.title}` : entry.completed === false ? `resume ${entry.title}` : `play next episode of ${entry.title}`;
  return <div className={`card ${current ? "cur" : ""}`} data-cursor={current} style={stagger(order, 10)}>
    <button type="button" className="hit" onClick={() => onActivate(row)} onFocus={() => { if (index >= 0) onFocus(index); }} aria-label={label}>
      <Art src={entry.poster} className="poster" />
      <span className="badges"><span className="badge hi">EP {next}</span><span className="badge">{entry.mode.toUpperCase()}</span></span>
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
}

export default function LibrarySection({ kind, heading, items, cursor, onMore, onClearHistory, ...actions }: Props) {
  if (!items.length) return null;
  return <section className={`section section-${kind}`} aria-labelledby={`${kind}-heading`}>
    <div className="section-head">
      <h2 id={`${kind}-heading`}>{onMore ? <button type="button" onClick={onMore}>{heading}<Icon name="chevron" /></button> : heading}</h2>
      {!onMore && <span className="count">{items.length} {items.length === 1 ? "title" : "titles"}</span>}
      {onClearHistory && <button type="button" className="more" onClick={onClearHistory}>Clear history</button>}
      {onMore && <button type="button" className="more" onClick={onMore}>See all</button>}
    </div>
    <div className="cards" role="group" aria-labelledby={`${kind}-heading`}>
      {items.map(({ row, index }, order) => <LibraryCard key={row.entry.animeId} row={row} index={index} order={order} current={index === cursor} {...actions} />)}
    </div>
  </section>;
}
