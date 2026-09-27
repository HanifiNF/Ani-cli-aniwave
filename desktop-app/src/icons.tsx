import type { SVGProps } from "react";

/** Line icons drawn in the current text colour: one set on a 24px grid with a 1.8 stroke and round caps and joins. Sized by CSS, which keeps the line at the same screen weight at every size. */
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  home: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" />,
  browse: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z" /></>,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9zM10 21h4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  play: <path d="M8 5.5v13l11-6.5z" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 19.3 3 5.4 5.4 0 0 0 19.1-.1S17.9-.5 15 1.5a13.4 13.4 0 0 0-6 0C6.1-.5 4.9-.1 4.9-.1A5.4 5.4 0 0 0 4.7 3a5.8 5.8 0 0 0-1.5 4.1c0 5.8 3.5 7 6.8 7.4A4.8 4.8 0 0 0 9 18v4" /><path d="M9 19c-3 .9-3-1.5-4.2-2" /></>,
  discord: <><path d="M8.4 7.2A9.8 9.8 0 0 1 12 6.5a9.8 9.8 0 0 1 3.6.7M7.1 17.2c3.4 1.7 6.4 1.7 9.8 0" /><path d="M7.8 4.8A14 14 0 0 0 4.3 16a10 10 0 0 0 3.5 2.2l.9-1.3M16.2 4.8A14 14 0 0 1 19.7 16a10 10 0 0 1-3.5 2.2l-.9-1.3" /><circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  // The player's controls. Seek and replay are one arc on a circle of radius 8; the arrowhead's point sits on the arc's
  // end, its arms 40° either side of the way the arc runs.
  replay: <><path d="M4.27 14.07A8 8 0 1 0 6.34 6.34" /><path d="M9.53 6.06 6.34 6.34 6.62 3.16" /></>,
  seekBack: <><path d="M4.27 14.07A8 8 0 1 0 6.34 6.34" /><path d="M9.53 6.06 6.34 6.34 6.62 3.16" /><path d="M10 9.5v5" /><rect x="12.5" y="9.5" width="3" height="5" rx="1.5" /></>,
  seekForward: <><path d="M19.73 14.07A8 8 0 1 1 17.66 6.34" /><path d="M14.47 6.06 17.66 6.34 17.38 3.16" /><path d="M9.5 9.5v5" /><rect x="12" y="9.5" width="3" height="5" rx="1.5" /></>,
  volumeHigh: <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />,
  volumeLow: <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5" />,
  mute: <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 10l4 4M20 10l-4 4" />,
  captions: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10.5 10.2a2 2 0 1 0 0 3.6M17 10.2a2 2 0 1 0 0 3.6" /></>,
  captionsOff: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10.5 10.2a2 2 0 1 0 0 3.6M17 10.2a2 2 0 1 0 0 3.6M4 20 20 4" /></>,
  pipEnter: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><rect x="12" y="12" width="6" height="4" rx="1" /></>,
  pipExit: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M8 9l4.5 4.5M8 13V9h4" /></>,
  fullscreen: <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />,
  fullscreenExit: <path d="M9 4v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M15 20v-3a2 2 0 0 1 2-2h3M4 15h3a2 2 0 0 1 2 2v3" />,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8.5 14h7" /></>,
  accessibility: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5h.01M8 10.5l4 1 4-1M12 11.5v3l-2 3.5M12 14.5l2 3.5" /></>,
  audio: <path d="M4.5 11v2M8 8v8M11.5 5v14M15 8v8M18.5 10.5v3" />,
  chapters: <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" />,
  speed: <path d="M4.3 16.5a8.5 8.5 0 1 1 15.4 0M12 15l3.5-4.5" />,
  quality: <><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></>,
  fontUp: <path d="M4 18.5 8.5 6h1L14 18.5M5.6 14h6.8M17.5 7v6M14.5 10h6" />,
  fontDown: <path d="M4 18.5 8.5 6h1L14 18.5M5.6 14h6.8M14.5 10h6" />,
  opacityUp: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M12 7.5h5.5M12 12h8.5M12 16.5h5.5" /></>,
  opacityDown: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M12 9.75h4M12 14.25h4" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  airplay: <path d="M6 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1M12 15l4 5H8z" />,
  cast: <path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4M3 20h.01" />
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon icon-${name} ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

/** The same glyph for a component that sizes it itself (Vidstack's layout): no app sizing, props passed through. */
export function Glyph({ name, className, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} className={`glyph ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
