import type { AniDesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    aniDesktop: AniDesktopApi;
  }
}

export {};
