import { catalogRequestId } from "./catalog-request";
import { useLayoutEffect, useRef, useState } from "react";
import type { AnimeResult, ProviderPreference } from "../shared/contracts";

const DEBOUNCE_MS = 300;
// Every search scrapes a provider page, and a single letter matches nearly everything, so shorter queries wait for Enter.
const MIN_QUERY_LENGTH = 2;
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 20;
interface SearchState {
  results: AnimeResult[];
  lastQuery: string;
  key: string;
  phase: "idle" | "waiting" | "loading" | "success" | "error";
  error?: unknown;
  providerErrors?: string[];
}
const initialState: SearchState = { results: [], lastQuery: "", key: "", phase: "idle" };

export function useAnimeSearch(query: string, provider: ProviderPreference, sourceUrls: readonly string[], enabled: boolean) {
  const cleaned = query.trim();
  const key = JSON.stringify([cleaned, provider, ...sourceUrls]);
  const [state, setState] = useState<SearchState>(initialState);
  const latest = useRef(state);
  latest.current = state;
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);
  const forceNext = useRef(false);
  const flush = useRef(() => {});
  const cache = useRef(new Map<string, { results: AnimeResult[]; expires: number }>());
  const inFlight = useRef(new Map<string, Promise<AnimeResult[]>>());

  // Invalidate old responses at commit time, including while composing or leaving search.
  useLayoutEffect(() => {
    const token = ++generation.current;
    flush.current = () => {};
    if (!enabled || !cleaned) return;
    let requestId: string | undefined;
    const invalidate = () => { generation.current += 1; if (requestId) { window.aniDesktop.cancelCatalog(requestId); inFlight.current.delete(key); } };
    // Re-enabling search (for example returning from a series) keeps results already held for this exact query.
    if (!forceNext.current && latest.current.key === key && latest.current.phase === "success") return invalidate;

    const accept = (results: AnimeResult[]) => {
      if (generation.current === token) setState((previous) => ({ results, lastQuery: cleaned, key, phase: "success", providerErrors: previous.key === key ? previous.providerErrors : undefined }));
    };
    const cached = cache.current.get(key);
    if (!forceNext.current && cached && cached.expires > Date.now()) {
      cache.current.delete(key);
      cache.current.set(key, cached);
      accept(cached.results);
      return invalidate;
    }
    cache.current.delete(key);
    const scheduled = cleaned.length >= MIN_QUERY_LENGTH;
    if (scheduled) setState((previous) => ({ ...previous, key, phase: "waiting", error: undefined }));

    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const execute = (manual = false) => {
      if (started) return;
      started = true;
      const checkNow = forceNext.current || (manual && latest.current.key === key && latest.current.phase === "error");
      const refresh = forceNext.current || latest.current.phase === "error"; forceNext.current = false;
      clearTimeout(timer);
      setState((previous) => ({ ...previous, key, phase: "loading", error: undefined }));
      let request = inFlight.current.get(key);
      if (!request) {
        requestId = catalogRequestId("search");
        let providerFailed = false;
        request = Promise.resolve().then(() => window.aniDesktop.search(cleaned, provider, { id: requestId!, priority: "selected", refresh, checkNow }, (progress) => {
          providerFailed = Object.keys(progress.errors).length > 0;
          if (generation.current === token) setState({ results: progress.value, lastQuery: cleaned, key, phase: "loading", providerErrors: Object.entries(progress.errors).map(([name, error]) => `${name}: ${error}`) });
        }));
        inFlight.current.set(key, request);
        void request.then((results) => {
          if (!providerFailed) cache.current.set(key, { results, expires: Date.now() + CACHE_TTL_MS });
          if (cache.current.size > CACHE_LIMIT) cache.current.delete(cache.current.keys().next().value!);
        }, () => {}).finally(() => { if (inFlight.current.get(key) === request) inFlight.current.delete(key); });
      }
      void request.then(accept, (error: unknown) => {
        if (generation.current === token) {
          // Allow Enter to retry a failed query without editing it.
          started = false;
          setState((previous) => ({ ...previous, key, phase: "error", error }));
        }
      });
    };
    if (scheduled) timer = setTimeout(() => execute(), DEBOUNCE_MS);
    flush.current = () => execute(true);
    return () => {
      clearTimeout(timer);
      invalidate();
      flush.current = () => {};
    };
  }, [cleaned, provider, key, enabled, revision]);

  const active = enabled && Boolean(cleaned);
  const current = state.key === key;
  const short = cleaned.length < MIN_QUERY_LENGTH;
  return {
    // Results outlive the query so they survive visiting other screens; clear() drops them explicitly.
    results: state.results,
    lastQuery: state.lastQuery,
    pending: active && (current ? state.phase === "waiting" || state.phase === "loading" : !short),
    loading: active && current && state.phase === "loading",
    ready: active && current && (state.phase === "success" || (state.phase === "loading" && state.lastQuery === cleaned && state.results.length > 0)),
    providerErrors: active && current ? state.providerErrors ?? [] : [],
    error: active && current && state.phase === "error" ? state.error : undefined,
    searchNow: () => flush.current(),
    retrySources: () => { forceNext.current = true; cache.current.delete(key); setRevision((value) => value + 1); },
    clear: () => setState(initialState)
  };
}
