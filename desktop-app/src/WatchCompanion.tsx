import { useEffect, useRef, useState } from "react";
import { COMPANION_ANIMATIONS, COMPANION_REGISTRY, companionFrame, companionImageUrl, normalizeCompanionPreferences, type CompanionAnimation, type CompanionHome, type CompanionPetId } from "../shared/companion";
import type { MiniPlayerCorner, Settings } from "../shared/contracts";
import { CompanionDialogueGate, companionLine, type CompanionEvent } from "./companion-dialogue";
import { clampPoint, homeFromPosition, petSize, positionFromHome, wanderTarget, type Bounds, type Point, type Obstacle } from "./companion-motion";

interface Props {
  settings: Settings;
  screen: string;
  fullscreen: boolean;
  corner: MiniPlayerCorner;
  dockedPlayer: boolean;
  event?: CompanionEvent;
  customImage?: string;
  customName?: string;
  onHomeChange?: (home: CompanionHome) => void;
  onMessageDone?: (id: number) => void;
  onMessageAction?: (event: CompanionEvent) => void;
}

const initialBounds = (): Bounds => ({ left: 8, top: 76, right: window.innerWidth - 8, bottom: window.innerHeight - 8 });
export default function WatchCompanion({ settings, screen, fullscreen, corner, dockedPlayer, event, customImage, customName, onHomeChange, onMessageDone, onMessageAction }: Props) {
  const { companionEnabled: enabled, companionPetId: selectedId, companionFrequency: frequency, companionWander: wander, companionHome: home, companionSize } = normalizeCompanionPreferences(settings);
  const size = petSize(companionSize);
  const scale = companionSize / 100;
  const customSelected = selectedId.startsWith("custom:") && Boolean(customImage);
  const builtInId: CompanionPetId = selectedId.startsWith("custom:") ? "columbinya" : selectedId as CompanionPetId;
  const pet = customSelected ? { name: customName ?? "Custom companion", image: customImage! } : COMPANION_REGISTRY[builtInId];
  const [bounds, setBounds] = useState<Bounds>(initialBounds);
  const [position, setPosition] = useState<Point>(() => positionFromHome(home, initialBounds(), dockedPlayer && corner.endsWith("left"), size));
  const positionRef = useRef(position);
  const drag = useRef<{ pointerId: number; x: number; y: number; origin: Point; moved: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const moveTo = (next: Point) => { positionRef.current = next; setPosition(next); };
  const gate = useRef(new CompanionDialogueGate());
  const priorScreen = useRef(screen);
  const lastEventId = useRef<number>(undefined);
  const [line, setLine] = useState<string>();
  const [activeEvent, setActiveEvent] = useState<CompanionEvent>();
  const activeEventRef = useRef<CompanionEvent | undefined>(undefined);
  const [animation, setAnimation] = useState<CompanionAnimation>("idle");
  const [frame, setFrame] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const animationTimer = useRef<number | undefined>(undefined);
  const bubbleRemaining = useRef(0);
  const animationRemaining = useRef(0);
  const bubbleDeadline = useRef(0);
  const animationDeadline = useRef(0);
  const lastLine = useRef("");
  const dismissMessage = (notify = true) => {
    window.clearTimeout(bubbleTimer.current);
    bubbleRemaining.current = 0;
    const previous = activeEventRef.current;
    activeEventRef.current = undefined;
    setActiveEvent(undefined);
    setLine(undefined);
    if (notify && previous && (previous.kind === "startup-update" || previous.kind === "startup-continue")) onMessageDone?.(previous.id);
  };
  const show = (candidate: CompanionEvent) => {
    moveTo(positionFromHome(home, bounds, dockedPlayer && corner.endsWith("left"), size));
    const result = companionLine(candidate, companionLine(candidate).text === lastLine.current);
    lastLine.current = result.text;
    setLine(result.text);
    activeEventRef.current = candidate;
    setActiveEvent(candidate);
    setAnimation(result.animation);
    setFrame(0);
    window.clearTimeout(bubbleTimer.current);
    window.clearTimeout(animationTimer.current);
    bubbleRemaining.current = candidate.kind.startsWith("startup-") ? 10_000 : 5_000;
    animationRemaining.current = 1_700;
    bubbleDeadline.current = Date.now() + bubbleRemaining.current;
    animationDeadline.current = Date.now() + animationRemaining.current;
    bubbleTimer.current = window.setTimeout(() => dismissMessage(), bubbleRemaining.current);
    animationTimer.current = window.setTimeout(() => { animationRemaining.current = 0; setAnimation("idle"); setFrame(0); }, animationRemaining.current);
  };

  useEffect(() => {
    if (priorScreen.current !== screen) { gate.current.clear(); dismissMessage(false); priorScreen.current = screen; }
  }, [screen]);
  useEffect(() => { if (fullscreen || screen === "opening" || screen === "player") { gate.current.clear(); dismissMessage(false); } }, [fullscreen, screen]);
  useEffect(() => {
    if (!event || lastEventId.current === event.id) return;
    if (hidden) return;
    lastEventId.current = event.id;
    if (!enabled || fullscreen || screen === "opening" || screen === "player") return;
    const accepted = gate.current.accept(event, frequency, Date.now());
    if (accepted) show(accepted);
  }, [event, enabled, frequency, hidden, fullscreen, screen]);
  useEffect(() => {
    if (!enabled) { gate.current.clear(); dismissMessage(false); }
  }, [enabled]);
  useEffect(() => {
    const ticker = window.setInterval(() => {
      if (document.hidden || !enabled || fullscreen || screen === "opening" || screen === "player" || activeEventRef.current?.kind.startsWith("startup-")) return;
      const next = gate.current.next(frequency, Date.now());
      if (next) show(next);
    }, 1_000);
    return () => window.clearInterval(ticker);
  }, [enabled, frequency, fullscreen, screen]);
  useEffect(() => {
    if (hidden || reduced || !enabled) { setFrame(0); return; }
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % COMPANION_ANIMATIONS[animation].frames), 140);
    return () => window.clearInterval(timer);
  }, [animation, hidden, reduced, enabled]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media?.matches ?? false);
    document.addEventListener("visibilitychange", visibility);
    media?.addEventListener("change", motion);
    return () => { document.removeEventListener("visibilitychange", visibility); media?.removeEventListener("change", motion); };
  }, []);
  useEffect(() => {
    if (hidden) {
      bubbleRemaining.current = bubbleRemaining.current ? Math.max(0, bubbleDeadline.current - Date.now()) : 0;
      animationRemaining.current = animationRemaining.current ? Math.max(0, animationDeadline.current - Date.now()) : 0;
      window.clearTimeout(bubbleTimer.current);
      window.clearTimeout(animationTimer.current);
      return;
    }
    if (bubbleRemaining.current) {
      bubbleDeadline.current = Date.now() + bubbleRemaining.current;
      bubbleTimer.current = window.setTimeout(() => dismissMessage(), bubbleRemaining.current);
    }
    if (animationRemaining.current) {
      animationDeadline.current = Date.now() + animationRemaining.current;
      animationTimer.current = window.setTimeout(() => { animationRemaining.current = 0; setAnimation("idle"); setFrame(0); }, animationRemaining.current);
    }
  }, [hidden]);
  useEffect(() => () => { window.clearTimeout(bubbleTimer.current); window.clearTimeout(animationTimer.current); }, []);
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".page");
    const measure = () => {
      const rect = page?.getBoundingClientRect();
      const fallback = initialBounds();
      const footer = page?.querySelector<HTMLElement>(".site-footer")?.getBoundingClientRect();
      const next = rect && rect.width > 0 && rect.height > 0 ? {
        left: rect.left + 8, top: rect.top + 8, right: rect.right - 8,
        bottom: Math.min(rect.bottom - 8, footer && footer.top > rect.top ? footer.top - 8 : rect.bottom - 8)
      } : fallback;
      setBounds(next);
      if (!drag.current) moveTo(positionFromHome(home, next, dockedPlayer && corner.endsWith("left"), size));
    };
    page?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => { page?.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [screen, corner, dockedPlayer, home?.x, home?.y, companionSize]);

  useEffect(() => {
    if (!enabled || !wander || hidden || reduced || dragging || line || fullscreen || screen === "opening" || screen === "player" || bounds.bottom - bounds.top < size.height + 12) return;
    let timeout: number | undefined, frameId: number | undefined, stopped = false;
    const homePoint = positionFromHome(home, bounds, dockedPlayer && corner.endsWith("left"), size);
    const obstacles = (): Obstacle[] => {
      const page = document.querySelector<HTMLElement>(".page");
      const elements = [...(page?.querySelectorAll<HTMLElement>("button, input, select, textarea, a, [role='button']") ?? [])];
      const mini = document.querySelector<HTMLElement>(".player-shell.is-docked");
      if (mini) elements.push(mini);
      return elements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }));
    };
    const travel = (target: Point, finished: () => void) => {
      let previous = 0;
      const step = (now: number) => {
        if (stopped) return;
        const current = positionRef.current;
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        if (distance < 1) { moveTo(target); setAnimation("idle"); finished(); return; }
        const amount = Math.min(distance, Math.min(32, previous ? now - previous : 16) * 0.055);
        previous = now;
        setAnimation(target.x >= current.x ? "run-right" : "run-left");
        moveTo({ x: current.x + (target.x - current.x) / distance * amount, y: current.y + (target.y - current.y) / distance * amount });
        frameId = window.requestAnimationFrame(step);
      };
      frameId = window.requestAnimationFrame(step);
    };
    const schedule = () => {
      timeout = window.setTimeout(() => {
        const target = wanderTarget(homePoint, bounds, obstacles(), Math.random, size);
        if (!target) { schedule(); return; }
        travel(target, () => { timeout = window.setTimeout(() => travel(homePoint, schedule), 3_000 + Math.random() * 5_000); });
      }, 8_000 + Math.random() * 7_000);
    };
    schedule();
    return () => { stopped = true; window.clearTimeout(timeout); if (frameId !== undefined) window.cancelAnimationFrame(frameId); setAnimation((current) => current.startsWith("run-") ? "idle" : current); };
  }, [enabled, wander, hidden, reduced, dragging, line, fullscreen, screen, bounds.left, bounds.top, bounds.right, bounds.bottom, home?.x, home?.y, corner, dockedPlayer, companionSize]);

  const finishDrag = (pointerId: number) => {
    const current = drag.current;
    if (!current || current.pointerId !== pointerId) return;
    drag.current = undefined;
    setDragging(false);
    if (current.moved) {
      suppressClick.current = true;
      setAnimation("idle");
      onHomeChange?.(homeFromPosition(positionRef.current, bounds, size));
    }
  };
  const talk = () => { const hello = gate.current.accept({ id: Date.now(), kind: "hello" }, frequency, Date.now()); if (hello) show(hello); };
  if (!enabled || hidden || fullscreen || screen === "opening" || screen === "player" || bounds.bottom - bounds.top < size.height + 12) return null;
  const { x, y } = companionFrame(animation, frame);
  const image = customSelected ? customImage! : companionImageUrl(builtInId, import.meta.env.BASE_URL);
  const sprite = { width: size.width, height: size.height, backgroundImage: `url(${image})`, backgroundSize: `${768 * scale}px ${936 * scale}px`, backgroundPosition: `${-x / 2 * scale}px ${-y / 2 * scale}px` };
  const actionable = activeEvent?.kind === "startup-update" || activeEvent?.kind === "startup-continue";
  const bubbleLeft = Math.max(8 - position.x, Math.min(0, window.innerWidth - position.x - (actionable ? 288 : 248)));
  return <aside className="watch-companion" style={{ left: position.x, top: position.y, width: size.width, height: size.height }} aria-label={`${pet.name} watch companion`}>
    {line && <div className={`companion-bubble${actionable ? " has-action" : ""}`} style={position.y < size.height + 56 ? { left: bubbleLeft, top: size.height + 4, bottom: "auto" } : { left: bubbleLeft, bottom: size.height + 4 }} role="status"><span>{line}</span>
      {actionable && activeEvent && <button type="button" className="companion-action" onClick={() => { onMessageAction?.(activeEvent); dismissMessage(false); }}>{activeEvent.kind === "startup-update" ? "View episode" : "Continue"}</button>}
      <button type="button" aria-label="Dismiss companion message" onClick={() => dismissMessage()}>×</button></div>}
    <button type="button" className="companion-pet" style={sprite} title={`Talk to or drag ${pet.name}`} aria-label={`Talk to or drag ${pet.name}`}
      onPointerDown={(pointer) => { if (pointer.button !== 0) return; drag.current = { pointerId: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, origin: positionRef.current, moved: false }; pointer.currentTarget.setPointerCapture?.(pointer.pointerId); setDragging(true); }}
      onPointerMove={(pointer) => { const current = drag.current; if (!current || pointer.pointerId !== current.pointerId) return; const dx = pointer.clientX - current.x, dy = pointer.clientY - current.y; if (Math.hypot(dx, dy) < 6 && !current.moved) return; current.moved = true; moveTo(clampPoint({ x: current.origin.x + dx, y: current.origin.y + dy }, bounds, size)); setAnimation(dx >= 0 ? "run-right" : "run-left"); }}
      onPointerUp={(pointer) => finishDrag(pointer.pointerId)} onPointerCancel={(pointer) => finishDrag(pointer.pointerId)}
      onKeyDown={(key) => { const amount = key.shiftKey ? 32 : 16; const offset = key.key === "ArrowLeft" ? [-amount, 0] : key.key === "ArrowRight" ? [amount, 0] : key.key === "ArrowUp" ? [0, -amount] : key.key === "ArrowDown" ? [0, amount] : undefined; if (!offset) return; key.preventDefault(); const next = clampPoint({ x: positionRef.current.x + offset[0], y: positionRef.current.y + offset[1] }, bounds, size); moveTo(next); onHomeChange?.(homeFromPosition(next, bounds, size)); }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } talk(); }} />
  </aside>;
}
