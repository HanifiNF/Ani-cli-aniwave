import { MINI_PLAYER_WIDTH, type PersistedState, type Settings } from "./contracts";
import { THEME_PRESETS } from "./theme";
import { enabledProviders } from "./catalog";

export const DEFAULT_STATE: PersistedState = {
  bookmarks: [],
  history: [],
  providerLinks: [],
  dismissedMergeKeys: [],
  settings: {
    playerPath: "",
    playbackTarget: "builtin",
    startPlayerFullscreen: true,
    autoplayNext: true,
    miniPlayerCorner: "bottom-right",
    miniPlayerWidth: MINI_PLAYER_WIDTH.default,
    playerDiagnostics: false,
    preferredQuality: "best",
    preferredMode: "sub",
    preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru",
    anidbBaseUrl: "https://anidb.app",
    hianimeBaseUrl: "https://hianimes.se",
    theme: "graphite",
    customTheme: { ...THEME_PRESETS.graphite }
  }
};

type SourceAddresses = Pick<Settings, "aniwaveBaseUrl" | "anidbBaseUrl" | "hianimeBaseUrl">;
export const catalogScope = (settings: SourceAddresses): string => JSON.stringify([settings.aniwaveBaseUrl, settings.anidbBaseUrl, settings.hianimeBaseUrl]);
export const sourceSettingsKey = (settings: SourceAddresses & Pick<Settings, "disabledSources">): string => JSON.stringify([catalogScope(settings), enabledProviders(settings)]);

export const PLAYBACK_QUALITIES: readonly string[] = ["best", "1080p", "720p", "480p", "360p"];
