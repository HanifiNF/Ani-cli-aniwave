import { useEffect, useState } from "react";

export default function Art({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`art ${className ?? ""}`}>
      {src && !failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  );
}

