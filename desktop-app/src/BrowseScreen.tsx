import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BrowseAnime, BrowseFilters, BrowseProgress, BrowseResult, BrowseSort, BrowseStudio, MediaType } from "../shared/contracts";
import Art from "./Art";
import { catalogRequestId } from "./catalog-request";
import Chips from "./Chips";
import { messageFrom } from "./errors";
import GenreChips from "./GenreChips";
import { Icon } from "./icons";
import Reveal from "./Reveal";
import { stagger } from "./transition";
import { pressProps } from "./press";
import TypeAhead from "./TypeAhead";

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = { includeGenres: [], excludeGenres: [], sort: "popularity" };
export interface BrowseViewState {
  filters: BrowseFilters;
  /** Loaded pages in order; "Show more" appends the next one. */
  pages: BrowseResult[];
  panelOpen: boolean;
  scrollTop: number;
  /** The sort to return to once a search term, which brings "Best match", is cleared. */
  sortBefore?: BrowseSort;
}

export const DEFAULT_BROWSE_STATE: BrowseViewState = { filters: DEFAULT_BROWSE_FILTERS, pages: [], panelOpen: false, scrollTop: 0 };

/** The suggestion row stays mounted while it closes; only an open one takes focus. */
const SUGGESTION = '.reveal[data-open="true"] .browse-suggest button';
const TYPING_PAUSE = 400, SEARCH_PAUSE = 600, SEARCH_MINIMUM = 2;
const SORTS: [BrowseSort, string][] = [["match", "Best match"], ["popularity", "Popular"], ["score", "Top rated"], ["newest", "Newest"], ["title", "A–Z"]];
const FORMATS = ["Any", "TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"] as const;
const FORMAT_NAMES = { MOVIE: "Movie", SPECIAL: "Special", MUSIC: "Music" } as const;
const STATUSES = ["Any", "ongoing", "finished", "upcoming"] as const;
const STATUS_NAMES = { ongoing: "Airing", finished: "Finished", upcoming: "Upcoming" } as const;
const SEASONS = ["Any", "winter", "spring", "summer", "fall"] as const;
const SEASON_NAMES = { winter: "Winter", spring: "Spring", summer: "Summer", fall: "Fall" } as const;

type Field = "year" | "minimumScore" | "minimumEpisodes" | "maximumEpisodes";
type Texts = Record<Field, string>;
const textsOf = (filters: BrowseFilters): Texts => ({
  year: String(filters.year ?? ""), minimumScore: filters.minimumScore === undefined ? "" : String(filters.minimumScore / 10),
  minimumEpisodes: String(filters.minimumEpisodes ?? ""), maximumEpisodes: String(filters.maximumEpisodes ?? "")
});
const wholeOf = (text: string): number | undefined => /^\d+$/.test(text.trim()) ? Number(text) : undefined;
/** Cards show scores out of ten; AniList filters on a hundred-point scale. */
const scoreOf = (text: string): number | undefined => /^\d{1,2}(?:\.\d)?$/.test(text.trim()) ? Math.round(Number(text) * 10) : undefined;
const valuesOf = (texts: Texts): Pick<BrowseFilters, Field> => ({ year: wholeOf(texts.year), minimumScore: scoreOf(texts.minimumScore), minimumEpisodes: wholeOf(texts.minimumEpisodes), maximumEpisodes: wholeOf(texts.maximumEpisodes) });
function problemsOf(texts: Texts): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {}, values = valuesOf(texts);
  const outside = (name: Field, min: number, max: number) => texts[name].trim() !== "" && (values[name] === undefined || values[name] < min || values[name] > max);
  if (outside("year", 1900, 2200)) problems.year = "Enter a year from 1900 to 2200";
  if (outside("minimumScore", 1, 100)) problems.minimumScore = "Enter a score from 0.1 to 10";
  if (outside("minimumEpisodes", 1, 100_000)) problems.minimumEpisodes = "Enter a whole number";
  if (outside("maximumEpisodes", 1, 100_000)) problems.maximumEpisodes = "Enter a whole number";
  else if (!problems.minimumEpisodes && values.minimumEpisodes !== undefined && values.maximumEpisodes !== undefined && values.minimumEpisodes > values.maximumEpisodes) problems.maximumEpisodes = "Must be at least the starting count";
  return problems;
}

