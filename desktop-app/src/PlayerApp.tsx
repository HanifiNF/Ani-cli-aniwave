import { useCallback, useEffect, useState } from "react";
import {
  MediaPlayer,
  MediaProvider,
  SeekButton
} from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import type { PlayerSession } from "../shared/contracts";

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return "The built-in player could not load this stream.";
}

function SeekControl({ seconds }: { seconds: -10 | 10 }) {
  const backward = seconds < 0;
  const label = backward ? "Rewind 10 seconds" : "Forward 10 seconds";
  const Icon = backward ? defaultLayoutIcons.SeekButton.Backward : defaultLayoutIcons.SeekButton.Forward;

  return (
    <SeekButton className="vds-button player-seek-button" seconds={seconds} aria-label={label} title={label}>
      <Icon className="vds-icon" />
    </SeekButton>
  );
}

function FullscreenControl({ fullscreen, busy, onToggle }: { fullscreen: boolean; busy: boolean; onToggle: () => void }) {
  const label = fullscreen ? "Exit fullscreen" : "Enter fullscreen";
  const Icon = fullscreen ? defaultLayoutIcons.FullscreenButton.Exit : defaultLayoutIcons.FullscreenButton.Enter;

  return (
    <button
      type="button"
      className="vds-button player-fullscreen-button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onToggle}
    >
      <Icon className="vds-icon" />
    </button>
  );
}

export default function PlayerApp() {
  const [session, setSession] = useState<PlayerSession>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const accept = (next: PlayerSession) => {
      if (!active) return;
      setSession(next); setFullscreen(next.fullscreen); setError(undefined); setAttempt((value) => value + 1);
    };
    const unsubscribe = window.aniPlayer.onLoad(accept);
    const unsubscribeFullscreen = window.aniPlayer.onFullscreenChange((next) => {
      if (active) setFullscreen(next);
    });
    window.aniPlayer.ready().then(accept, (reason) => setError(errorMessage(reason)));
    return () => { active = false; unsubscribe(); unsubscribeFullscreen(); };
  }, []);

  const changeFullscreen = useCallback(async (next: boolean) => {
    setFullscreenBusy(true);
    try { setFullscreen(await window.aniPlayer.setFullscreen(next)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setFullscreenBusy(false); }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (target?.isContentEditable || target?.matches("input, textarea, select")) return;
      const toggleWithF = event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const exitWithEscape = event.key === "Escape" && fullscreen;
      if (!toggleWithF && !exitWithEscape) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void changeFullscreen(toggleWithF ? !fullscreen : false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [changeFullscreen, fullscreen]);

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
        className={`media-player ${fullscreen ? "is-native-fullscreen" : "is-windowed"}`}
        title={session.request.title}
        src={{ src: session.request.url, type: "application/vnd.apple.mpegurl" }}
        autoPlay
        playsInline
        viewType="video"
        streamType="on-demand"
        load="eager"
        controlsDelay={2500}
        hideControlsOnMouseLeave
        keyShortcuts={{ toggleFullscreen: null }}
        crossOrigin="anonymous"
        onError={(detail) => setError(errorMessage(detail))}
      >
        <MediaProvider />
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          seekStep={10}
          slots={{
            beforePlayButton: <SeekControl seconds={-10} />,
            afterPlayButton: <SeekControl seconds={10} />,
            fullscreenButton: (
              <FullscreenControl
                fullscreen={fullscreen}
                busy={fullscreenBusy}
                onToggle={() => void changeFullscreen(!fullscreen)}
              />
            )
          }}
        />
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
