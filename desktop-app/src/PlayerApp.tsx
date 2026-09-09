import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MediaPlayer,
  MediaProvider,
  SeekButton,
  MEDIA_KEY_SHORTCUTS,
  MediaRemoteControl,
  useMediaContext,
  isHLSProvider,
  type MediaPlayerInstance
} from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import { DesktopMediaStorage } from "./player-storage";
import { observePlayerDiagnostics } from "./player-diagnostics";
import type { PlayerCommand, PlayerSession } from "../shared/contracts";

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
      title={`${label} (F)`}
      aria-keyshortcuts="f"
      disabled={busy}
      onClick={onToggle}
    >
      <Icon className="vds-icon" />
    </button>
  );
}

function MenuEscapeHandler() {
  const media = useMediaContext();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !media.activeMenu || document.querySelector("dialog[open]")) return;
      // Mouse-opened menus may leave focus on the video or their trigger.
      // Close the active menu before Escape reaches the fullscreen handler.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) media.activeMenu.close(event);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [media]);
  return null;
}

export default function PlayerApp() {
  const [session, setSession] = useState<PlayerSession>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const player = useRef<MediaPlayerInstance>(null);
  const shell = useRef<HTMLElement>(null);
  const shortcutsDialog = useRef<HTMLDialogElement>(null);
  const transition = useRef(false);
  const storage = useMemo(() => session ? new DesktopMediaStorage(session, window.aniPlayer,
    (reason) => setNotice(`Could not save playback preferences: ${errorMessage(reason)}`)) : undefined, [session]);

  const logDiagnostic = useCallback((record: Record<string, unknown>) => {
    if (diagnostics && session) window.aniPlayer.logDiagnostic(session.id, record);
  }, [diagnostics, session?.id]);
  useEffect(() => window.aniPlayer.onDiagnosticsChange(setDiagnostics), []);
  useEffect(() => {
    if (!diagnostics || !session || !shell.current) return;
    logDiagnostic({ event: "renderer-ready", time: player.current?.state.currentTime });
    return observePlayerDiagnostics(shell.current, () => player.current, logDiagnostic);
  }, [diagnostics, session?.id, attempt, logDiagnostic]);

  useEffect(() => { if (session) document.title = session.request.title; }, [session]);

  useEffect(() => {
    const flush = () => storage?.flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); };
  }, [storage]);

  useEffect(() => {
    if (!showShortcuts) return;
    const previous = document.activeElement;
    shortcutsDialog.current?.showModal();
    return () => {
      shortcutsDialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [showShortcuts]);

  useEffect(() => {
    let active = true;
    let nativeFullscreen: boolean | undefined;
    const accept = (next: PlayerSession) => {
      if (!active) return;
      setSession((current) => current?.id === next.id ? current : next);
      setDiagnostics(next.diagnostics === true);
      setFullscreen(nativeFullscreen ?? next.fullscreen); setError(undefined); setNotice(undefined);
    };
    let receivedLoad = false;
    const unsubscribe = window.aniPlayer.onLoad((next) => { receivedLoad = true; accept(next); });
    const unsubscribeFullscreen = window.aniPlayer.onFullscreenChange((next) => {
      nativeFullscreen = next;
      if (active) setFullscreen(next);
    });
    const unsubscribeNotice = window.aniPlayer.onNotice((message) => { if (active) setNotice(message); });
    window.aniPlayer.ready().then((next) => { if (!receivedLoad) accept(next); }, (reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; unsubscribe(); unsubscribeFullscreen(); unsubscribeNotice(); };
  }, []);

  const changeFullscreen = useCallback(async (next: boolean) => {
    if (transition.current) return;
    transition.current = true;
    setFullscreenBusy(true);
    try { setFullscreen(await window.aniPlayer.setFullscreen(next)); }
    catch (reason) { setNotice(errorMessage(reason)); }
    finally { transition.current = false; setFullscreenBusy(false); }
  }, []);

  const runCommand = useCallback((command: PlayerCommand) => {
    logDiagnostic({ event: "command", command, time: player.current?.state.currentTime });
    if (command === "shortcuts") { setShowShortcuts(true); return; }
    if (showShortcuts || error) return;
    if (command === "fullscreen") { void changeFullscreen(!fullscreen); return; }
    const media = player.current;
    if (!media?.state.canPlay) return;
    const remote = new MediaRemoteControl();
    remote.setPlayer(media);
    remote.setTarget(media.el);
    switch (command) {
      case "play-pause": remote.togglePaused(); break;
      case "mute": remote.toggleMuted(); break;
      case "captions": remote.toggleCaptions(); break;
      case "pip": remote.togglePictureInPicture(); break;
      case "seek-backward": remote.seek(Math.max(0, media.state.currentTime - 10)); break;
      case "seek-forward": remote.seek(Math.min(media.state.duration, media.state.currentTime + 10)); break;
      case "volume-up": remote.changeVolume(Math.min(1, media.state.volume + 0.05)); break;
      case "volume-down": remote.changeVolume(Math.max(0, media.state.volume - 0.05)); break;
      case "speed-up": remote.changePlaybackRate(Math.min(2, media.state.playbackRate + 0.25)); break;
      case "speed-down": remote.changePlaybackRate(Math.max(0.25, media.state.playbackRate - 0.25)); break;
    }
  }, [changeFullscreen, fullscreen, showShortcuts, error, logDiagnostic]);

  useEffect(() => window.aniPlayer.onCommand(runCommand), [runCommand]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (event.isComposing || target?.isContentEditable || target?.matches("input, textarea, select")) return;
      if (showShortcuts) return; // The native dialog owns Escape and focus trapping.
      const menuOpen = document.querySelector('.vds-menu-items[data-open]');
      const toggle = event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const exit = event.key === "Escape" && fullscreen && !menuOpen;
      const help = event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!toggle && !exit && !help) return;
      if (menuOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (help) setShowShortcuts(true);
      else void changeFullscreen(toggle ? !fullscreen : false);
    };
    // Capture Vidstack's default double-click requests before its HTML fullscreen handler.
    // Its HTML fullscreen state stays false, so an enter request toggles the native window.
    const enter = (event: Event) => { event.preventDefault(); void changeFullscreen(!fullscreen); };
    const exit = (event: Event) => { event.preventDefault(); void changeFullscreen(false); };
    const element = shell.current;
    element?.addEventListener("media-enter-fullscreen-request", enter, true);
    element?.addEventListener("media-exit-fullscreen-request", exit, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      element?.removeEventListener("media-enter-fullscreen-request", enter, true);
      element?.removeEventListener("media-exit-fullscreen-request", exit, true);
    };
  }, [changeFullscreen, fullscreen, showShortcuts, session]);

  async function openExternal() {
    setFallbackBusy(true);
    try { await window.aniPlayer.openExternal(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setFallbackBusy(false); }
  }

  if (!session) return <main className="player-shell"><div className="player-message">{error ?? "loading player…"}</div></main>;

  return (
    <main ref={shell} className="player-shell">
      <MediaPlayer
        ref={player}
        key={`${session.id}:${attempt}`}
        className={`media-player ${fullscreen ? "is-native-fullscreen" : "is-windowed"}`}
        title={session.request.title}
        artist="Ani Desktop"
        artwork={session.request.episode?.entry.poster ? [{ src: session.request.episode.entry.poster }] : []}
        src={{ src: session.request.url, type: "application/vnd.apple.mpegurl" }}
        autoPlay
        playsInline
        viewType="video"
        streamType="on-demand"
        load="eager"
        controlsDelay={2500}
        hideControlsOnMouseLeave
        keyTarget="document"
        keyDisabled={showShortcuts || Boolean(error)}
        keyShortcuts={{
          ...MEDIA_KEY_SHORTCUTS,
          seekBackward: `${MEDIA_KEY_SHORTCUTS.seekBackward} Shift+ArrowLeft`,
          seekForward: `${MEDIA_KEY_SHORTCUTS.seekForward} Shift+ArrowRight`,
          toggleFullscreen: null
        }}
        storage={storage}
        onPause={() => {
          if (player.current?.state.canPlay) void storage?.setTime(player.current.state.currentTime);
          storage?.flush();
        }}
        onSeeked={(time) => { void storage?.setTime(time); storage?.flush(); }}
        onProviderChange={(provider) => {
          if (isHLSProvider(provider)) provider.library = () => import("hls.js");
        }}
        crossOrigin="anonymous"
        onError={(detail) => setError(errorMessage(detail))}
      >
        <MenuEscapeHandler />
        <MediaProvider />
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          seekStep={10}
          slots={{
            beforePlayButton: <SeekControl seconds={-10} />,
            afterPlayButton: <SeekControl seconds={10} />,
            beforeSettingsMenu: <button type="button" className="vds-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShowShortcuts(true)}>?</button>,
            googleCastButton: null,
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
      <dialog ref={shortcutsDialog} className="player-shortcuts" aria-labelledby="shortcuts-title" onCancel={() => setShowShortcuts(false)} onClose={() => setShowShortcuts(false)}>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl>
          <dt>Space / K</dt><dd>Play or pause</dd>
          <dt>← / → / J / L</dt><dd>Seek 10 seconds</dd>
          <dt>Shift + ← / →</dt><dd>Seek 20 seconds</dd>
          <dt>↑ / ↓</dt><dd>Adjust volume</dd>
          <dt>M</dt><dd>Mute</dd>
          <dt>C</dt><dd>Toggle captions</dd>
          <dt>&lt; / &gt;</dt><dd>Change playback speed</dd>
          <dt>0–9</dt><dd>Jump to 0–90% of the episode</dd>
          <dt>I</dt><dd>Picture in picture</dd>
          <dt>F / double-click</dt><dd>Toggle fullscreen</dd>
          <dt>Escape</dt><dd>Close menu, then leave fullscreen</dd>
          <dt>Tab / Shift + Tab</dt><dd>Move between controls</dd>
          <dt>?</dt><dd>Show shortcuts</dd>
        </dl>
        <button type="button" autoFocus onClick={() => setShowShortcuts(false)}>Close</button>
      </dialog>
      {notice && <div className="player-notice" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice(undefined)}>×</button></div>}
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
