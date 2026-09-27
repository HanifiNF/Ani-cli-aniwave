import type { PlayerDiagnosticRecord } from "../shared/player-diagnostics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MediaPlayer,
  MediaProvider,
  SeekButton,
  MEDIA_KEY_SHORTCUTS,
  MediaRemoteControl,
  useMediaContext,
  isHLSProvider,
  Track,
  type MediaPlayerInstance
} from "@vidstack/react";
import { DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "./player.css";
import { DesktopMediaStorage } from "./player-storage";
import { shortcut } from "./keys";
import { observePlayerDiagnostics } from "./player-diagnostics";
import { clampMiniPlayerWidth, type MiniPlayerCorner, type PlayerCommand, type PlayerSession, type SubtitleAppearance } from "../shared/contracts";
import { SubtitleAppearanceEditor, SubtitlePreview, subtitleVariables } from "./SubtitleAppearanceEditor";
import { Glyph, Icon } from "./icons";
import { playerIcons } from "./playerIcons";
import Swap from "./Swap";
import { Spring, rubber, velocityTracker } from "./motion";
import { takeCapturedPlayer, takePlayOrigin, type Rect } from "./playerMotion";

const SIDES = ["x", "y", "w", "h"] as const;
type Box = Record<(typeof SIDES)[number], Spring>;

export interface PlayerScreenProps {
  session: PlayerSession;
  subtitleAppearance: SubtitleAppearance;
  onSubtitleAppearance: (value: SubtitleAppearance) => void;
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
  /** Resolve a fresh URL after a playback failure. */
  onRetry?: () => void;
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

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return "The built-in player could not load this stream.";
}

function SeekControl({ seconds }: { seconds: -10 | 10 }) {
  const backward = seconds < 0;
  const label = backward ? "Rewind 10 seconds" : "Forward 10 seconds";
  const Icon = backward ? playerIcons.SeekButton.Backward : playerIcons.SeekButton.Forward;

  return (
    <SeekButton className="vds-button player-seek-button" seconds={seconds} aria-label={label} title={label}>
      <Icon className="vds-icon" />
    </SeekButton>
  );
}

function FullscreenControl({ fullscreen, busy, onToggle }: { fullscreen: boolean; busy: boolean; onToggle: () => void }) {
  const label = fullscreen ? "Exit fullscreen" : "Enter fullscreen";
  const Icon = fullscreen ? playerIcons.FullscreenButton.Exit : playerIcons.FullscreenButton.Enter;

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

/** The last entry of the settings menu. Closes the menu first, so the dialog is alone on screen. */
function SubtitleMenuEntry({ onOpen }: { onOpen: () => void }) {
  const media = useMediaContext();
  return <button type="button" className="vds-menu-item subtitle-menu-entry" role="menuitem" onClick={(event) => { media.activeMenu?.close(event.nativeEvent); onOpen(); }}>
    <Glyph name="captions" className="vds-icon" />
    <span className="vds-menu-item-label">Subtitle appearance</span>
  </button>;
}

/** Reports whether the loaded media carries a subtitle track, including ones found inside an HLS playlist. */
function TrackWatcher({ onChange }: { onChange: (count: number) => void }) {
  const media = useMediaContext();
  useEffect(() => {
    const list = media.textTracks;
    if (!list) return;
    const update = () => onChange([...list].filter((track) => track.kind === "subtitles" || track.kind === "captions").length);
    update();
    list.addEventListener("add", update);
    list.addEventListener("remove", update);
    return () => { list.removeEventListener("add", update); list.removeEventListener("remove", update); };
  }, [media, onChange]);
  return null;
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

export default function PlayerScreen({ session, subtitleAppearance, onSubtitleAppearance, fullscreen, onFullscreenChange, docked, corner, onCornerChange, width, onWidthChange, episodeCount, detail, message, autoplayNext, onPrev, onNext, onRetry, onDock, onEpisodes, onExpand, onClose }: PlayerScreenProps) {
  const api = window.aniDesktop.player;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSubtitleAppearance, setShowSubtitleAppearance] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState(session.request.textTracks?.length ?? 0);
  const [diagnostics, setDiagnostics] = useState(session.diagnostics === true);
  const [countdown, setCountdown] = useState<number>();
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Pointer events can arrive before React commits the drag state, so the handlers read refs.
  const dragStart = useRef<{ x: number; y: number; pointer: number; from: { x: number; y: number }; moved: boolean; tracker: ReturnType<typeof velocityTracker> } | undefined>(undefined);
  const [liveWidth, setLiveWidth] = useState<number>();
  const resizeStart = useRef<{ x: number; width: number; max: number; pointer: number } | undefined>(undefined);
  const shell = useRef<HTMLElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  /*
    The box is four glide springs for the rectangle the player is drawn in; its layout (expanded, or docked in a corner)
    is where they head. Growing from the Play button, docking, expanding, and a thrown corner player all move it, and a
    new layout mid-flight turns it from where it is. At rest the box is its layout and carries no transform.
  */
  const box = useRef<Box>(null);
  const layout = useRef<Rect>(null);
  const holding = useRef(false);
  const growth = useRef<{ from: number; to: number } | null>(null);
  const release = useRef<{ x: number; y: number } | undefined>(undefined);
  const applyBox = useCallback(() => {
    const element = shell.current, target = layout.current, sides = box.current;
    if (!element || !target || !sides) return;
    const moving = holding.current || SIDES.some((side) => sides[side].moving);
    if (!moving) {
      element.style.transform = ""; element.style.transformOrigin = ""; element.style.borderRadius = ""; element.style.overflow = "";
      element.style.removeProperty("--chrome");
      growth.current = null;
      if (flash.current) flash.current.style.opacity = "0";
      return;
    }
    const sx = sides.w.x / target.w, sy = sides.h.x / target.h;
    element.style.transformOrigin = "0 0";
    element.style.transform = `translate(${sides.x.x - target.x}px, ${sides.y.x - target.y}px)${sx === 1 && sy === 1 ? "" : ` scale(${sx}, ${sy})`}`;
    // Corners stay round at 10px on screen whatever the scale.
    element.style.borderRadius = `${10 / sx}px / ${10 / sy}px`;
    element.style.overflow = "hidden";
    // The title bars only read at their own size: while the box is scaled they fade, and the video carries the move.
    element.style.setProperty("--chrome", String(Math.max(0, 1 - Math.abs(1 - Math.min(sx, sy)) * 2.5)));
    const grow = growth.current;
    if (grow && flash.current) flash.current.style.opacity = String(Math.min(1, Math.max(0, 1 - 2.2 * (sides.w.x - grow.from) / Math.max(1, grow.to - grow.from))));
  }, []);
  const measure = useCallback((): Rect | undefined => {
    const element = shell.current;
    if (!element) return undefined;
    const transform = element.style.transform;
    element.style.transform = "";
    const r = element.getBoundingClientRect();
    element.style.transform = transform;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, []);
  /** Heads for the current layout, from `from` when given (a captured rectangle or an origin), else from where the box is. */
  const morph = useCallback((from?: Rect, velocity?: { x: number; y: number }) => {
    const target = measure();
    if (!target || !target.w || !target.h) return;
    layout.current = target;
    if (!box.current) {
      const start = from ?? target;
      box.current = { x: new Spring(start.x, "glide", applyBox, 0.3), y: new Spring(start.y, "glide", applyBox, 0.3), w: new Spring(start.w, "glide", applyBox, 0.3), h: new Spring(start.h, "glide", applyBox, 0.3) };
    } else if (from && !holding.current && !SIDES.some((side) => box.current![side].moving)) {
      for (const side of SIDES) box.current[side].set(from[side]);
    }
    holding.current = false;
    for (const side of SIDES) box.current[side].to(target[side], { velocity: side === "x" || side === "y" ? velocity?.[side] : undefined });
    applyBox();
  }, [applyBox, measure]);
  const player = useRef<MediaPlayerInstance>(null);
  const surface = useRef<HTMLDivElement>(null);
  const shortcutsDialog = useRef<HTMLDialogElement>(null);
  const subtitleDialog = useRef<HTMLDialogElement>(null);
  const transition = useRef(false);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const storage = useMemo(() => new DesktopMediaStorage(session, api,
    (reason) => setNotice(`Could not save playback preferences: ${errorMessage(reason)}`)), [session, api]);

  const logDiagnostic = useCallback((record: PlayerDiagnosticRecord) => {
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
    return () => { document.title = "ANIdesktop"; };
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

  useEffect(() => {
    if (!showSubtitleAppearance) return;
    const previous = document.activeElement;
    subtitleDialog.current?.showModal();
    return () => {
      subtitleDialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [showSubtitleAppearance]);

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
    if (showShortcuts || showSubtitleAppearance || error) return;
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
  }, [changeFullscreen, fullscreen, showShortcuts, showSubtitleAppearance, error, logDiagnostic, docked, onExpand]);

  useEffect(() => api.onCommand(runCommand), [api, runCommand]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (event.isComposing || target?.isContentEditable || target?.matches("input, textarea, select")) return;
      if (docked) return; // While docked the app owns the keyboard.
      if (showShortcuts || showSubtitleAppearance) return; // Native dialogs own Escape and focus trapping.
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
  }, [changeFullscreen, fullscreen, showShortcuts, showSubtitleAppearance, countdown, docked, onDock, onNext, onPrev]);

  const togglePaused = useCallback(() => {
    const media = player.current;
    if (!media?.state.canPlay) return;
    void (media.paused ? media.play() : media.pause()).catch(() => undefined);
  }, []);

  // The player grows out of whatever started it (the Play button, an episode row, a card) when that is still on screen.
  useLayoutEffect(() => {
    const origin = docked || fullscreen ? undefined : takePlayOrigin();
    if (origin && flash.current) {
      flash.current.style.background = origin.fill ? "var(--cursor)" : "var(--raised)";
      flash.current.style.opacity = "1";
    }
    const target = measure();
    if (origin && target) growth.current = { from: origin.rect.w, to: target.w };
    morph(origin?.rect);
  }, []);
  // Docking, expanding, and a new corner move the box from where it was drawn to its new layout.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!placed.current) { placed.current = true; return; }
    const velocity = release.current;
    release.current = undefined;
    morph(takeCapturedPlayer(), velocity);
  }, [docked, corner]);

  // The docked bar is a drag handle: the box follows the pointer exactly, stretches past the window's edges, and on
  // release flies to the corner it was thrown toward, keeping its speed.
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    if (!box.current || !layout.current) morph();
    if (!box.current) return;
    const tracker = velocityTracker();
    tracker.add(event.clientX, event.clientY);
    dragStart.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId, from: { x: box.current.x.x, y: box.current.y.x }, moved: false, tracker };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current, sides = box.current, target = layout.current;
    if (!start || start.pointer !== event.pointerId || !sides || !target) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
    if (!start.moved) { start.moved = true; setDragging(true); }
    start.tracker.add(event.clientX, event.clientY);
    const parent = shell.current?.parentElement?.getBoundingClientRect();
    let x = start.from.x + dx, y = start.from.y + dy;
    if (parent) {
      const left = parent.left + 24, right = parent.right - 24 - target.w, top = parent.top + 16, bottom = parent.bottom - 16 - target.h;
      if (x < left) x = left + rubber(x - left, 40); else if (x > right) x = right + rubber(x - right, 40);
      if (y < top) y = top + rubber(y - top, 40); else if (y > bottom) y = bottom + rubber(y - bottom, 40);
    }
    holding.current = true;
    sides.x.set(x); sides.y.set(y);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current, sides = box.current, target = layout.current;
    if (!start || start.pointer !== event.pointerId) return;
    dragStart.current = undefined;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    if (!start.moved || !sides || !target) return;
    setDragging(false);
    const velocity = start.tracker.velocity();
    const parent = shell.current?.parentElement?.getBoundingClientRect();
    if (!parent) { morph(undefined, velocity); return; }
    // Where the throw would carry the box decides the corner.
    const carry = (speed: number) => Math.max(-600, Math.min(600, speed * 0.2));
    const centreX = sides.x.x + carry(velocity.x) + target.w / 2 - parent.left, centreY = sides.y.x + carry(velocity.y) + target.h / 2 - parent.top;
    const next: MiniPlayerCorner = `${centreY < parent.height / 2 ? "top" : "bottom"}-${centreX < parent.width / 2 ? "left" : "right"}`;
    if (next !== corner) { release.current = velocity; onCornerChange(next); }
    else morph(undefined, velocity);
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
    <main ref={shell} className={`player-shell ${docked ? `is-docked corner-${corner}` : "is-expanded"} ${fullscreen && !docked ? "is-fullscreen" : ""} ${dragging ? "is-dragging" : ""} ${liveWidth !== undefined ? "is-resizing" : ""}`}
      style={docked ? { "--mini-width": `${shownWidth}px` } as React.CSSProperties : undefined} aria-label={docked ? "Now playing" : undefined}>
      <div className="player-flash" ref={flash} aria-hidden="true" />
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
          style={subtitleVariables(subtitleAppearance)}
          title={session.request.title}
          artist="ANIdesktop"
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
          keyDisabled={docked || showShortcuts || showSubtitleAppearance || Boolean(error) || countdown !== undefined}
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
          <TrackWatcher onChange={setSubtitleTracks} />
          <MediaProvider>
            {session.request.textTracks?.map((track, index) => <Track key={`${track.src}:${index}`} src={track.src} kind="subtitles" label={track.label} lang={track.lang} default={track.default} />)}
          </MediaProvider>
          <DefaultVideoLayout
            icons={playerIcons}
            seekStep={10}
            slots={{
              beforePlayButton: <SeekControl seconds={-10} />,
              afterPlayButton: <SeekControl seconds={10} />,
              beforeSettingsMenu: <button type="button" className="vds-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShowShortcuts(true)}><Glyph name="keyboard" className="vds-icon" /></button>,
              settingsMenuEndItems: <SubtitleMenuEntry onOpen={() => setShowSubtitleAppearance(true)} />,
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
              <button type="button" disabled={Boolean(onRetry && message && !message.error)} onClick={() => { if (onRetry) onRetry(); else { setError(undefined); setAttempt((value) => value + 1); } }}>{onRetry && message && !message.error ? "Finding stream…" : "Retry"}</button>
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
          <button type="button" aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} onClick={togglePaused}><Swap id={paused ? "play" : "pause"}><Icon name={paused ? "play" : "pause"} /></Swap></button>
          <button type="button" aria-label="Expand player" title="Expand" onClick={onExpand}><Icon name="expand" /></button>
          <button type="button" className="mini-close" aria-label="Stop playback" title="Stop" onClick={onClose}><Icon name="x" /></button>
        </div>
      )}
      {docked && (
        <div className="mini-resize" role="separator" aria-label="Resize player" aria-orientation="vertical" aria-valuenow={shownWidth} title={`Drag to resize (${shortcut("+")} / ${shortcut("−")})`}
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
          <dt>{shortcut("+")} / {shortcut("−")}</dt><dd>Grow or shrink the corner player</dd>
          <dt>Tab / Shift + Tab</dt><dd>Move between controls</dd>
          <dt>?</dt><dd>Show shortcuts</dd>
        </dl>
        <button type="button" autoFocus onClick={() => setShowShortcuts(false)}>Close</button>
      </dialog>
      <dialog ref={subtitleDialog} className="player-subtitle-dialog" aria-labelledby="subtitle-dialog-title"
        onCancel={() => setShowSubtitleAppearance(false)} onClose={() => setShowSubtitleAppearance(false)}>
        <h2 id="subtitle-dialog-title">Subtitle appearance</h2>
        <div className="group"><div className="box">
          <SubtitlePreview value={subtitleAppearance} />
          <SubtitleAppearanceEditor value={subtitleAppearance} onChange={onSubtitleAppearance}
            note={subtitleTracks ? undefined : "This stream came without a subtitle track. The preset applies when one is available; text burned into the picture cannot be styled."} />
        </div></div>
        <button type="button" className="btn" onClick={() => setShowSubtitleAppearance(false)}>Close</button>
      </dialog>
    </main>
  );
}
