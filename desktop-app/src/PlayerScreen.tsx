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
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "./player.css";
import { DesktopMediaStorage } from "./player-storage";
import { observePlayerDiagnostics } from "./player-diagnostics";
import { clampMiniPlayerWidth, type MiniPlayerCorner, type PlayerCommand, type PlayerSession } from "../shared/contracts";

export interface PlayerScreenProps {
  session: PlayerSession;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  /** Docked: the player is a small box in a corner while the user browses. Playback keys are off. */
  docked: boolean;
  corner: MiniPlayerCorner;
  onCornerChange: (corner: MiniPlayerCorner) => void;
  /** Docked width in pixels. The grip at the inner corner and the resize keys change it. */
  width: number;
  onWidthChange: (width: number) => void;
  /** How many episodes the series has, when the app knows the playing episode's place in it. */
  episodeCount?: number;
  /** Stream detail shown after the episode number, such as quality, audio, and source. */
  detail?: string;
  /** Progress or failure of a pending episode change. */
  message?: { text: string; error?: boolean };
  autoplayNext: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** Shrink to the corner and keep playing. Escape reaches this after closing menus and leaving fullscreen. */
  onDock: () => void;
  /** Open the playing episode's series without stopping. */
  onEpisodes: () => void;
  /** Return from the corner to the full player. */
  onExpand: () => void;
  /** End playback and remove the player. */
  onClose: () => void;
}

const NEXT_COUNTDOWN = 5;
const DRAG_THRESHOLD = 4;

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Icons for the docked bar, drawn in the app's own colours. */
const icons = {
  play: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>,
  expand: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3h-7v2h3.6l-4.3 4.3 1.4 1.4L19 6.4V10h2V3zM3 21h7v-2H6.4l4.3-4.3-1.4-1.4L5 17.6V14H3v7z" /></svg>
};

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

