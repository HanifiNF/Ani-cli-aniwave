import { useEffect, useRef, useState } from "react";
import type { BookmarkMetadataProgress, Settings } from "../shared/contracts";
import { enabledProviders } from "../shared/catalog";
import { METADATA_LIMIT } from "../shared/episode-metadata";

const sourceSettings = (settings: Settings) => JSON.stringify([settings.aniwaveBaseUrl, settings.anidbBaseUrl, settings.hianimeBaseUrl, enabledProviders(settings)]);

export default function BookmarkMetadataPanel({ count, saved, draft }: { count: number; saved: Settings; draft: Settings }) {
  const [progress, setProgress] = useState<BookmarkMetadataProgress>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const session = useRef({ active: true, busy: false, revision: 0 });
  useEffect(() => {
    const current = { active: true, busy: false, revision: 0 };
    session.current = current;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const revision = current.revision;
      try {
        if (!current.busy) {
          const value = await window.aniDesktop.bookmarkMetadataStatus();
          if (current.active && revision === current.revision) { setProgress(value); setError(""); }
        }
      } catch (failure) {
        if (current.active && revision === current.revision) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (current.active) { setLoading(false); timer = setTimeout(() => void read(), 1000); }
      }
    };
    void read();
    // Settings observes the app-owned job. Leaving only stops these local status reads.
    return () => { current.active = false; clearTimeout(timer); };
  }, []);

  const action = async (cancel: boolean) => {
    const current = session.current;
    if (current.busy) return;
    current.busy = true; current.revision++;
    setBusy(true); setError("");
    try {
      const result = await (cancel ? window.aniDesktop.cancelBookmarkMetadata() : window.aniDesktop.fetchBookmarkMetadata());
      if (current.active) setProgress(result);
    } catch (failure) {
      if (current.active) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  };
  const stopping = progress?.state === "cancelling";
  const running = progress?.state === "running" || stopping;
  const changed = sourceSettings(saved) !== sourceSettings(draft);
  const disabledReason = changed ? "Save source changes before fetching." : !count ? "Bookmark a series to prepare its episode metadata." : !enabledProviders(saved).length ? "Turn on a source and save changes before fetching." : undefined;
  return <div className="group">
    <h3>Episode metadata</h3>
    <div className="box">
      <div className="r">
        <span className="k">Bookmarked series<small>Cache sub/dub availability and resolution for all {count} bookmarked series, using enabled sources.</small></span>
        {running ? <button type="button" className="btn small" disabled={busy || stopping} onClick={() => void action(true)}>{stopping ? "Stopping…" : "Cancel fetch"}</button>
          : <button type="button" className="btn small" disabled={loading || busy || !!disabledReason} onClick={() => void action(false)}>{loading ? "Checking status…" : busy ? "Starting…" : "Fetch bookmark metadata"}</button>}
      </div>
      {progress && <div className="r stack" role="status" aria-live="polite">
        <span className="k">{stopping ? "Stopping…" : running ? `Fetching: ${progress.currentSeries ?? "bookmarked series"}` : progress.state === "cancelled" ? "Fetch cancelled. Completed metadata is saved." : progress.state === "failed" ? "Fetch stopped. Completed metadata is saved." : progress.skippedSources.length || progress.failedEpisodes ? "Finished with some metadata unavailable." : "Bookmark metadata is ready."}
          <small>{progress.seriesDone} / {progress.seriesTotal} series processed · {progress.updatedEpisodes} episode records updated · {progress.cachedEpisodes} already fresh{progress.failedEpisodes ? ` · ${progress.failedEpisodes} incomplete` : ""}</small>
          {!!progress.skippedSources.length && <small>Sources skipped: {progress.skippedSources.join(", ")}. Check their status below, then run again.</small>}
        </span>
      </div>}
      {(error || progress?.error) && <div className="r" role="alert">{error || progress?.error}</div>}
    </div>
    <p className="group-note">{disabledReason ?? "Fresh metadata is reused. Large libraries can take a while. Fetching continues while you browse. Return here to check progress or cancel. Quitting the app or saving source changes stops the fetch and keeps completed results."} The cache holds up to {METADATA_LIMIT.toLocaleString()} episode records across sources; metadata refreshes as it ages.</p>
  </div>;
}
