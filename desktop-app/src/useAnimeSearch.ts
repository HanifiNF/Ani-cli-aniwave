import { useLayoutEffect, useRef, useState } from "react";
import type { AnimeResult, ProviderPreference } from "../shared/contracts";

const DEBOUNCE_MS = 300;
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 20;
interface SearchState {
  results: AnimeResult[];
  lastQuery: string;
  key: string;
  phase: "idle" | "waiting" | "loading" | "success" | "error";
  error?: unknown;
}
const initialState: SearchState = { results: [], lastQuery: "", key: "", phase: "idle" };

export function useAnimeSearch(query: string, provider: ProviderPreference, sourceUrls: readonly string[], enabled: boolean) {
  const cleaned = query.trim();
  const key = JSON.stringify([cleaned, provider, ...sourceUrls]);
  const [state, setState] = useState<SearchState>(initialState);
  const generation = useRef(0);
  const flush = useRef(() => {});
  const cache = useRef(new Map<string, { results: AnimeResult[]; expires: number }>());
  const inFlight = useRef(new Map<string, Promise<AnimeResult[]>>());

  // Invalidate old responses at commit time, including while composing or leaving search.
  useLayoutEffect(() => {
    const token = ++generation.current;
    flush.current = () => {};
    if (!cleaned) setState(initialState);
    if (!enabled || !cleaned) return;

    const accept = (results: AnimeResult[]) => {
      if (generation.current === token) setState({ results, lastQuery: cleaned, key, phase: "success" });
    };
    const cached = cache.current.get(key);
    if (cached && cached.expires > Date.now()) {
      cache.current.delete(key);
      cache.current.set(key, cached);
      accept(cached.results);
      return () => { generation.current += 1; };
    }
    cache.current.delete(key);
    setState((previous) => ({ ...previous, key, phase: "waiting", error: undefined }));

    let started = false;
    const execute = () => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      setState((previous) => ({ ...previous, key, phase: "loading", error: undefined }));
      let request = inFlight.current.get(key);
      if (!request) {
        request = Promise.resolve().then(() => window.aniDesktop.search(cleaned, provider));
        inFlight.current.set(key, request);
        void request.then((results) => {
          cache.current.set(key, { results, expires: Date.now() + CACHE_TTL_MS });
          if (cache.current.size > CACHE_LIMIT) cache.current.delete(cache.current.keys().next().value!);
        }, () => {}).finally(() => inFlight.current.delete(key));
      }
      void request.then(accept, (error: unknown) => {
        if (generation.current === token) {
          // Allow Enter to retry a failed query without editing it.
          started = false;
          setState((previous) => ({ ...previous, key, phase: "error", error }));
        }
      });
    };
    const timer = setTimeout(execute, DEBOUNCE_MS);
    flush.current = execute;
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      flush.current = () => {};
    };
  }, [cleaned, provider, key, enabled]);

  const active = enabled && Boolean(cleaned);
  const current = state.key === key;
  return {
    results: cleaned ? state.results : [],
    lastQuery: cleaned ? state.lastQuery : "",
    pending: active && (!current || state.phase === "waiting" || state.phase === "loading"),
    loading: active && current && state.phase === "loading",
    ready: active && current && state.phase === "success",
    error: active && current && state.phase === "error" ? state.error : undefined,
    searchNow: () => flush.current()
  };
}
