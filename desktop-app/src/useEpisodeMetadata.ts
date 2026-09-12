import { useEffect, useRef, useState, type RefObject } from "react";
import type { EpisodeAvailability, TranslationMode } from "../shared/contracts";
import { catalogRequestId } from "./catalog-request";
import { availabilityFresh, bestQuality, qualityFresh } from "../shared/episode-metadata";

export interface EpisodeMetadata {
  availability?: EpisodeAvailability;
  quality?: string;
  qualityCheckedAt?: number;
  phase: "audio" | "quality" | "ready" | "error";
  error?: string;
  at: number;
}
interface Task { key: string; requests: Set<string>; cancelled: boolean; }
const freshQuality = (value: EpisodeMetadata | undefined) => qualityFresh(value?.qualityCheckedAt === undefined ? undefined : { quality: value.quality, checkedAt: value.qualityCheckedAt });

/** Keep work attached to the current viewport. Electron shares requests and limits traffic per host. */
export function useEpisodeMetadata(list: RefObject<HTMLDivElement | null>, enabled: boolean, ids: string[], selected: string | undefined, mode: TranslationMode, scope: string) {
  const [visible, setVisible] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [values, setValues] = useState<Record<string, EpisodeMetadata>>({});
  const cache = useRef(new Map<string, EpisodeMetadata>());
  const tasks = useRef(new Map<string, Task>());
  const forced = useRef(new Set<string>());
  const clearing = useRef(false);
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
    setValues((current) => { const next = { ...current }; const cached = cache.current.get(task.key); if (cached) next[task.key] = cached; else delete next[task.key]; return next; });
  };
  useEffect(() => {
    const valid = new Set(ids);
    const targets = enabled && typeof IntersectionObserver !== "undefined" ? [...new Set([...(selected ? [selected] : []), ...visible])].filter((id) => valid.has(id)) : [];
    const wanted = new Set(targets.map(keyFor));
    for (const task of tasks.current.values()) if (!wanted.has(task.key)) stop(task);
    if (clearing.current) return;
    for (const id of targets) {
      const key = keyFor(id);
      if (tasks.current.has(key)) continue;
      const cached = cache.current.get(key);
      if (!forced.current.has(key) && cached && (cached.phase === "error" ? Date.now() - cached.at < 10_000
        : availabilityFresh(cached.availability) && (!cached.availability?.[mode] || freshQuality(cached)))) continue;
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
      publish({ ...cached, phase: "audio", at: Date.now() });
      void (async () => {
        let availability = cached?.availability;
        let quality = cached?.quality;
        let qualityCheckedAt = cached?.qualityCheckedAt;
        try {
          // A local IPC read restores badges before any provider work starts.
          const stored = await window.aniDesktop.episodeMetadata(id).catch(() => undefined);
          if (task.cancelled) return;
          if (stored?.availability && (!availability || stored.availability.checkedAt > availability.checkedAt)) availability = stored.availability;
          const storedQuality = stored?.qualities[mode];
          if (storedQuality && (qualityCheckedAt === undefined || storedQuality.checkedAt > qualityCheckedAt)) {
            quality = storedQuality.quality; qualityCheckedAt = storedQuality.checkedAt;
          }
          publish({ phase: "audio", availability, quality, qualityCheckedAt, at: Date.now() });
          if (refresh || !availabilityFresh(availability)) availability = await request("audio", (options) => window.aniDesktop.availability(id, options), id === selected ? "selected" : "visible");
          if (task.cancelled) return;
          if (!availability![mode]) { publish({ phase: "ready", availability, at: Date.now() }); return; }
          if (!refresh && qualityFresh(qualityCheckedAt === undefined ? undefined : { quality, checkedAt: qualityCheckedAt })) {
            publish({ phase: "ready", availability, quality, qualityCheckedAt, at: Date.now() }); return;
          }
          publish({ phase: "quality", availability, quality, qualityCheckedAt, at: Date.now() });
          const streams = await request("quality", (options) => window.aniDesktop.streams(id, mode, options), id === selected ? "selected" : "nearby");
          publish({ phase: "ready", availability, quality: bestQuality(streams), qualityCheckedAt: Date.now(), at: Date.now() });
        } catch (error) {
          publish({ phase: "error", availability, quality, qualityCheckedAt, error: error instanceof Error ? error.message : String(error), at: Date.now() });
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
      forced.current.add(key); setRevision((value) => value + 1);
    },
    refresh: async (episodeIds = ids) => {
      clearing.current = true;
      for (const task of tasks.current.values()) stop(task);
      for (const id of episodeIds) for (const audio of ["sub", "dub"]) {
        const key = JSON.stringify([scope, id, audio]);
        forced.current.add(key);
      }
      try { await window.aniDesktop.clearEpisodeMetadata(episodeIds); }
      finally { clearing.current = false; setRevision((value) => value + 1); }
    },
    record: (id: string, audio: TranslationMode, streams: { quality: string }[]) => {
      const key = JSON.stringify([scope, id, audio]);
      const value: EpisodeMetadata = { ...cache.current.get(key), phase: "ready", quality: bestQuality(streams), qualityCheckedAt: Date.now(), at: Date.now() };
      cache.current.set(key, value); setValues((current) => ({ ...current, [key]: value }));
    }
  };
}
