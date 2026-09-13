import type { RefObject } from "react";
import type { AnimeResult, Episode, EpisodeGroup, LibraryEntry, ProviderName, TranslationMode } from "../shared/contracts";
import { animeSources, providerFromId } from "../shared/catalog";
import { PLAYBACK_QUALITIES as QUALITIES } from "../shared/settings";
import { episodeRowsOf, type EpisodeRow, type EpisodeFilter, type EpisodeSort } from "./episodes";
import type { PlayStatus } from "./playback";
import type { useEpisodeMetadata } from "./useEpisodeMetadata";
import Art from "./Art";
import Chips from "./Chips";
import { Icon } from "./icons";
import { stagger } from "./transition";

const SKELETON_ROWS = 6;

interface Props {
  anime: AnimeResult; progress?: LibraryEntry; isSaved: boolean; player: string;
  mode: TranslationMode; quality: string; lastQuery: string; busy?: string; resolving: boolean;
  pendingSources: ProviderName[]; sourceErrors: Partial<Record<ProviderName, string>>;
  episodeGroups: EpisodeGroup[]; episodeRows: EpisodeRow[]; episodeCount: number; seriesCursor: number;
  nextUp?: EpisodeRow; episodeFilter: EpisodeFilter; episodeSort: EpisodeSort; jump: string;
  playingId?: string; status?: PlayStatus; metadata: ReturnType<typeof useEpisodeMetadata>; listRef: RefObject<HTMLDivElement | null>;
  onPlay: (episode: Episode) => void; onBookmark: () => void; onBack: () => void;
  onMode: (mode: TranslationMode) => void; onQuality: (quality: string) => void;
  onCheckSources: () => void; onRefreshSources: () => void; onJump: (value: string) => void;
  onCursor: (index: number) => void; onWatched: (episode: Episode) => void; onWatchedAll: () => void; onDismissStatus: () => void;
  reorder: (filter: EpisodeFilter, sort: EpisodeSort) => void;
}

