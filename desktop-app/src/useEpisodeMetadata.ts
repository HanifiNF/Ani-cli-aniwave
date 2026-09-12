import { useEffect, useRef, useState, type RefObject } from "react";
import type { EpisodeAvailability, TranslationMode } from "../shared/contracts";
import { catalogRequestId } from "./catalog-request";

export interface EpisodeMetadata {
  availability?: EpisodeAvailability;
  quality?: string;
  phase: "audio" | "quality" | "ready" | "error";
  error?: string;
  at: number;
}
interface Task { key: string; requests: Set<string>; cancelled: boolean; }
const bestQuality = (streams: { quality: string }[]) => streams.map((stream) => stream.quality).sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0))[0];

/** Keep work attached to the current viewport. Electron shares requests and limits traffic per host. */
export function useEpisodeMetadata(list: RefObject<HTMLDivElement | null>, enabled: boolean, ids: string[], selected: string | undefined, mode: TranslationMode, scope: string) {
  const [visible, setVisible] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [values, setValues] = useState<Record<string, EpisodeMetadata>>({});
  const cache = useRef(new Map<string, EpisodeMetadata>());
  const tasks = useRef(new Map<string, Task>());
  const forced = useRef(new Set<string>());
  const keyFor = (id: string) => JSON.stringify([scope, id, mode]);
  const idsKey = ids.join("|");
  useEffect(() => {
    setVisible((previous) => previous.filter((id) => enabled && ids.includes(id)));
    if (!enabled || !list.current || typeof IntersectionObserver === "undefined") return;
    const inView = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.episode;
        if (id) { if (entry.isIntersecting) inView.add(id); else inView.delete(id); }
      }
      setVisible([...inView]);
    }, { root: list.current.closest(".page"), rootMargin: "120px 0px" });
    for (const row of list.current.querySelectorAll<HTMLElement>("[data-episode]")) observer.observe(row);
    return () => observer.disconnect();
  }, [enabled, idsKey, list]);

  const stop = (task: Task) => {
    task.cancelled = true;
    for (const id of task.requests) window.aniDesktop.cancelCatalog(id);
    tasks.current.delete(task.key);
    if (!cache.current.has(task.key)) setValues((current) => { const next = { ...current }; delete next[task.key]; return next; });
  };
  useEffect(() => {
    const valid = new Set(ids);
    const targets = enabled && typeof IntersectionObserver !== "undefined" ? [...new Set([...(selected ? [selected] : []), ...visible])].filter((id) => valid.has(id)) : [];
    const wanted = new Set(targets.map(keyFor));
    for (const task of tasks.current.values()) if (!wanted.has(task.key)) stop(task);
    for (const id of targets) {
      const key = keyFor(id);
      if (tasks.current.has(key)) continue;
      const cached = cache.current.get(key);
      if (cached && Date.now() - cached.at < (cached.phase === "error" ? 10_000 : 60_000)) continue;
      const task: Task = { key, requests: new Set(), cancelled: false };
      tasks.current.set(key, task);
      const refresh = forced.current.delete(key);
      const publish = (value: EpisodeMetadata) => {
        if (task.cancelled) return;
        setValues((current) => ({ ...current, [key]: value }));
        if (value.phase === "ready" || value.phase === "error") {
          cache.current.delete(key); cache.current.set(key, value);
          if (cache.current.size > 1000) {
            const oldest = cache.current.keys().next().value!;
            cache.current.delete(oldest);
            setValues((current) => { const next = { ...current }; delete next[oldest]; return next; });
          }
        }
      };
      const request = async <T,>(purpose: string, operation: (request: import("../shared/contracts").CatalogRequest) => Promise<T>, priority: "selected" | "visible" | "nearby") => {
        const requestId = catalogRequestId(purpose); task.requests.add(requestId);
        try { return await operation({ id: requestId, priority, refresh }); }
        finally { task.requests.delete(requestId); }
      };
      publish({ phase: "audio", at: Date.now() });
      void (async () => {
        let availability: EpisodeAvailability | undefined;
        try {
          availability = await request("audio", (options) => window.aniDesktop.availability(id, options), id === selected ? "selected" : "visible");
          if (task.cancelled) return;
          if (!availability[mode]) { publish({ phase: "ready", availability, at: Date.now() }); return; }
          publish({ phase: "quality", availability, at: Date.now() });
          const streams = await request("quality", (options) => window.aniDesktop.streams(id, mode, options), id === selected ? "selected" : "nearby");
          publish({ phase: "ready", availability, quality: bestQuality(streams), at: Date.now() });
        } catch (error) {
          publish({ phase: "error", availability, error: error instanceof Error ? error.message : String(error), at: Date.now() });
        } finally { if (tasks.current.get(key) === task) tasks.current.delete(key); }
      })();
    }
  }, [enabled, idsKey, selected, visible, mode, scope, revision]);
  useEffect(() => () => { for (const task of tasks.current.values()) stop(task); }, []);

  return {
    get: (id: string) => values[keyFor(id)],
    retry: (id: string) => {
      const key = keyFor(id), task = tasks.current.get(key);
      if (task) stop(task);
      cache.current.delete(key); forced.current.add(key); setRevision((value) => value + 1);
    },
    record: (id: string, audio: TranslationMode, streams: { quality: string }[]) => {
      const key = JSON.stringify([scope, id, audio]);
      const value: EpisodeMetadata = { ...cache.current.get(key), phase: "ready", quality: bestQuality(streams), at: Date.now() };
      cache.current.set(key, value); setValues((current) => ({ ...current, [key]: value }));
    }
  };
}
