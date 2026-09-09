import { useEffect, useState } from "react";
import { MediaPlayer, MediaProvider } from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import type { PlayerSession } from "../shared/contracts";

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return "The built-in player could not load this stream.";
}

export default function PlayerApp() {
  const [session, setSession] = useState<PlayerSession>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [fallbackBusy, setFallbackBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const accept = (next: PlayerSession) => {
      if (!active) return;
      setSession(next); setError(undefined); setAttempt((value) => value + 1);
    };
    const unsubscribe = window.aniPlayer.onLoad(accept);
    window.aniPlayer.ready().then(accept, (reason) => setError(errorMessage(reason)));
    return () => { active = false; unsubscribe(); };
  }, []);

  async function openExternal() {
    setFallbackBusy(true);
    try { await window.aniPlayer.openExternal(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setFallbackBusy(false); }
  }

  if (!session) return <main className="player-shell"><div className="player-message">{error ?? "loading player…"}</div></main>;

  return (
    <main className="player-shell">
      <MediaPlayer
        key={`${session.request.url}:${attempt}`}
        className="media-player"
        title={session.request.title}
        src={{ src: session.request.url, type: "application/vnd.apple.mpegurl" }}
        autoPlay
        playsInline
        crossOrigin="anonymous"
        onError={(detail) => setError(errorMessage(detail))}
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
      {error && (
        <div className="player-error" role="alert">
          <strong>Playback failed</strong>
          <span>{error}</span>
          <div>
            <button type="button" onClick={() => { setError(undefined); setAttempt((value) => value + 1); }}>Retry</button>
            <button type="button" disabled={!session.canOpenExternal || fallbackBusy} onClick={() => void openExternal()}>
              {fallbackBusy ? "Opening…" : session.canOpenExternal ? "Open in external player" : "External player not configured"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