export default function SeriesScreen({ anime, progress, isSaved, player, mode, quality, lastQuery, busy, resolving,
  pendingSources, sourceErrors, episodeGroups, episodeRows, episodeCount, seriesCursor, nextUp, episodeFilter, episodeSort,
  jump, playingId, status, metadata, listRef, onPlay, onBookmark, onBack, onMode, onQuality, onCheckSources, onRefreshSources,
  onJump, onCursor, onWatched, onWatchedAll, onDismissStatus, reorder }: Props) {
  const nextRow = episodeRows[seriesCursor];
  const hasEpisodes = episodeGroups.some((group) => group.episodes.length);
  const allWatched = hasEpisodes && episodeRowsOf(episodeGroups, progress, "unwatched", "oldest").length === 0;
  return (
    <div className="series">
      <aside className="side">
        <Art src={anime.poster} className="poster" />
        <div className="stack">
          <button type="button" className="btn primary" disabled={!nextUp} onClick={() => nextUp && onPlay(nextUp.episode)}>Play Ep {nextUp?.number ?? "…"}<Icon name="play" /></button>
          <button type="button" className="btn" onClick={() => onBookmark()} aria-pressed={isSaved}>{isSaved ? "Saved" : "Save"}<Icon name="bookmark" className={isSaved ? "fill" : undefined} /></button>
          <button type="button" className="btn" disabled={!hasEpisodes || allWatched} onClick={() => onWatchedAll()} title="Record every episode on every source as watched">{allWatched ? "All watched" : "Mark all watched"}<Icon name="check" /></button>
        </div>
        <div className="prefs">
          <Chips label="Audio" value={mode} options={["sub", "dub"] as const} onChange={onMode} />
          <Chips label="Quality" value={QUALITIES.includes(quality) ? quality : "best"} options={QUALITIES.slice(0, 4)} onChange={onQuality} />
        </div>
      </aside>
      <div className="main">
        <button type="button" className="crumb" onClick={onBack}><Icon name="back" />{lastQuery ? `Results for “${lastQuery}”` : "Home"}</button>
        <h1>{anime.title}</h1>
        <div className="meta">
          {animeSources(anime).map((source) => <span className="tag" key={source.id}>{source.provider}</span>)}
          {resolving && <span className="tag quiet" role="status">checking other sources{pendingSources.length ? `: ${pendingSources.join(", ")}` : ""}<span className="dots"> ···</span></span>}
          {animeSources(anime).find((source) => source.title !== anime.title) && <span>{animeSources(anime).find((source) => source.title !== anime.title)!.title}</span>}
        </div>
        <div className="facts">
          <div><small>Episodes</small>{episodeCount || (busy ? "…" : "none")}</div>
          <div><small>Progress</small>{progress ? `${progress.completed === false ? "Started" : "Watched through"} ${progress.lastEpisode}` : "Not started"}</div>
          <div><small>Last source</small>{progress ? `${progress.lastProvider ?? providerFromId(progress.animeId)} · ${progress.mode}` : "—"}</div>
          <div><small>Plays in</small>{player}</div>
        </div>
        {Object.entries(sourceErrors).map(([name, error]) => <div className="notice" key={name}>{name}: {error} <button type="button" className="link" onClick={() => onCheckSources()}>Check now</button></div>)}
        {episodeGroups.some((group) => group.refreshing) && <div className="notice" role="status">Showing cached episodes · refreshing sources</div>}
        {episodeGroups.filter((group) => group.error).map((group) => (
          <div className="msg err" role="alert" key={group.provider}><b>{group.provider}</b> {group.error} <button type="button" className="link" onClick={() => onCheckSources()}>Check now</button></div>
        ))}
        <div className="ep-head">
          <h2>Episodes</h2>
          <button type="button" className="btn small" onClick={onRefreshSources}>Refresh sources</button>
          <Chips value={episodeFilter} options={["all", "unwatched", "watched"] as const} onChange={(value) => reorder(value, episodeSort)} names={{ all: "All", unwatched: "Unwatched", watched: "Watched" }} />
          <label className="jump"><Icon name="search" /><input value={jump} onChange={(event) => onJump(event.target.value)} placeholder="Jump to" aria-label="Jump to episode" inputMode="numeric" /></label>
          <span className="sort" role="radiogroup" aria-label="Sort">
            <button type="button" role="radio" aria-checked={episodeSort === "oldest"} className={episodeSort === "oldest" ? "on" : ""} title="Oldest first" onClick={() => reorder(episodeFilter, "oldest")}><Icon name="up" /></button>
            <button type="button" role="radio" aria-checked={episodeSort === "newest"} className={episodeSort === "newest" ? "on" : ""} title="Newest first" onClick={() => reorder(episodeFilter, "newest")}><Icon name="down" /></button>
          </span>
        </div>
        <div className="eps" ref={listRef} tabIndex={-1} role="group" aria-label="Episodes">
          {episodeRows.length === 0 && !busy && !resolving && <div className="empty">{episodeFilter === "all" ? "No episodes found." : `No ${episodeFilter} episodes.`}</div>}
          {episodeRows.length === 0 && busy && Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className={`src-wrap skel ${index === 0 ? "first" : ""}`} style={stagger(index, SKELETON_ROWS)} aria-hidden="true">
              {index === 0 && <h4 className="grp-head">Loading</h4>}
              <div className="src"><span className="src-hit"><span className="t" /></span></div>
            </div>
          ))}
          {episodeRows.map((row, index) => {
            const info = metadata.get(row.episode.id);
            const isCursor = index === seriesCursor;
            const groupCursor = nextRow?.number === row.number;
            return (
              <div key={row.episode.id} className={`src-wrap ${row.first ? "first" : ""} ${groupCursor ? "in-cur" : ""}`} style={stagger(index, 14)}>
                {row.first && <h4 className="grp-head">Ep {row.number}{nextUp?.number === row.number && <span className="up">Next up</span>}</h4>}
                <div className={`src ${row.watched ? "w" : ""} ${isCursor ? "cur" : ""} ${playingId === row.episode.id ? "playing" : ""}`} data-cursor={isCursor} data-episode={row.episode.id}>
                  <button type="button" className="src-hit" tabIndex={isCursor ? 0 : -1} onFocus={() => onCursor(index)}
                    onClick={() => onPlay(row.episode)} aria-label={`play episode ${row.number} from ${row.episode.provider}`}>
                    <span className="t">Episode {row.number}<small>{row.episode.provider}</small>{playingId === row.episode.id && <em>playing</em>}</span>
                    {info?.availability && <span className="audio-availability" title="Audio listed by a supported provider server">{[info?.availability?.sub && "sub", info?.availability?.dub && "dub"].filter(Boolean).join(" · ") || "no audio"}</span>}
                    {info?.quality ? <span className="q">{info?.quality}</span>
                      : info?.phase === "audio" ? <span className="metadata-status">checking audio</span>
                      : info?.phase === "quality" ? <span className="metadata-status">checking quality</span>
                      : info?.availability?.[mode] === false ? <span className="metadata-status">no {mode}</span> : null}
                    <Icon name="play" className="play" />
                  </button>
                  {info?.phase === "error" && <button type="button" className="metadata-retry" title={info?.error} aria-label={`retry metadata for episode ${row.number} from ${row.episode.provider}`} onClick={() => metadata.retry(row.episode.id)}>Retry info</button>}
                  <button type="button" className="chk" role="checkbox" aria-checked={row.watched} aria-label={`mark watched through episode ${row.number} on ${row.episode.provider}`} title="Mark watched through here" onClick={() => onWatched(row.episode)}>
                    {row.watched && <Icon name="check" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {status && (
          <div className={`status ${status.phase === "failed" ? "err" : ""}`} role="status">
            <b>Episode {status.episode.number}</b>
            <span>
              {status.phase === "finding" && <>Finding a stream<span className="dots"> ···</span></>}
              {status.phase === "opening" && <>Opening {player}<span className="dots"> ···</span></>}
              {status.phase === "opened" && `Opened in ${player}`}
              {status.phase === "failed" && status.detail}
            </span>
            {status.phase !== "failed" && <span className="detail">{status.detail}</span>}
            <button type="button" className="link" onClick={onDismissStatus}>{status.phase === "finding" || status.phase === "opening" ? "Cancel" : "Dismiss"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