/** Setting a term switches to best match and remembers the sort it replaced; clearing it puts that sort back. */
function withTerm<T extends Pick<BrowseViewState, "filters" | "sortBefore">>(state: T, search: string | undefined): T {
  const { search: previous, ...rest } = state.filters;
  if (search) return { ...state, filters: { ...rest, search, sort: previous ? rest.sort : "match" }, sortBefore: previous ? state.sortBefore : rest.sort };
  return { ...state, filters: { ...rest, sort: rest.sort === "match" ? state.sortBefore ?? "popularity" : rest.sort }, sortBefore: undefined };
}
const termOf = (text: string) => { const term = text.trim().replace(/\s+/g, " "); return term.length >= SEARCH_MINIMUM ? term : undefined; };

interface Token { key: string; label: string; remove: string; without: (filters: BrowseFilters) => BrowseFilters }
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
/** Every filter that narrows the results, each with the way to take it off. Genres come first because the empty state offers them first. */
function tokensOf(filters: BrowseFilters): { genres: Token[]; rest: Token[] } {
  const drop = (...names: (keyof BrowseFilters)[]) => (current: BrowseFilters) => { const next = { ...current }; for (const name of names) delete next[name]; return next; };
  const episodes = filters.minimumEpisodes !== undefined && filters.maximumEpisodes !== undefined ? `${filters.minimumEpisodes} to ${filters.maximumEpisodes} episodes`
    : filters.minimumEpisodes !== undefined ? `${filters.minimumEpisodes}+ episodes` : filters.maximumEpisodes !== undefined ? `Up to ${filters.maximumEpisodes} episodes` : undefined;
  const rest: (Token | undefined)[] = [
    filters.format && { key: "format", label: FORMAT_NAMES[filters.format as keyof typeof FORMAT_NAMES] ?? filters.format, without: drop("format") },
    filters.status && { key: "status", label: STATUS_NAMES[filters.status], without: drop("status") },
    filters.season && { key: "season", label: SEASON_NAMES[filters.season], without: drop("season") },
    filters.year !== undefined && { key: "year", label: String(filters.year), without: drop("year") },
    filters.minimumScore !== undefined && { key: "score", label: `Score ${filters.minimumScore / 10}+`, without: drop("minimumScore") },
    episodes !== undefined && { key: "episodes", label: episodes, without: drop("minimumEpisodes", "maximumEpisodes") },
    ...(filters.tags ?? []).map((tag) => ({ key: `tag-${tag}`, label: tag, without: (current: BrowseFilters) => { const tags = current.tags?.filter((value) => !same(value, tag)); const { tags: _, ...rest } = current; return tags?.length ? { ...rest, tags } : rest; } })),
    filters.studio && { key: "studio", label: filters.studio.name, without: drop("studio") },
    filters.search && { key: "search", label: `“${filters.search}”`, without: (current: BrowseFilters) => withTerm({ filters: current }, undefined).filters }
  ].map((token) => token ? { ...token, remove: `Remove ${token.label}` } : undefined);
  return {
    genres: [
      ...filters.includeGenres.map((genre) => ({ key: `with-${genre}`, label: genre, remove: `Remove ${genre}`, without: (current: BrowseFilters) => ({ ...current, includeGenres: current.includeGenres.filter((value) => !same(value, genre)) }) })),
      ...filters.excludeGenres.map((genre) => ({ key: `without-${genre}`, label: `not ${genre}`, remove: `Allow ${genre}`, without: (current: BrowseFilters) => ({ ...current, excludeGenres: current.excludeGenres.filter((value) => !same(value, genre)) }) }))
    ],
    rest: rest.filter((token): token is Token => Boolean(token))
  };
}

const factsOf = (anime: BrowseAnime) => [anime.type ? FORMAT_NAMES[anime.type as keyof typeof FORMAT_NAMES] ?? anime.type : undefined, anime.year,
  anime.status === "ongoing" ? "airing" : anime.episodes && anime.episodes > 1 ? `${anime.episodes} eps` : undefined].filter(Boolean).join(" · ");

