import type { AnimeResult } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import Art from "./Art";
import { Icon } from "./icons";
import { stagger } from "./transition";

interface Props {
  results: AnimeResult[]; query: string; lastQuery: string; cursor: number;
  ready: boolean; pending: boolean; providerErrors: string[]; message?: string; error?: string;
  onRetry: () => void; onOpen: (anime: AnimeResult) => void; onFocus: (index: number) => void;
  canMerge: (anime: AnimeResult) => boolean; onMerge: (anime: AnimeResult) => void;
}

export default function SearchPalette({ results, query, lastQuery, cursor, ready, pending, providerErrors, message, error, onRetry, onOpen, onFocus, canMerge, onMerge }: Props) {
  return (
    <div className="palette" role="dialog" aria-label="Search results">
      <div className="found" id="results-heading" aria-live="polite">
        {ready || results.length ? <>{results.length} {results.length === 1 ? "result" : "results"} for "{lastQuery}"</> : pending ? "Searching…" : "Press Enter to search"}
      </div>
      {message && <div className={`msg ${error ? "err" : ""}`} role={error ? "alert" : "status"} title={providerErrors.join("; ") || undefined}>{message}{providerErrors.length > 0 && <button type="button" className="link" onClick={onRetry}>Retry search</button>}</div>}
      <div className="section-results" role="listbox" aria-label="Results">
        {results.map((anime, index) => {
          const sources = animeSources(anime);
          const others = sources.filter((source) => source.id !== anime.id);
          const alias = others.find((source) => source.title !== anime.title)?.title;
          const merge = canMerge(anime);
          return (
            <div key={anime.id} className={`hit-row ${index === cursor ? "cur" : ""}`} data-cursor={index === cursor} style={stagger(index, 8)}>
              <button type="button" className="hit" role="option" aria-selected={index === cursor} onClick={() => onOpen(anime)} onFocus={() => onFocus(index)}>
                <span className="thumb"><Art src={anime.poster} /></span>
                <span className="text">
                  <span className="t">{anime.title}</span>
                  {alias && <span className="s">{alias}</span>}
                </span>
                <Icon name="chevron" />
              </button>
              {merge && <button type="button" className="mini-act" onClick={() => onMerge(anime)}>merge</button>}
            </div>
          );
        })}
      </div>
      <div className="foot-hints"><span><b>↑↓</b> move</span><span><b>↵</b> {query.trim() && !ready ? "search now" : "open"}</span><span><b>esc</b> close</span></div>
    </div>
  );
}
