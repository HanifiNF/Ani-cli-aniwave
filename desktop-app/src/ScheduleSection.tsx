import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnimeResult, Episode, LibraryEntry, ScheduleArtwork, ScheduleEntry, ScheduleResult, SeriesMetadataCatalog, Settings, TranslationMode } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import Art from "./Art";
import { catalogRequestId } from "./catalog-request";
import GenreChips from "./GenreChips";
import { localDateKey, msUntilNextLocalDay, releaseCountdown, releaseHasPassed, scheduleDayBounds, scheduleDays, seasonLabel, selectionAfterDayChange } from "./schedule";
import { messageFrom } from "./errors";
import { stagger } from "./transition";
import { pressProps } from "./press";

const titleKey = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function libraryPoster(anime: AnimeResult, entries: LibraryEntry[]): string | undefined {
  const ids = new Set(animeSources(anime).map((source) => source.id));
  const aliases = new Set(animeSources(anime).flatMap((source) => [source.title, ...source.aliases]).map(titleKey));
  return entries.find((entry) => animeSources(entry).some((source) => ids.has(source.id)))?.poster
    ?? entries.find((entry) => animeSources(entry).some((source) => [source.title, ...source.aliases].some((alias) => aliases.has(titleKey(alias)))))?.poster;
}

function LazyScheduleArt({ anime, src, onArtwork, onVisible }: { anime: AnimeResult; src?: string; onArtwork: (value: ScheduleArtwork) => void; onVisible: (anime: AnimeResult) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const id = catalogRequestId("schedule-artwork");
    let requested = false;
    const load = () => {
      if (requested) return; requested = true; onVisible(anime);
      if (!src) void window.aniDesktop.scheduleArtwork(anime.id, { id, priority: "visible" }).then(onArtwork).catch(() => undefined);
    };
    const observer = "IntersectionObserver" in window ? new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: "160px" }) : undefined;
    if (observer && ref.current) observer.observe(ref.current); else load();
    return () => { observer?.disconnect(); window.aniDesktop.cancelCatalog(id); };
  }, [anime.id, src, onArtwork, onVisible]);
  return <span ref={ref} className="schedule-art"><Art src={src} className="poster" /></span>;
}

interface Props {
  settings: Settings;
  library: LibraryEntry[];
  onOpen: (anime: AnimeResult, episode: Episode, mode: TranslationMode) => void;
  metadataFor?: (anime: AnimeResult) => SeriesMetadataCatalog | undefined;
  onMetadata?: (anime: AnimeResult) => void;
}

