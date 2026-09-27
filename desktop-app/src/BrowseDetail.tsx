import { useLayoutEffect } from "react";
import type { BrowseAnime, BrowseFilters } from "../shared/contracts";
import Art from "./Art";
import { landSeries } from "./flight";
import CopyTitle from "./CopyTitle";
import { Icon } from "./icons";

const STATUS_WORDS: Record<BrowseAnime["status"], string> = { finished: "Finished", ongoing: "Airing", upcoming: "Upcoming", unknown: "Unknown" };

export default function BrowseDetail({ anime, resolving, error, onBack, onRetry, onSearch, onBrowse }: { anime: BrowseAnime; resolving: boolean; error?: string; onBack: () => void; onRetry: () => void; onSearch: () => void; onBrowse: (filters: Partial<BrowseFilters>) => void }) {
  // The card that opened this title lends it its poster, as a series page does.
  useLayoutEffect(() => landSeries(document.querySelector<HTMLElement>(".browse-detail .side .poster")), [anime.anilistId]);
  return <div className="series browse-detail">
    <header className="series-top"><button type="button" className="crumb" onClick={onBack}><Icon name="back" />Browse</button><h1>{anime.title}<CopyTitle title={anime.title} /></h1>
      <div className="meta"><span className="tag quiet">AniList catalog</span>{resolving && <span className="tag quiet">checking streaming sources<span className="dots"> ···</span></span>}</div></header>
    <aside className="side"><Art src={anime.cover} className="poster" /><div className="genre-bubbles" aria-label="Genres">{anime.genres.map((genre) => <button type="button" key={genre} title={`Browse ${genre} anime`} onClick={() => onBrowse({ includeGenres: [genre] })}>{genre}</button>)}</div></aside>
    <main className="main"><div className="facts"><div><small>Format</small>{anime.type ?? "Unknown"}</div><div><small>Year</small>{anime.year ?? "Unknown"}</div><div><small>Status</small>{STATUS_WORDS[anime.status]}</div><div><small>Announced total</small>{anime.episodes ?? "Unknown"}</div>{anime.score && <div><small>Score</small>{(anime.score / 10).toFixed(1)}</div>}</div>
      {anime.description && <section className="about"><p className="synopsis open">{anime.description}</p></section>}
      {!resolving && <div className={error ? "msg err" : "notice"} role={error ? "alert" : "status"}><span>{error ?? "No matching source found."}</span><button type="button" className="link" onClick={onRetry}>Retry source search</button><button type="button" className="link" onClick={onSearch}>Search manually</button></div>}
    </main>
  </div>;
}
