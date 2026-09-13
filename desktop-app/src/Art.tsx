import { useEffect, useRef, useState } from "react";

type ArtState = "loading" | "loaded" | "failed";

/** A poster that fades in once its image has decoded, so artwork settles instead of popping. */
export default function Art({ src, className }: { src?: string; className?: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<ArtState>("loading");
  // A cached image can finish before its load handler is attached, so the effect checks it directly.
  useEffect(() => { setState(image.current?.complete && image.current.naturalWidth > 0 ? "loaded" : "loading"); }, [src]);
  return (
    <span className={`art ${className ?? ""}`}>
      {src && state !== "failed" && <img ref={image} src={src} alt="" loading="lazy" className={state === "loaded" ? "in" : ""} onLoad={() => setState("loaded")} onError={() => setState("failed")} />}
    </span>
  );
}