export default function PlayerScreen({ session, fullscreen, onFullscreenChange, docked, corner, onCornerChange, width, onWidthChange, episodeCount, detail, message, autoplayNext, onPrev, onNext, onDock, onEpisodes, onExpand, onClose }: PlayerScreenProps) {
  const api = window.aniDesktop.player;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [diagnostics, setDiagnostics] = useState(session.diagnostics === true);
  const [countdown, setCountdown] = useState<number>();
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number }>();
  // Pointer events can arrive before React commits the drag state, so the handlers read refs.
  const dragRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragStart = useRef<{ x: number; y: number; pointer: number } | undefined>(undefined);
  const [liveWidth, setLiveWidth] = useState<number>();
  const resizeStart = useRef<{ x: number; width: number; max: number; pointer: number } | undefined>(undefined);
  const shell = useRef<HTMLElement>(null);
  const player = useRef<MediaPlayerInstance>(null);
  const surface = useRef<HTMLDivElement>(null);
  const shortcutsDialog = useRef<HTMLDialogElement>(null);
  const transition = useRef(false);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const storage = useMemo(() => new DesktopMediaStorage(session, api,
    (reason) => setNotice(`Could not save playback preferences: ${errorMessage(reason)}`)), [session, api]);

  const logDiagnostic = useCallback((record: Record<string, unknown>) => {
    if (diagnostics) api.logDiagnostic(session.id, record);
  }, [api, diagnostics, session.id]);
  useEffect(() => api.onDiagnosticsChange(setDiagnostics), [api]);
  useEffect(() => {
    if (!diagnostics || !surface.current) return;
    logDiagnostic({ event: "renderer-ready", time: player.current?.state.currentTime });
    return observePlayerDiagnostics(surface.current, () => player.current, logDiagnostic);
  }, [diagnostics, session.id, attempt, logDiagnostic]);

  // A new session replaces the stream. Clear anything that belonged to the previous one.
  useEffect(() => {
    setError(undefined); setNotice(undefined); setCountdown(undefined); setAttempt(0);
    setDiagnostics(session.diagnostics === true); setTime(0); setDuration(0); setPaused(false);
  }, [session.id]);

  // Fullscreen belongs to the full player. Docking from fullscreen leaves it first.
  useEffect(() => {
    if (docked && fullscreen) void api.setFullscreen(false).then(onFullscreenChange).catch(() => undefined);
  }, [docked, fullscreen, api, onFullscreenChange]);

  useEffect(() => {
    document.title = session.request.title;
    return () => { document.title = "Ani Desktop"; };
  }, [session.request.title]);

  // Tell the main process the player screen is showing so menus and diagnostics follow it.
  useEffect(() => {
    void api.setActive(true).catch(() => undefined);
    return () => {
      if (fullscreenRef.current) void api.setFullscreen(false).catch(() => undefined);
      void api.setActive(false).catch(() => undefined);
    };
  }, [api]);

  useEffect(() => {
    const flush = () => storage.flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); };
  }, [storage]);

  useEffect(() => api.onNotice(setNotice), [api]);

  useEffect(() => {
    if (!showShortcuts) return;
    const previous = document.activeElement;
    shortcutsDialog.current?.showModal();
    return () => {
      shortcutsDialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [showShortcuts]);

  const fired = useRef(false);
  useEffect(() => { fired.current = false; }, [session.id]);
  useEffect(() => {
    if (countdown === undefined) return;
    if (countdown <= 0) {
      setCountdown(undefined);
      if (!fired.current) { fired.current = true; onNext?.(); }
      return;
    }
    const timer = setTimeout(() => setCountdown((value) => value === undefined ? undefined : value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, onNext]);

  const changeFullscreen = useCallback(async (next: boolean) => {
    if (transition.current) return;
    transition.current = true;
    setFullscreenBusy(true);
    try { onFullscreenChange(await api.setFullscreen(next)); }
    catch (reason) { setNotice(errorMessage(reason)); }
    finally { transition.current = false; setFullscreenBusy(false); }
  }, [api, onFullscreenChange]);

  const runCommand = useCallback((command: PlayerCommand) => {
    logDiagnostic({ event: "command", command, time: player.current?.state.currentTime });
    if (command === "shortcuts") { if (docked) onExpand(); setShowShortcuts(true); return; }
    if (showShortcuts || error) return;
    if (command === "fullscreen") { if (docked) onExpand(); else void changeFullscreen(!fullscreen); return; }
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
  }, [changeFullscreen, fullscreen, showShortcuts, error, logDiagnostic, docked, onExpand]);

  useEffect(() => api.onCommand(runCommand), [api, runCommand]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (event.isComposing || target?.isContentEditable || target?.matches("input, textarea, select")) return;
      if (docked) return; // While docked the app owns the keyboard.
      if (showShortcuts) return; // The native dialog owns Escape and focus trapping.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const menuOpen = Boolean(document.querySelector('.vds-menu-items[data-open]'));
      if (menuOpen) return;
      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;
      if (countdown !== undefined && (event.key === "Enter" || event.key === "Escape")) {
        action = event.key === "Enter" ? () => setCountdown(0) : () => setCountdown(undefined);
      } else if (key === "f") action = () => void changeFullscreen(!fullscreen);
      else if (event.key === "Escape") action = fullscreen ? () => void changeFullscreen(false) : onDock;
      else if (event.key === "?") action = () => setShowShortcuts(true);
      else if (key === "n" && onNext) action = onNext;
      else if (key === "p" && onPrev) action = onPrev;
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      action();
    };
    // Capture Vidstack's default double-click requests before its HTML fullscreen handler.
    // Its HTML fullscreen state stays false, so an enter request toggles the native window.
    const enter = (event: Event) => { event.preventDefault(); void changeFullscreen(!fullscreen); };
    const exit = (event: Event) => { event.preventDefault(); void changeFullscreen(false); };
    const element = surface.current;
    element?.addEventListener("media-enter-fullscreen-request", enter, true);
    element?.addEventListener("media-exit-fullscreen-request", exit, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      element?.removeEventListener("media-enter-fullscreen-request", enter, true);
      element?.removeEventListener("media-exit-fullscreen-request", exit, true);
    };
  }, [changeFullscreen, fullscreen, showShortcuts, countdown, docked, onDock, onNext, onPrev]);

  const togglePaused = useCallback(() => {
    const media = player.current;
    if (!media?.state.canPlay) return;
    void (media.paused ? media.play() : media.pause()).catch(() => undefined);
  }, []);

  // The docked bar is a drag handle. Release snaps to the nearest corner.
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    dragStart.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointer !== event.pointerId) return;
    const x = event.clientX - start.x, y = event.clientY - start.y;
    if (dragRef.current || Math.abs(x) > DRAG_THRESHOLD || Math.abs(y) > DRAG_THRESHOLD) { dragRef.current = { x, y }; setDrag(dragRef.current); }
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointer !== event.pointerId) return;
    dragStart.current = undefined;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    const offset = dragRef.current;
    if (!offset) return;
    const box = shell.current?.getBoundingClientRect();
    const parent = shell.current?.parentElement?.getBoundingClientRect();
    dragRef.current = undefined; setDrag(undefined);
    if (!box || !parent) return;
    // The box may not have moved yet if the drag transform is still pending, so apply the offset ourselves.
    const moved = shell.current?.style.transform ? 0 : 1;
    const centreX = box.left + moved * offset.x + box.width / 2 - parent.left, centreY = box.top + moved * offset.y + box.height / 2 - parent.top;
    const next: MiniPlayerCorner = `${centreY < parent.height / 2 ? "top" : "bottom"}-${centreX < parent.width / 2 ? "left" : "right"}`;
    if (next !== corner) onCornerChange(next);
  };

  async function openExternal() {
    setFallbackBusy(true);
    try { await api.openExternal(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setFallbackBusy(false); }
  }

  // The grip sits at the corner that faces the page, so dragging it inward grows the box.
  const maxWidth = () => { const parent = shell.current?.parentElement?.getBoundingClientRect(); return parent ? parent.width - 48 : Number.POSITIVE_INFINITY; };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    resizeStart.current = { x: event.clientX, width: shell.current?.getBoundingClientRect().width || width, max: maxWidth(), pointer: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointer !== event.pointerId) return;
    const sign = corner.endsWith("right") ? -1 : 1;
    setLiveWidth(clampMiniPlayerWidth(start.width + sign * (event.clientX - start.x), start.max));
  };
  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointer !== event.pointerId) return;
    resizeStart.current = undefined;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    setLiveWidth((value) => { if (value !== undefined && value !== width) onWidthChange(value); return undefined; });
  };
  const shownWidth = liveWidth ?? width;

  const episode = session.request.episode?.entry;
  const title = episode?.title ?? session.request.title;
  const episodeLabel = episode ? `episode ${episode.lastEpisode}${episodeCount ? ` of ${episodeCount}` : ""}` : undefined;
  const dockedSub = [episodeLabel, countdown !== undefined ? "ended" : duration ? `${clock(time)} / ${clock(duration)}` : undefined].filter(Boolean).join(" · ");

  return (
    <main ref={shell} className={`player-shell ${docked ? `is-docked corner-${corner}` : "is-expanded"} ${fullscreen && !docked ? "is-fullscreen" : ""} ${drag ? "is-dragging" : ""} ${liveWidth !== undefined ? "is-resizing" : ""}`}
      style={docked ? { "--mini-width": `${shownWidth}px`, ...(drag ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : {}) } as React.CSSProperties : undefined} aria-label={docked ? "Now playing" : undefined}>
      {!docked && <div className="now">
        <span className="now-title">{title}</span>
        {episodeLabel && <span className="now-ep">{episodeLabel}</span>}
        {detail && <span className="now-detail">{detail}</span>}
        {message && <span className={`now-detail ${message.error ? "err" : ""}`} role={message.error ? "alert" : "status"}>{message.text}</span>}
        <div className="now-acts">
          <button type="button" disabled={!onPrev} onClick={onPrev} aria-keyshortcuts="p">prev</button>
          <button type="button" disabled={!onNext} onClick={onNext} aria-keyshortcuts="n">next</button>
          <button type="button" onClick={onEpisodes} aria-keyshortcuts="Escape">episodes</button>
        </div>
      </div>}
      <div ref={surface} className="player-surface" onClick={docked ? (event) => { if (!(event.target as HTMLElement).closest("button")) onExpand(); } : undefined}>
        <MediaPlayer
          ref={player}
          key={`${session.id}:${attempt}`}
          className={`media-player ${fullscreen ? "is-native-fullscreen" : "is-windowed"}`}
          title={session.request.title}
          artist="Ani Desktop"
          artwork={episode?.poster ? [{ src: episode.poster }] : []}
          src={{ src: session.request.url, type: "application/vnd.apple.mpegurl" }}
          autoPlay
          playsInline
          viewType="video"
          streamType="on-demand"
          load="eager"
          controlsDelay={2500}
          hideControlsOnMouseLeave
          keyTarget="document"
          keyDisabled={docked || showShortcuts || Boolean(error) || countdown !== undefined}
          keyShortcuts={{
            ...MEDIA_KEY_SHORTCUTS,
            seekBackward: `${MEDIA_KEY_SHORTCUTS.seekBackward} Shift+ArrowLeft`,
            seekForward: `${MEDIA_KEY_SHORTCUTS.seekForward} Shift+ArrowRight`,
            toggleFullscreen: null
          }}
          storage={storage}
          onPause={() => {
            setPaused(true);
            if (player.current?.state.canPlay) void storage.setTime(player.current.state.currentTime);
            storage.flush();
          }}
          onSeeked={(time) => { void storage.setTime(time); storage.flush(); }}
          onPlay={() => setPaused(false)}
          onPlaying={() => setPaused(false)}
          onTimeUpdate={({ currentTime }) => setTime((value) => Math.floor(currentTime) === value ? value : Math.floor(currentTime))}
          onDurationChange={(value) => setDuration(Number.isFinite(value) ? value : 0)}
          onEnded={() => { if (autoplayNext && onNext) { fired.current = false; setCountdown(NEXT_COUNTDOWN); } }}
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
        {countdown !== undefined && (
          <div className="player-next" role="status">
            <b>next episode in {countdown} <span className="dots">···</span></b>
            <span>{title}</span>
            <div>
              <button type="button" className="primary" autoFocus onClick={() => setCountdown(0)}>play now</button>
              <button type="button" onClick={() => setCountdown(undefined)}>stay</button>
            </div>
          </div>
        )}
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
      </div>
      {docked && (
        <div className="mini-bar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <span className="mini-text"><span className="mini-title">{title}</span><span className="mini-sub">{dockedSub}</span></span>
          <button type="button" aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} onClick={togglePaused}>{paused ? icons.play : icons.pause}</button>
          <button type="button" aria-label="Expand player" title="Expand" onClick={onExpand}>{icons.expand}</button>
          <button type="button" className="mini-close" aria-label="Stop playback" title="Stop" onClick={onClose}>×</button>
        </div>
      )}
      {docked && (
        <div className="mini-resize" role="separator" aria-label="Resize player" aria-orientation="vertical" aria-valuenow={shownWidth} title="Drag to resize (⌘+ / ⌘−)"
          onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />
      )}
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
          <dt>N / P</dt><dd>Next or previous episode</dd>
          <dt>F / double-click</dt><dd>Toggle fullscreen</dd>
          <dt>Escape</dt><dd>Close menu, leave fullscreen, then shrink to the corner</dd>
          <dt>`</dt><dd>Return from the corner to the full player</dd>
          <dt>⌘ + / ⌘ −</dt><dd>Grow or shrink the corner player</dd>
          <dt>Tab / Shift + Tab</dt><dd>Move between controls</dd>
          <dt>?</dt><dd>Show shortcuts</dd>
        </dl>
        <button type="button" autoFocus onClick={() => setShowShortcuts(false)}>Close</button>
      </dialog>
    </main>
  );
}
