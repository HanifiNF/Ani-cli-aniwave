import type { DefaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import type { SVGProps } from "react";
import { Glyph, type IconName } from "./icons";

/** A Vidstack icon slot filled with a glyph from the app's one set. */
const glyph = (name: IconName) => {
  const Component = (props: SVGProps<SVGSVGElement>) => <Glyph {...props} name={name} />;
  Component.displayName = `PlayerGlyph(${name})`;
  return Component;
};

/**
  The full player's controls, menus, and key feedback drawn with the app's line icons instead of Vidstack's filled ones.
  Mockup: design/variants/player-icons.html.
*/
export const playerIcons: DefaultLayoutIcons = {
  AirPlayButton: { Default: glyph("airplay") },
  GoogleCastButton: { Default: glyph("cast") },
  PlayButton: { Play: glyph("play"), Pause: glyph("pause"), Replay: glyph("replay") },
  MuteButton: { Mute: glyph("mute"), VolumeLow: glyph("volumeLow"), VolumeHigh: glyph("volumeHigh") },
  CaptionButton: { On: glyph("captions"), Off: glyph("captionsOff") },
  PIPButton: { Enter: glyph("pipEnter"), Exit: glyph("pipExit") },
  FullscreenButton: { Enter: glyph("fullscreen"), Exit: glyph("fullscreenExit") },
  SeekButton: { Backward: glyph("seekBack"), Forward: glyph("seekForward") },
  DownloadButton: { Default: glyph("download") },
  Menu: {
    Accessibility: glyph("accessibility"),
    ArrowLeft: glyph("back"),
    ArrowRight: glyph("chevron"),
    Audio: glyph("audio"),
    AudioBoostUp: glyph("volumeHigh"),
    AudioBoostDown: glyph("volumeLow"),
    Chapters: glyph("chapters"),
    Captions: glyph("captions"),
    Playback: glyph("speed"),
    Settings: glyph("gear"),
    SpeedUp: glyph("speed"),
    SpeedDown: glyph("speed"),
    QualityUp: glyph("quality"),
    QualityDown: glyph("quality"),
    FontSizeUp: glyph("fontUp"),
    FontSizeDown: glyph("fontDown"),
    OpacityUp: glyph("opacityUp"),
    OpacityDown: glyph("opacityDown"),
    RadioCheck: glyph("check")
  },
  KeyboardDisplay: {
    Play: glyph("play"),
    Pause: glyph("pause"),
    Mute: glyph("mute"),
    VolumeUp: glyph("volumeHigh"),
    VolumeDown: glyph("volumeLow"),
    EnterFullscreen: glyph("fullscreen"),
    ExitFullscreen: glyph("fullscreenExit"),
    EnterPiP: glyph("pipEnter"),
    ExitPiP: glyph("pipExit"),
    CaptionsOn: glyph("captions"),
    CaptionsOff: glyph("captionsOff"),
    SeekForward: glyph("seekForward"),
    SeekBackward: glyph("seekBack")
  }
};
