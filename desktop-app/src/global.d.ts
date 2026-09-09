import type { AniDesktopApi, AniPlayerApi } from "../shared/contracts";

declare global {
  interface Window {
    aniDesktop: AniDesktopApi;
    aniPlayer: AniPlayerApi;
  }
}

export {};