export default function BrowseScreen({ state, setState, enabled, openingId, onOpen, onSearchSources }: {
  state: BrowseViewState; setState: Dispatch<SetStateAction<BrowseViewState>>; enabled: boolean;
  /** The title whose streaming sources are being checked; its card reports the check. */
  openingId?: number; onOpen: (anime: BrowseAnime) => void;
  /** Hands the words to the source search on Home. */
  onSearchSources: (term: string) => void;
}) {
  const [genres, setGenres] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [genreError, setGenreError] = useState<string>(), [genreAttempt, setGenreAttempt] = useState(0);
  const [texts, setTexts] = useState(() => textsOf(state.filters)), [term, setTerm] = useState(state.filters.search ?? "");
  const [reading, setReading] = useState<BrowseProgress>();
  const [tags, setTags] = useState<string[]>(), [tagTerm, setTagTerm] = useState("");
  const request = useRef<string | undefined>(undefined), sequence = useRef(0);
  // The last titles and studio suggestions on screen stay while a changed query loads its first page.
  const held = useRef<BrowseAnime[]>([]), heldStudios = useRef<BrowseStudio[]>([]), listedStudios = useRef<BrowseStudio[]>([]);
  const root = useRef<HTMLElement>(null), field = useRef<HTMLInputElement>(null);
  const { filters, pages } = state, problems = problemsOf(texts);
  const load = (page: number, refresh = false) => {
    if (!enabled) return;
    const token = ++sequence.current;
    if (request.current) window.aniDesktop.cancelCatalog(request.current);
    const id = catalogRequestId("browse"); request.current = id; setLoading(true); setError(undefined); setReading(undefined);
    void window.aniDesktop.browse({ filters, page }, { id, priority: "visible", refresh }, (progress) => { if (token === sequence.current) setReading((previous) => ({ ...progress, entries: progress.entries ?? previous?.entries })); }).then((result) => {
      if (token !== sequence.current) return;
      setState((previous) => previous.filters === filters ? { ...previous, pages: Object.assign([...previous.pages], { [page - 1]: result }) } : previous);
    }, (reason) => { if (token === sequence.current) setError(messageFrom(reason)); })
      .finally(() => { if (token === sequence.current) { setLoading(false); setReading(undefined); request.current = undefined; } });
  };
  useEffect(() => {
    if (!enabled) return;
    const id = catalogRequestId("browse-genres"); let current = true; setGenreError(undefined);
    void window.aniDesktop.browseGenres({ id, priority: "visible", refresh: genreAttempt > 0 }).then((values) => { if (current) setGenres(values); }, (reason) => { if (current) setGenreError(messageFrom(reason)); });
    return () => { current = false; window.aniDesktop.cancelCatalog(id); };
  }, [enabled, genreAttempt]);
  // The tag list is only needed once the filters are open.
  useEffect(() => {
    if (!enabled || !state.panelOpen || tags) return;
    const id = catalogRequestId("browse-tags"); let current = true;
    void window.aniDesktop.browseTags({ id, priority: "visible" }).then((values) => { if (current) setTags(values); }, () => undefined);
    return () => { current = false; window.aniDesktop.cancelCatalog(id); };
  }, [enabled, state.panelOpen]);
  useEffect(() => {
    if (enabled && !pages.length) load(1);
  }, [enabled, filters]);
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".page-browse");
    if (page) page.scrollTop = state.scrollTop;
    return () => {
      sequence.current += 1;
      if (request.current) window.aniDesktop.cancelCatalog(request.current);
      if (page) setState((previous) => ({ ...previous, scrollTop: page.scrollTop }));
    };
  }, []);
  // Every change applies at once and starts again from the first page.
  const change = (next: (state: BrowseViewState) => BrowseViewState) => setState((previous) => ({ ...next(previous), pages: [] }));
  const apply = (next: (filters: BrowseFilters) => BrowseFilters) => change((previous) => ({ ...previous, filters: next(previous.filters) }));
  const set = <K extends keyof BrowseFilters>(key: K, value: BrowseFilters[K] | undefined) => apply((current) => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; });
  // Typed fields wait for a pause, and an invalid entry is held back until it is fixed.
  useEffect(() => {
    if (Object.keys(problemsOf(texts)).length) return;
    const values = valuesOf(texts), names = Object.keys(values) as Field[];
    if (names.every((name) => values[name] === filters[name])) return;
    const timer = window.setTimeout(() => apply((current) => { const next = { ...current }; for (const name of names) { if (values[name] === undefined) delete next[name]; else next[name] = values[name]; } return next; }), TYPING_PAUSE);
    return () => window.clearTimeout(timer);
  }, [texts]);
  const search = (text = term) => { if (termOf(text) !== filters.search) change((previous) => withTerm(previous, termOf(text))); };
  // The title field waits longer: every distinct term is a fresh request against AniList's pace.
  useEffect(() => {
    if (termOf(term) === filters.search) return;
    const timer = window.setTimeout(() => search(), termOf(term) ? SEARCH_PAUSE : 0);
    return () => window.clearTimeout(timer);
  }, [term]);
  const takeStudio = (studio: BrowseStudio) => { setTerm(""); change((previous) => { const next = withTerm(previous, undefined); return { ...next, filters: { ...next.filters, studio } }; }); field.current?.focus(); };
  const dropStudio = () => set("studio", undefined);
  const remove = (token: Token) => { const next = token.without(filters); setTexts(textsOf(next)); if (token.key === "search") setTerm(""); change((previous) => ({ ...previous, filters: next, sortBefore: token.key === "search" ? undefined : previous.sortBefore })); };
  const clear = () => { setTexts(textsOf(DEFAULT_BROWSE_FILTERS)); setTerm(""); change((previous) => ({ ...previous, filters: { ...DEFAULT_BROWSE_FILTERS, sort: previous.filters.sort === "match" ? previous.sortBefore ?? "popularity" : previous.filters.sort }, sortBefore: undefined })); };
  // One click includes a genre, the next excludes it, the third lets it go.
  const cycleGenre = (genre: string) => apply((current) => {
    const included = current.includeGenres.some((value) => same(value, genre)), excluded = current.excludeGenres.some((value) => same(value, genre));
    const includeGenres = current.includeGenres.filter((value) => !same(value, genre)), excludeGenres = current.excludeGenres.filter((value) => !same(value, genre));
    return { ...current, includeGenres: included || excluded ? includeGenres : [...includeGenres, genre], excludeGenres: included ? [...excludeGenres, genre] : excludeGenres };
  });
  const genreState = (genre: string) => filters.includeGenres.some((value) => same(value, genre)) ? "inc" : filters.excludeGenres.some((value) => same(value, genre)) ? "exc" : "";

  const seen = new Set<number>(), entries = pages.flatMap((page) => page.entries).filter((anime) => !seen.has(anime.anilistId) && seen.add(anime.anilistId));
  if (entries.length) held.current = entries;
  if (pages[0]) heldStudios.current = pages[0].studios ?? [];
  const last = pages.at(-1), stale = pages.find((page) => page.stale), tokens = tokensOf(filters);
  const waiting = loading && !pages.length, shown = reading?.entries ?? (waiting ? held.current : entries);
  const studios = !filters.studio && termOf(term) ? (pages[0] ? pages[0].studios ?? [] : heldStudios.current) : [];
  // The suggestion row keeps its last names while it closes, and a page's cards enter in sequence from its own first card.
  if (studios.length) listedStudios.current = studios;
  const listed = studios.length ? studios : listedStudios.current, earlier = entries.length - (last?.entries.length ?? 0);
  // The search field already shows the term and the studio.
  const lineTokens = tokens.rest.filter((token) => token.key !== "search" && token.key !== "studio");
  const narrowed = tokens.genres.length + tokens.rest.length - (filters.studio ? 1 : 0) > 0;
  const tagMatches = (tags ?? []).filter((tag) => tag.toLocaleLowerCase().includes(tagTerm.trim().toLocaleLowerCase())).sort((a, b) => Number(b.toLocaleLowerCase().startsWith(tagTerm.trim().toLocaleLowerCase())) - Number(a.toLocaleLowerCase().startsWith(tagTerm.trim().toLocaleLowerCase()))).slice(0, 8);
  const role = (studio: BrowseStudio) => studio.animation ? "animation studio" : "producer";

  // Arrow keys carry the focus from the field to the studio suggestions to the cards, and Escape walks back up.
  const focusFirst = (selector: string) => { const target = root.current?.querySelector<HTMLElement>(selector); target?.focus(); return Boolean(target); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement, key = event.key;
    const done = () => { event.preventDefault(); event.stopPropagation(); };
    if (target === field.current) {
      if (key === "ArrowDown") { if (focusFirst(SUGGESTION) || focusFirst(".browse-grid .hit")) done(); }
      else if (key === "Enter") { done(); if (termOf(term) === filters.search && !entries.length && !loading && studios.length) takeStudio(studios[0]); else search(); }
      else if (key === "Escape") { done(); if (term) setTerm(""); else field.current?.blur(); }
      else if (key === "Backspace" && !term && filters.studio) { done(); dropStudio(); }
      return;
    }
    if (target.closest(".browse-suggest")) {
      const row = [...root.current!.querySelectorAll<HTMLElement>(".browse-suggest button")], at = row.indexOf(target.closest("button")!);
      if (key === "ArrowRight" || key === "ArrowLeft") { done(); row[(at + (key === "ArrowRight" ? 1 : row.length - 1)) % row.length]?.focus(); }
      else if (key === "ArrowDown") { if (focusFirst(".browse-grid .hit")) done(); }
      else if (key === "ArrowUp" || key === "Escape") { done(); field.current?.focus(); }
      return;
    }
    if (target.matches(".browse-grid .hit")) {
      const grid = target.closest<HTMLElement>(".browse-grid")!, cards = [...grid.querySelectorAll<HTMLElement>(".hit")], at = cards.indexOf(target);
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? columns : key === "ArrowUp" ? -columns : 0;
      if (step) {
        if (at + step >= 0) { done(); cards[Math.min(cards.length - 1, at + step)]?.focus(); }
        else if (key === "ArrowUp") { done(); if (!focusFirst(SUGGESTION)) field.current?.focus(); }
      } else if (key === "Escape" && openingId === undefined) { done(); field.current?.focus(); }
    }
  };
  const input = (name: Field, label: string, wide = false, spoken?: string) => <label className="browse-field"><span className="chips-lab">{label}</span>
    <input type="text" inputMode={name === "minimumScore" ? "decimal" : "numeric"} maxLength={name === "year" || name === "minimumScore" ? 4 : 6} className={wide ? "wide" : ""} value={texts[name]} placeholder="Any" aria-label={spoken}
      onChange={(event) => setTexts((previous) => ({ ...previous, [name]: event.target.value }))} {...(problems[name] ? { "aria-invalid": true, "aria-describedby": `browse-${name}-problem` } as const : {})} /></label>;
  const sorts = SORTS.filter(([value]) => value !== "match" || filters.search);
  const stepBack = reading ? "is-waiting" : "";

  return <section className="section browse" aria-labelledby="browse-heading" ref={root} onKeyDown={onKeyDown}>
    <div className="section-head"><h2 id="browse-heading">Browse</h2><span className="browse-sub">AniList catalog</span>
      {enabled && <div className={`browse-sort ${stepBack}`} role="radiogroup" aria-label="Sort">{sorts.map(([value, name]) => <button type="button" key={value} role="radio" aria-checked={filters.sort === value} className={filters.sort === value ? "on" : ""} {...pressProps(() => { if (filters.sort !== value) set("sort", value); })}>{name}</button>)}</div>}</div>
    {!enabled ? <div className="empty"><b>Anime information is disabled</b>Enable it in Settings to browse the AniList catalog.</div> : <>
      <label className="browse-search"><Icon name="search" />
        {filters.studio && <span className="studio-token"><em>Studio</em>{filters.studio.name}<button type="button" aria-label={`Remove studio ${filters.studio.name}`} onClick={dropStudio}>×</button></span>}
        <input ref={field} type="text" value={term} maxLength={120} spellCheck={false} onChange={(event) => setTerm(event.target.value)}
          placeholder={filters.studio ? `Title within ${filters.studio.name}` : "Search the AniList catalog by title or studio"} aria-label={filters.studio ? `Title within ${filters.studio.name}` : "Search the AniList catalog by title or studio"} />
        <span className="search-throbber" aria-hidden="true">{loading && !reading && <><span>·</span><span>·</span><span>·</span></>}</span>
        {(term || filters.studio) && <button type="button" className="clear" aria-label="Clear search" onClick={() => { setTerm(""); if (filters.studio && !term) dropStudio(); field.current?.focus(); }}><Icon name="x" /></button>}</label>
      <Reveal open={studios.length > 0}><div className="browse-suggest" role="group" aria-label="Matching studios"><span className="suggest-lab">{listed.length > 1 ? "Studios" : "Studio"}</span>
        {listed.map((studio) => <button type="button" key={studio.id} className={studio.animation ? "" : "quiet"} onClick={() => takeStudio(studio)}>{studio.name}<small>{role(studio)}</small><Icon name="chevron" /></button>)}</div></Reveal>
      <div className={`browse-steps ${stepBack}`}>
        {genres.length > 0 && <div className="browse-genres" role="group" aria-label="Genres">{genres.map((genre) => { const mark = genreState(genre); return <button type="button" key={genre} className={`genre ${mark}`}
          aria-pressed={mark === "inc" ? true : mark === "exc" ? "mixed" : false} title={mark === "inc" ? "Included · click to exclude" : mark === "exc" ? "Excluded · click to clear" : "Click to include"} onClick={() => cycleGenre(genre)}>{genre}{mark === "exc" && <span className="sr-only"> excluded</span>}</button>; })}</div>}
        {genreError && <div className="notice">Genres could not load. {genreError} <button type="button" className="link" onClick={() => setGenreAttempt((value) => value + 1)}>Retry</button></div>}
        {!reading && <div className="browse-line"><button type="button" className={`browse-toggle ${state.panelOpen ? "open" : ""}`} aria-expanded={state.panelOpen} aria-controls="browse-panel" onClick={() => setState((previous) => ({ ...previous, panelOpen: !previous.panelOpen }))}>Filters<Icon name="chevron" /></button>
          {lineTokens.map((token) => <span className="token" key={token.key}>{token.label}<button type="button" aria-label={token.remove} onClick={() => remove(token)}>×</button></span>)}
          {(lineTokens.length > 0 || tokens.genres.length > 0) && <button type="button" className="browse-clear" onClick={clear}>Clear all</button>}</div>}
        <Reveal open={state.panelOpen && !reading} id="browse-panel"><div className="browse-panel">
          <Chips label="Format" value={filters.format ?? "Any"} options={FORMATS} names={FORMAT_NAMES} onChange={(value) => set("format", value === "Any" ? undefined : value as MediaType)} />
          <Chips label="Status" value={filters.status ?? "Any"} options={STATUSES} names={STATUS_NAMES} onChange={(value) => set("status", value === "Any" ? undefined : value)} />
          <Chips label="Season" value={filters.season ?? "Any"} options={SEASONS} names={SEASON_NAMES} onChange={(value) => set("season", value === "Any" ? undefined : value)} />
          {input("year", "Year", true)}{input("minimumScore", "Score from")}
          <span className="browse-range">{input("minimumEpisodes", "Episodes", false, "Episodes from")}{input("maximumEpisodes", "to", false, "Episodes to")}</span>
          <TypeAhead label="Tags" tokens={filters.tags ?? []} term={tagTerm} onTerm={setTagTerm} pending={!tags}
            options={tagMatches.map((tag) => ({ key: tag, label: tag, ...(filters.tags?.some((value) => same(value, tag)) ? { note: "already added", disabled: true } : {}) }))}
            onPick={(tag) => { setTagTerm(""); set("tags", [...(filters.tags ?? []), tag]); }} onRemove={(tag) => { const rest = (filters.tags ?? []).filter((value) => !same(value, tag)); set("tags", rest.length ? rest : undefined); }} />
          {(Object.keys(problems) as Field[]).map((name) => <small className="field-problem" id={`browse-${name}-problem`} key={name}>{problems[name]}</small>)}
        </div></Reveal>
      </div>
      {reading && <div className="browse-reading" role="status"><span className="track"><i /></span>Fetching {reading.studio}'s catalog · {reading.read} so far · filters ready when done</div>}
      {stale && <div className="notice">Showing cached results. {stale.error} <button type="button" className="link" onClick={() => load(stale.query.page, true)}>Retry</button></div>}
      {error && <div className="msg err" role="alert">{error} <button type="button" className="link" onClick={() => load(pages.length + 1, true)}>Retry</button></div>}
      {shown.length > 0 && <div className={`cards browse-grid ${waiting && !reading ? "is-loading" : ""} ${openingId !== undefined ? "is-opening" : ""}`} aria-busy={loading}>{shown.map((anime, index) => { const opening = anime.anilistId === openingId; return <div className={`card ${opening ? "is-resolving" : ""}`} key={anime.anilistId} style={stagger(index >= earlier ? index - earlier : index, 10)}>
        <button type="button" className="hit" aria-busy={opening} title={opening ? "Checking streaming sources · click to cancel" : undefined} onClick={() => onOpen(anime)}><Art src={anime.cover} className="poster" />
          {anime.score !== undefined && anime.score > 0 && <span className="badges top"><span className="badge">{(anime.score / 10).toFixed(1)}</span></span>}
          {opening && <span className="sr-only" role="status">Checking streaming sources</span>}</button>
        <span className="t">{anime.title}</span><span className="s">{factsOf(anime)}</span><GenreChips genres={anime.genres} /></div>; })}</div>}
      {/* Ghosts hold a page's place while it loads. Before the first page they are there from the first frame and fill
          the screen, so the footer starts where the results will leave it instead of being pushed down when they land. */}
      {(loading || (enabled && !last && !error)) && !reading && (pages.length > 0 || !shown.length) && <div className="browse-ghosts" aria-hidden="true">{Array.from({ length: shown.length ? 8 : 24 }, (_, index) => <span className="ghost" key={index} />)}</div>}
      {!loading && !error && last && !entries.length && (last.hasNextPage
        ? <div className="browse-none"><b>No matches so far</b>The first {pages.length === 1 ? "page" : `${pages.length} pages`} had nothing to show. More of the catalog may match.</div>
        : studios.length > 0 && filters.search ? <div className="browse-none"><b>No titles contain “{filters.search}”</b>It matches {studios.length > 1 ? "studios" : "a studio"}.
          <div className="fixes"><button type="button" className="btn small primary" onClick={() => takeStudio(studios[0])}>Show {studios[0].name}'s anime</button><button type="button" className="link" onClick={() => onSearchSources(filters.search!)}>Search sources for “{filters.search}”</button></div></div>
        : filters.studio && !narrowed ? <div className="browse-none"><b>AniList lists no anime for {filters.studio.name}</b>{filters.studio.animation ? "Its list is empty." : "It is recorded as a producer without works of its own."}
          <div className="fixes"><button type="button" className="btn small" onClick={dropStudio}>Remove the studio</button></div></div>
        : <div className="browse-none"><b>Nothing matches all of these</b>{filters.includeGenres.length > 1 ? "Included genres must all be present on a title. Try dropping one." : filters.search ? "Try taking a filter off, or check the spelling." : "Try taking a filter off."}
          <div className="fixes">{[...tokens.genres, ...tokens.rest].map((token) => <button type="button" className="btn small" key={token.key} onClick={() => remove(token)}>{token.remove}</button>)}
            {tokens.genres.length + tokens.rest.length > 1 && <button type="button" className="btn small" onClick={clear}>Clear all</button>}
            {filters.search && <button type="button" className="link" onClick={() => onSearchSources(filters.search!)}>Search sources for “{filters.search}”</button>}</div></div>)}
      {last && !waiting && <div className="browse-more">{loading ? <span role="status">{entries.length} shown · loading more<span className="dots"> ···</span></span>
        : <>{entries.length > 0 && <span>{last.hasNextPage ? `${entries.length} shown` : `All ${entries.length} shown`}</span>}{last.hasNextPage && !error && <button type="button" className="btn small" onClick={() => load(pages.length + 1)}>Show more</button>}</>}</div>}
    </>}
  </section>;
}
