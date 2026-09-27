import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AnimeResult, BrowseFilters, Episode, EpisodeGroup, LibraryEntry, ProviderName, SeriesMetadataCatalog, TranslationMode, WorkInfo } from "../shared/contracts";
import { animeSources, providerFromId } from "../shared/catalog";
import { PLAYBACK_QUALITIES as QUALITIES } from "../shared/settings";
import { episodeRowsOf, type EpisodeRow, type EpisodeFilter, type EpisodeSort } from "./episodes";
import type { PlayStatus } from "./playback";
import type { useEpisodeMetadata } from "./useEpisodeMetadata";
import Art from "./Art";
import Chips from "./Chips";
import CopyTitle from "./CopyTitle";
import { Icon } from "./icons";
import { stagger } from "./transition";
import { pressProps } from "./press";
import { useIndicator } from "./useIndicator";
import { landSeries } from "./flight";
import { setPlayOrigin } from "./playerMotion";
import Swap from "./Swap";

const SKELETON_ROWS = 6;

interface Props {
  anime: AnimeResult; progress?: LibraryEntry; isSaved: boolean; player: string; backLabel?: string;
  mode: TranslationMode; quality: string; lastQuery: string; busy?: string; resolving: boolean;
  pendingSources: ProviderName[]; sourceErrors: Partial<Record<ProviderName, string>>;
  episodeGroups: EpisodeGroup[]; episodeRows: EpisodeRow[]; episodeCount: number;
  seriesMetadata?: SeriesMetadataCatalog;
  info?: WorkInfo;
  /** The information is still on its way: its room is held so the episode list does not drop when it lands. */
  infoLoading?: boolean;
  nextUp?: EpisodeRow; episodeFilter: EpisodeFilter; episodeSort: EpisodeSort; jump: string;
  playingId?: string; status?: PlayStatus; metadata: ReturnType<typeof useEpisodeMetadata>; listRef: RefObject<HTMLDivElement | null>;
  onPlay: (episode: Episode) => void; onBookmark: () => void; onBack: () => void;
  onMode: (mode: TranslationMode) => void; onQuality: (quality: string) => void;
  onCheckSources: () => void; onRefreshSources: () => void; onJump: (value: string) => void;
  onWatched: (episode: Episode) => void; onWatchedAll: () => void; onDismissStatus: () => void;
  reorder: (filter: EpisodeFilter, sort: EpisodeSort) => void;
  onRefreshInfo: () => void; onSplitSource: (sourceId: string) => void;
  onBrowse: (filters: Partial<BrowseFilters>) => void;
}

const STATUS_WORDS: Record<WorkInfo["status"], string> = { finished: "Finished", ongoing: "Airing", upcoming: "Upcoming", unknown: "Unknown" };
const TYPE_WORDS: Record<NonNullable<WorkInfo["type"]>, string> = { TV: "TV", MOVIE: "Movie", OVA: "OVA", ONA: "ONA", SPECIAL: "Special", MUSIC: "Music" };

