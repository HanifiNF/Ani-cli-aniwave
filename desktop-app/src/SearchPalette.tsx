import type { AnimeResult } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import Art from "./Art";
import { Icon } from "./icons";
import { stagger } from "./transition";
import Swap from "./Swap";

interface Props {
  results: AnimeResult[]; query: string; lastQuery: string; cursor: number;
  ready: boolean; pending: boolean; providerErrors: string[]; message?: string; error?: string; closeHint: string;
  onRetry: () => void; onOpen: (anime: AnimeResult) => void; onFocus: (index: number) => void;
}

export default function SearchPalette({ results, query, lastQuery, cursor, ready, pending, providerErrors, message, error, closeHint, onRetry, onOpen, onFocus }: Props) {
  return (
    <div className="palette" role="dialog" aria-label="Search results">
      <div className="found" id="results-heading" aria-live="polite">
        {ready || results.length ? <Swap id={`${results.length}|${lastQuery}`}>{results.length} {results.length === 1 ? "result" : "results"} for "{lastQuery}"</Swap> : pending ? "Searching…" : "Press Enter to search"}
      </div>
      {message && <div className={`msg ${error ? "err" : ""}`} role={error ? "alert" : "status"} title={providerErrors.join("; ") || undefined}>{message}{providerErrors.length > 0 && <button type="button" className="link" onClick={onRetry}>Retry search</button>}</div>}
      <div className="section-results" role="listbox" aria-label="Results">
        {results.map((anime, index) => {
          const sources = animeSources(anime);
          const alias = sources.find((source) => source.title !== anime.title)?.title;
          // One chip per provider; a provider with several copies of the anime still shows once.
          const providers = [...new Set(sources.map((source) => source.provider))];
          return (
            <div key={anime.id} className={`hit-row ${index === cursor ? "cur" : ""}`} data-cursor={index === cursor} style={stagger(index, 8)}>
              <button type="button" className="hit" role="option" aria-selected={index === cursor} onClick={() => onOpen(anime)} onFocus={() => onFocus(index)}>
                <span className="thumb"><Art src={anime.poster} /></span>
                <span className="text">
                  <span className="t">{anime.title}</span>
                  {alias && <span className="s">{alias}</span>}
                  <span className="srcs" aria-label={`Sources: ${providers.join(", ")}`}>
                    {providers.map((provider) => <span className="tag" key={provider}>{provider}</span>)}
                    {anime.tentative && <span className="tag quiet" title="Grouped by title. Open the series to split a source that does not belong.">grouped by title</span>}
                  </span>
                </span>
                <Icon name="chevron" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="foot-hints"><span><b>↑↓</b> move</span><span><b>↵</b> {query.trim() && !ready ? "search now" : "open"}</span><span><b>esc</b> {closeHint}</span></div>
    </div>
  );
}
