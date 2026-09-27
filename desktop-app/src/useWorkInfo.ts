import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimeResult, CatalogRequest, WorkInfo } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import { catalogRequestId } from "./catalog-request";

const keysOf = (anime: AnimeResult) => [...(anime.refs ?? []), ...animeSources(anime).map((source) => source.id)].sort();

/** Series information for open works: the cached copy shows first and a refresh replaces it when one arrives. */
export function useWorkInfo(scope: string) {
  const [infos, setInfos] = useState<Record<string, WorkInfo>>({});
  // Works whose request has finished, found or not; until then the page holds room for the information.
  const [settled, setSettled] = useState<Record<string, true>>({});
  const tasks = useRef(new Map<string, string>());

  useEffect(() => {
    for (const id of tasks.current.values()) window.aniDesktop.cancelCatalog(id);
    tasks.current.clear(); setInfos({}); setSettled({});
  }, [scope]);

  const remember = useCallback((keys: string[], value: WorkInfo) => {
    setInfos((current) => {
      const next = { ...current };
      for (const key of [...keys, ...value.refs]) next[key] = value;
      return next;
    });
  }, []);

  const load = useCallback((anime: AnimeResult, priority: NonNullable<CatalogRequest["priority"]> = "selected", refresh = false) => {
    const keys = keysOf(anime), key = keys.join("|");
    if (!key || tasks.current.has(key)) return;
    const id = catalogRequestId("work-info");
    tasks.current.set(key, id);
    const update = (value: WorkInfo | undefined) => { if (value) remember(keys, value); };
    void window.aniDesktop.workInfo(anime, { id, priority, refresh }, update)
      .then(update).catch(() => undefined).finally(() => {
        if (tasks.current.get(key) !== id) return;
        tasks.current.delete(key);
        setSettled((current) => current[key] ? current : { ...current, [key]: true });
      });
  }, [remember, scope]);

  const get = useCallback((anime: AnimeResult): WorkInfo | undefined => {
    for (const key of keysOf(anime)) if (infos[key]) return infos[key];
    return undefined;
  }, [infos]);

  /** True until the work has information or its request has finished without any. */
  const loading = useCallback((anime: AnimeResult): boolean => !get(anime) && !settled[keysOf(anime).join("|")], [settled, get]);

  return { get, load, loading };
}
