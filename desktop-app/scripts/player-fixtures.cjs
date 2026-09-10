const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

exports.generateFixtures = (directory) => {
  for (const [name, size] of [['wide', '320x180'], ['low', '160x90'], ['classic', '240x180'], ['portrait', '180x320']]) {
    const target = join(directory, name);
    mkdirSync(target, { recursive: true });
    // Synthetic, silent media: no external hosts or user viewing history.
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=12`,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '32', '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'baseline',
      '-pix_fmt', 'yuv420p', '-b:v', '120k', '-g', '48', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '32k', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
      '-hls_segment_type', 'fmp4', '-hls_segment_filename', join(target, 'segment%02d.m4s'),
      join(target, 'index.m3u8')]);
  }
  writeFileSync(join(directory, 'captions.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:32.000\nPlayer integration caption\n');
  writeFileSync(join(directory, 'captions.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:32\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:32,\ncaptions.vtt\n#EXT-X-ENDLIST\n');
  writeFileSync(join(directory, 'master.m3u8'), '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=YES,URI="captions.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=180000,RESOLUTION=320x180,SUBTITLES="subs"\nwide/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=90000,RESOLUTION=160x90,SUBTITLES="subs"\nlow/index.m3u8\n');
};
