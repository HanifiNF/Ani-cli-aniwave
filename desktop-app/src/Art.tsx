import { useEffect, useRef, useState } from "react";

type ArtState = "loading" | "loaded" | "failed";

/** Images already shown this session; they appear at once when a page comes back instead of fading in again. */
const shown = new Set<string>();

/** A poster that fades in the first time its image decodes, so new artwork settles instead of popping. */
export default function Art({ src, className }: { src?: string; className?: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<ArtState>(() => (src && shown.has(src) ? "loaded" : "loading"));
  // A cached image can finish before its load handler is attached, so the effect checks it directly.
  useEffect(() => {
    if (src && shown.has(src)) { setState("loaded"); return; }
    const ready = Boolean(image.current?.complete && image.current.naturalWidth > 0);
    if (ready && src) shown.add(src);
    setState(ready ? "loaded" : "loading");
  }, [src]);
  const loaded = () => { if (src) shown.add(src); setState("loaded"); };
  return (
    <span className={`art ${className ?? ""}`}>
      {src && state !== "failed" && <img ref={image} src={src} alt="" loading="lazy" className={state === "loaded" ? "in" : ""} onLoad={loaded} onError={() => setState("failed")} />}
    </span>
  );
}
