import { useEffect, useRef, useState } from "react";
import { COMPANION_ANIMATIONS, COMPANION_REGISTRY, companionFrame, companionImageUrl, normalizeCompanionPreferences, type CompanionAnimation } from "../shared/companion";
import type { MiniPlayerCorner, Settings } from "../shared/contracts";
import { CompanionDialogueGate, companionLine, type CompanionEvent } from "./companion-dialogue";

interface Props {
  settings: Settings;
  screen: string;
  fullscreen: boolean;
  corner: MiniPlayerCorner;
  dockedPlayer: boolean;
  event?: CompanionEvent;
}

export default function WatchCompanion({ settings, screen, fullscreen, corner, dockedPlayer, event }: Props) {
  const { companionEnabled: enabled, companionPetId: id, companionFrequency: frequency } = normalizeCompanionPreferences(settings);
  const pet = COMPANION_REGISTRY[id];
  const gate = useRef(new CompanionDialogueGate());
  const priorScreen = useRef(screen);
  const lastEventId = useRef<number>(undefined);
  const [line, setLine] = useState<string>();
  const [animation, setAnimation] = useState<CompanionAnimation>("idle");
  const [frame, setFrame] = useState(0);
  const [footerVisible, setFooterVisible] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const animationTimer = useRef<number | undefined>(undefined);
  const bubbleRemaining = useRef(0);
  const animationRemaining = useRef(0);
  const bubbleDeadline = useRef(0);
  const animationDeadline = useRef(0);
  const lastLine = useRef("");
  const show = (candidate: CompanionEvent) => {
    const result = companionLine(candidate, companionLine(candidate).text === lastLine.current);
    lastLine.current = result.text;
    setLine(result.text);
    setAnimation(result.animation);
    setFrame(0);
    window.clearTimeout(bubbleTimer.current);
    window.clearTimeout(animationTimer.current);
    bubbleRemaining.current = 5_000;
    animationRemaining.current = 1_700;
    bubbleDeadline.current = Date.now() + bubbleRemaining.current;
    animationDeadline.current = Date.now() + animationRemaining.current;
    bubbleTimer.current = window.setTimeout(() => { bubbleRemaining.current = 0; setLine(undefined); }, bubbleRemaining.current);
    animationTimer.current = window.setTimeout(() => { animationRemaining.current = 0; setAnimation("idle"); setFrame(0); }, animationRemaining.current);
  };

  useEffect(() => {
    if (priorScreen.current !== screen) { gate.current.clear(); setLine(undefined); priorScreen.current = screen; }
  }, [screen]);
  useEffect(() => { if (fullscreen || screen === "opening") { gate.current.clear(); setLine(undefined); } }, [fullscreen, screen]);
  useEffect(() => {
    if (!event || lastEventId.current === event.id) return;
    lastEventId.current = event.id;
    if (!enabled || hidden || fullscreen || screen === "opening") return;
    const accepted = gate.current.accept(event, frequency, Date.now());
    if (accepted) show(accepted);
  }, [event, enabled, frequency, hidden, fullscreen, screen]);
  useEffect(() => {
    if (!enabled) { gate.current.clear(); setLine(undefined); }
  }, [enabled]);
  useEffect(() => {
    const ticker = window.setInterval(() => {
      if (document.hidden || !enabled || fullscreen || screen === "opening") return;
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
      bubbleTimer.current = window.setTimeout(() => { bubbleRemaining.current = 0; setLine(undefined); }, bubbleRemaining.current);
    }
    if (animationRemaining.current) {
      animationDeadline.current = Date.now() + animationRemaining.current;
      animationTimer.current = window.setTimeout(() => { animationRemaining.current = 0; setAnimation("idle"); setFrame(0); }, animationRemaining.current);
    }
  }, [hidden]);
  useEffect(() => () => { window.clearTimeout(bubbleTimer.current); window.clearTimeout(animationTimer.current); }, []);
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".page");
    if (!page) return;
    const update = () => {
      const footer = page.querySelector<HTMLElement>(".site-footer");
      setFooterVisible(Boolean(footer && footer.getBoundingClientRect().top < window.innerHeight - 132));
    };
    page.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => { page.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [screen]);

  if (!enabled || hidden || fullscreen || screen === "opening" || footerVisible) return null;
  const player = screen === "player";
  const side = dockedPlayer && corner.endsWith("left") ? "right" : "left";
  const { x, y } = companionFrame(animation, frame);
  const sprite = { backgroundImage: `url(${companionImageUrl(id, import.meta.env.BASE_URL)})`, backgroundPosition: `${-x / 2}px ${-y / 2}px` };
  return <aside className={`watch-companion ${player ? "in-player" : "in-page"} side-${side}`} aria-label={`${pet.name} watch companion`}>
    {line && <div className="companion-bubble" role="status"><span>{line}</span><button type="button" aria-label="Dismiss companion message" onClick={() => setLine(undefined)}>×</button></div>}
    <button type="button" className="companion-pet" style={sprite} title={`Talk to ${pet.name}`} aria-label={`Talk to ${pet.name}`}
      onClick={() => { const hello = gate.current.accept({ id: Date.now(), kind: "hello" }, frequency, Date.now()); if (hello) show(hello); }} />
  </aside>;
}