export default function SeriesScreen({ anime, progress, isSaved, player, backLabel, mode, quality, lastQuery, busy, resolving,
  pendingSources, sourceErrors, episodeGroups, episodeRows, seriesMetadata, info, infoLoading = false, nextUp, episodeFilter, episodeSort,
  jump, playingId, status, metadata, listRef, onPlay, onBookmark, onBack, onMode, onQuality, onCheckSources, onRefreshSources,
  onJump, onWatched, onWatchedAll, onDismissStatus, reorder, onRefreshInfo, onSplitSource, onBrowse }: Props) {
  const [showAll, setShowAll] = useState(false);
  const sortRef = useRef<HTMLSpanElement>(null), sortIndicator = useRef<HTMLElement>(null);
  useIndicator(sortRef, sortIndicator, '[aria-checked="true"]', episodeSort);
  // A poster that opened this title lands on this one.
  useLayoutEffect(() => landSeries(document.querySelector<HTMLElement>(".series .side .poster"), anime.id), [anime.id]);
  const hasEpisodes = episodeGroups.some((group) => group.episodes.length);
  const sources = animeSources(anime);
  const genres = [...new Map([...(seriesMetadata?.genres ?? []), ...(info?.genres ?? [])].map((genre) => [genre.toLocaleLowerCase(), genre])).values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const format = info ? [info.type && TYPE_WORDS[info.type], info.year && `${info.season ? `${info.season[0].toUpperCase()}${info.season.slice(1)} ` : ""}${info.year}`].filter(Boolean).join(" · ") : "";
  // The romaji title from the information service, or failing that another source's title, names the anime a second way.
  const alias = info?.titles.romaji && info.titles.romaji !== anime.title ? info.titles.romaji : sources.find((source) => source.title !== anime.title)?.title;
  const allWatched = hasEpisodes && episodeRowsOf(episodeGroups, progress, "unwatched", "oldest").length === 0;
  const counts = (kind: "available" | "announced"): string => {
    const values = animeSources(anime).flatMap((source) => {
      const live = kind === "available" ? episodeGroups.find((group) => group.provider === source.provider && group.episodes.length)?.episodes.length : undefined;
      const stored = seriesMetadata?.sources.find((item) => item.sourceId === source.id)
        ?? seriesMetadata?.sources.find((item) => item.provider === source.provider);
      const value = live ?? (kind === "available" ? stored?.availableEpisodes : stored?.announcedEpisodes);
      return value ? [{ provider: source.provider, value }] : [];
    }).filter((item, index, all) => all.findIndex((other) => other.provider === item.provider) === index);
    if (!values.length) return kind === "available" && busy ? "…" : "Unknown";
    return values.every((item) => item.value === values[0].value) ? String(values[0].value)
      : values.map((item) => `${item.provider} ${item.value}`).join(" · ");
  };
  return (
    <div className="series">
      <header className="series-top">
        <button type="button" className="crumb" onClick={onBack}><Icon name="back" />{backLabel ?? (lastQuery ? `Results for “${lastQuery}”` : "Home")}</button>
        <h1>{anime.title}<CopyTitle title={anime.title} /></h1>
        <div className="meta">
          {sources.map((source) => <span className="tag src-tag" key={source.id} title={source.title}>{source.provider}
            {sources.length > 1 && <button type="button" className="split" aria-label={`Split ${source.provider} record “${source.title}” off this series`} title="Not the same anime? Split this source off" onClick={() => onSplitSource(source.id)}><Icon name="x" /></button>}
          </span>)}
          {anime.tentative && <span className="tag quiet" title="These sources were grouped by title alone. Split one off if it does not belong.">grouped by title</span>}
          {alias && <span>{alias}</span>}
          {/* Last in the row, so nothing moves when the check finishes. */}
          {resolving && <span className="tag quiet" role="status">checking other sources{pendingSources.length ? `: ${pendingSources.join(", ")}` : ""}<span className="dots"> ···</span></span>}
        </div>
      </header>
      <aside className="side">
        <Art src={anime.poster ?? info?.cover} className="poster" />
        <div className="stack">
          <button type="button" className="btn primary" disabled={!nextUp} onClick={(event) => { if (!nextUp) return; setPlayOrigin(event.currentTarget); onPlay(nextUp.episode); }}><Swap id={nextUp?.number ?? "…"}>Play Ep {nextUp?.number ?? "…"}</Swap><Icon name="play" /></button>
          <button type="button" className="btn" onClick={() => onBookmark()} aria-pressed={isSaved}><Swap id={isSaved ? "saved" : "save"}>{isSaved ? "Saved" : "Save"}</Swap><Icon name="bookmark" className={isSaved ? "fill" : undefined} /></button>
          <button type="button" className="btn" disabled={!hasEpisodes || allWatched} onClick={() => onWatchedAll()} title="Record every episode on every source as watched"><Swap id={allWatched ? "all" : "mark"}>{allWatched ? "All watched" : "Mark all watched"}</Swap><Icon name="check" /></button>
        </div>
        {genres.length ? <div className="genre-bubbles" aria-label="Genres">
          {genres.map((genre) => <button type="button" key={genre.toLocaleLowerCase()} title={`Browse ${genre} anime`} onClick={() => onBrowse({ includeGenres: [genre] })}>{genre}</button>)}
        </div> : null}
        <div className="prefs">
          <Chips label="Audio" value={mode} options={["sub", "dub"] as const} onChange={onMode} />
          <Chips label="Quality" value={QUALITIES.includes(quality) ? quality : "best"} options={QUALITIES.slice(0, 4)} onChange={onQuality} />
        </div>
      </aside>
      <div className="main">
        <div className="facts">
          {format ? <div><small>Format</small>{format}</div> : infoLoading && <div><small>Format</small><span className="wait">…</span></div>}
          {!info && infoLoading && <div><small>Status</small><span className="wait">…</span></div>}
          {info && <div><small>Status</small>{STATUS_WORDS[info.status]}{info.nextAiring ? ` · ep ${info.nextAiring.episode} ${new Date(info.nextAiring.airingAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}` : ""}</div>}
          <div><small>Available episodes</small>{counts("available")}</div>
          <div><small>Announced total</small>{counts("announced") === "Unknown" && info?.episodes ? String(info.episodes) : counts("announced")}</div>
          {info?.studios.length ? <div><small>Studio</small>{info.studios.map((studio, index) => <span key={studio}>{index > 0 && ", "}<button type="button" className="studio-link" title={`Browse anime by ${studio}`} onClick={() => onBrowse({ search: studio, sort: "match" })}>{studio}</button></span>)}</div> : null}
          {info?.score ? <div><small>Score</small>{(info.score / 10).toFixed(1)}</div> : null}
          {!info && infoLoading && <><div><small>Studio</small><span className="wait">…</span></div><div><small>Score</small><span className="wait">…</span></div></>}
          <div><small>Progress</small>{progress ? `${progress.completed === false ? "Started" : "Watched through"} ${progress.lastEpisode}` : "Not started"}</div>
          <div><small>Last source</small>{progress ? `${progress.lastProvider ?? providerFromId(progress.animeId)} · ${progress.mode}` : "—"}</div>
          <div><small>Plays in</small>{player}</div>
        </div>
        {!info && infoLoading && <section className="about about-wait" aria-hidden="true"><i /><i /><i /><b /></section>}
        {info && (
          <section className="about" aria-label="About this series">
            {info.description && <p className={`synopsis ${showAll ? "open" : ""}`}>{info.description}</p>}
            <div className="about-row">
              {info.description && info.description.length > 320 && <button type="button" className="link" onClick={() => setShowAll((value) => !value)}>{showAll ? "Less" : "More"}</button>}
              <span className="about-src">{info.stale ? (info.error ? `AniList · cached, refresh failed: ${info.error}` : "AniList · refreshing") : "AniList"}<button type="button" className="link" onClick={onRefreshInfo}>Refresh info</button></span>
            </div>
          </section>
        )}
        {info?.tags?.length ? <section className="series-tags" aria-label="Tags">
          <h2>Tags</h2>
          <div className="genre-bubbles">{info.tags.map((tag) => <button type="button" key={tag} title={`Browse anime tagged ${tag}`} onClick={() => onBrowse({ tags: [tag] })}>{tag}</button>)}</div>
        </section> : null}
        {Object.entries(sourceErrors).map(([name, error]) => <div className="notice" key={name}>{name}: {error} <button type="button" className="link" onClick={() => onCheckSources()}>Check now</button></div>)}
        {episodeGroups.filter((group) => group.error).map((group) => (
          <div className="msg err" role="alert" key={group.provider}><b>{group.provider}</b> {group.error} <button type="button" className="link" onClick={() => onCheckSources()}>Check now</button></div>
        ))}
        <div className="ep-head">
          <h2>Episodes</h2>
          <button type="button" className="btn small" onClick={onRefreshSources}>Refresh sources</button>
          <Chips value={episodeFilter} options={["all", "unwatched", "watched"] as const} onChange={(value) => reorder(value, episodeSort)} names={{ all: "All", unwatched: "Unwatched", watched: "Watched" }} />
          <label className="jump"><Icon name="search" /><input value={jump} onChange={(event) => onJump(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onJump(event.currentTarget.value); }} placeholder="Jump to" aria-label="Jump to episode" inputMode="numeric" /></label>
          <span className="sort" role="radiogroup" aria-label="Sort" ref={sortRef}>
            <i className="chips-ind" ref={sortIndicator} aria-hidden="true" />
            <button type="button" role="radio" aria-checked={episodeSort === "oldest"} className={episodeSort === "oldest" ? "on" : ""} title="Oldest first" {...pressProps(() => reorder(episodeFilter, "oldest"))}><Icon name="up" /></button>
            <button type="button" role="radio" aria-checked={episodeSort === "newest"} className={episodeSort === "newest" ? "on" : ""} title="Newest first" {...pressProps(() => reorder(episodeFilter, "newest"))}><Icon name="down" /></button>
          </span>
        </div>
        <div className="eps" ref={listRef} role="group" aria-label="Episodes">
          {episodeRows.length === 0 && !busy && !resolving && <div className="empty">{episodeFilter === "all" ? "No episodes found." : `No ${episodeFilter} episodes.`}</div>}
          {episodeRows.length === 0 && busy && Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className={`src-wrap skel ${index === 0 ? "first" : ""}`} style={stagger(index, SKELETON_ROWS)} aria-hidden="true">
              {index === 0 && <h4 className="grp-head">Loading</h4>}
              <div className="src"><span className="src-hit"><span className="t" /></span></div>
            </div>
          ))}
          {episodeRows.map((row, index) => {
            const info = metadata.get(row.episode.id);
            return (
              <div key={row.episode.id} className={`src-wrap ${row.first ? "first" : ""}`} style={stagger(index, 14)}>
                {row.first && <h4 className="grp-head">Ep {row.number}{nextUp?.number === row.number && <span className="up">Next up</span>}</h4>}
                <div className={`src ${row.watched ? "w" : ""} ${playingId === row.episode.id ? "playing" : ""}`} data-episode={row.episode.id} data-episode-number={row.number}>
                  <button type="button" className="src-hit"
                    onClick={(event) => { setPlayOrigin(event.currentTarget.closest(".src")); onPlay(row.episode); }} aria-label={`play episode ${row.number} from ${row.episode.provider}`}>
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
