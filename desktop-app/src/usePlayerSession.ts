import { useEffect, useRef, useState } from "react";
import type { PlayerSession } from "../shared/contracts";

/** Subscribe once; navigation callbacks always observe the current render. */
export function usePlayerSession(onLoad: () => void) {
  const [session, setSession] = useState<PlayerSession>();
  const [fullscreen, setFullscreen] = useState(false);
  const loaded = useRef(onLoad);
  loaded.current = onLoad;
  useEffect(() => {
    let active = true;
    const player = window.aniDesktop.player;
    const show = (next: PlayerSession | undefined) => {
      if (!active || !next) return;
      setSession(next); setFullscreen(next.fullscreen); loaded.current();
    };
    const unsubscribe = player.onLoad(show);
    const unsubscribeFullscreen = player.onFullscreenChange(setFullscreen);
    void player.ready().then(show, () => undefined);
    return () => { active = false; unsubscribe(); unsubscribeFullscreen(); };
  }, []);
  return { session, setSession, fullscreen, setFullscreen };
}