export default function ScheduleSection({ settings, library, onOpen, metadataFor = () => undefined, onMetadata = () => undefined }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [loaded, setLoaded] = useState<{ identity: string; value: ScheduleResult }>();
  const [artwork, setArtwork] = useState<Record<string, ScheduleArtwork>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const requestGeneration = useRef(0);
  const todayRef = useRef(localDateKey(now));
  const days = useMemo(() => scheduleDays(now), [localDateKey(now)]);
  const { utcStart, utcEnd } = scheduleDayBounds(selectedDate);
  const [mode, setMode] = useState<TranslationMode>(settings.preferredMode);
  const sourceScope = `${settings.aniwaveBaseUrl}|${(settings.disabledSources ?? []).includes("aniwave")}`;
  const requestIdentity = `${sourceScope}|${selectedDate}|${utcStart}|${utcEnd}|${mode}`;
  const result = loaded?.identity === requestIdentity ? loaded.value : undefined;

  useEffect(() => setMode(settings.preferredMode), [settings.preferredMode]);
  useEffect(() => setArtwork({}), [sourceScope]);
  useEffect(() => {
    const update = () => {
      const value = new Date(), today = localDateKey(value);
      setNow(value);
      if (today !== todayRef.current) {
        const previous = todayRef.current; todayRef.current = today;
        setSelectedDate((selected) => selectionAfterDayChange(selected, previous, value));
      }
    };
    // The strip shifts as the local day turns; the minute poll and the focus check cover sleep and clock changes.
    let midnight: number;
    const arm = () => { midnight = window.setTimeout(() => { update(); arm(); }, msUntilNextLocalDay(new Date())); };
    arm();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearTimeout(midnight); window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);

  useEffect(() => {
    const id = catalogRequestId("schedule");
    const generation = ++requestGeneration.current;
    setLoading(true); setError(undefined);
    window.aniDesktop.schedule({ date: selectedDate, utcStart, utcEnd, mode }, { id, priority: "selected", refresh: retry > 0, checkNow: retry > 0 })
      .then((value) => { if (requestGeneration.current === generation) setLoaded({ identity: requestIdentity, value }); },
        (reason) => { if (requestGeneration.current === generation) setError(messageFrom(reason)); })
      .finally(() => { if (requestGeneration.current === generation) setLoading(false); });
    return () => { if (requestGeneration.current === generation) requestGeneration.current += 1; window.aniDesktop.cancelCatalog(id); };
  }, [requestIdentity, retry]);

  const rows = result?.requestedDate === selectedDate
    ? [...result.entries].sort((left, right) => left.releaseAt.localeCompare(right.releaseAt) || left.anime.title.localeCompare(right.anime.title))
    : [];
  const unavailable = result?.requestedDate === selectedDate && result.status === "unavailable";
  const displayError = error ?? result?.error;
  const zone = new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value;
  const rememberArtwork = useCallback((value: ScheduleArtwork) => setArtwork((current) => current[value.animeId] ? current : { ...current, [value.animeId]: value }), []);

  return <section className="section section-schedule" aria-labelledby="schedule-heading">
    <div className="section-head">
      <h2 id="schedule-heading">Schedule</h2>
      <span className="schedule-sub">{seasonLabel(now)} · estimated release times · {zone ?? "local time"}</span>
      <div className="schedule-days" role="tablist" aria-label="Schedule day">
        {days.map((day) => <button type="button" role="tab" key={day.date} aria-selected={day.date === selectedDate}
          aria-label={`${day.weekday} ${day.dateLabel}${day.today ? ", today" : ""}`} title={day.dateLabel}
          className={`${day.date === selectedDate ? "on" : ""} ${day.today ? "today" : ""}`} {...pressProps(() => setSelectedDate(day.date))}>
          {day.weekday}<small>{day.dayOfMonth}</small>
        </button>)}
      </div>
      <div className="schedule-audio" role="group" aria-label="Schedule audio">
        {(["sub", "dub"] as const).map((value) => <button type="button" key={value} className={mode === value ? "on" : ""} aria-pressed={mode === value} {...pressProps(() => setMode(value))}>{value.toUpperCase()}</button>)}
      </div>
    </div>
    <div className="cards" role="group" aria-labelledby="schedule-heading" aria-live="polite" aria-busy={loading}>
      {rows.map((entry: ScheduleEntry, order) => {
        const extra = artwork[entry.anime.id];
        const poster = entry.anime.poster ?? libraryPoster(entry.anime, library) ?? extra?.poster;
        const sources = animeSources(entry.anime).map((source) => ({ ...source, aliases: [...new Set([...source.aliases, ...(extra?.aliases ?? [])])], poster: source.poster ?? poster }));
        const anime = { ...entry.anime, title: entry.anime.title || extra?.title || "Untitled", poster, sources };
        const genres = metadataFor(anime)?.genres ?? [];
        const past = releaseHasPassed(entry.releaseAt, now);
        const time = clock(entry.releaseAt);
        const countdown = releaseCountdown(entry.releaseAt, now);
        const sub = past ? `Aired · ${time}` : countdown ? `${time} · ${countdown}` : time;
        return <div className={`card schedule-card ${past ? "aired" : "upcoming"}`} key={`${entry.episode.id}:${entry.releaseAt}`} style={stagger(order, 10)}>
          <button type="button" className="hit" onClick={() => onOpen(anime, entry.episode, mode)}
            aria-label={`Open ${anime.title}, episode ${entry.episode.number}, ${past ? "aired" : "airs"} ${time}`}>
            <LazyScheduleArt anime={anime} src={poster} onArtwork={rememberArtwork} onVisible={onMetadata} />
            <span className="badges"><span className="badge">EP {entry.episode.number}</span></span>
          </button>
          <span className="t">{anime.title}</span><span className="s">{sub}</span>
          <GenreChips genres={genres} />
        </div>;
      })}
    </div>
    {loading && rows.length === 0 && <div className="schedule-state">Loading schedule ···</div>}
    {!loading && (unavailable || (!displayError && rows.length === 0)) && <div className="schedule-state">{unavailable ? "Schedule unavailable for this date." : "No releases listed for this date."}</div>}
    {displayError && <div className="schedule-state schedule-error">
      <span>{result?.status === "stale" && rows.length ? `Showing saved schedule · ${displayError}` : displayError}</span>
      <button type="button" className="link" onClick={() => setRetry((value) => value + 1)}>Retry</button>
    </div>}
  </section>;
}
