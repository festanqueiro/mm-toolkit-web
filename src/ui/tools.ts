/** The tools as Home shows them (spec 09 "Home"): what each one does, in plain words. */
import type { IconName } from "./icons";

export type ToolCard = { path: string; title: string; icon: IconName; summary: string; features: string[] };

export const TOOL_CARDS: readonly ToolCard[] = [
  {
    path: "video-creator",
    title: "Video Creator",
    icon: "music_video",
    summary: "Turn a track and a picture or video clip into a promo video, ready to post.",
    features: [
      "Finds the drop for you and starts the snippet there",
      "Bass-reactive blur, rotate, VHS, glitch and overlay effects",
      "Vertical, square or landscape MP4 with fades",
      "A whole folder of tracks in one go",
    ],
  },
  {
    path: "cutter",
    title: "Media Cutter",
    icon: "content_cut",
    summary: "Cut precise clips out of audio or video by timestamp.",
    features: [
      "Set start and end from the player, or type the times",
      "Several clips from one file in one go",
      "Keeps the source's format (or MP4 for video)",
      "Previews files your browser can't play: waveform or frames",
    ],
  },
  {
    path: "converter",
    title: "Media Converter",
    icon: "swap_horiz",
    summary: "Convert batches of audio or video into another common format.",
    features: [
      "Audio: MP3, WAV, AIFF, FLAC, M4A, AAC, OGG",
      "Video: MP4, MOV, MKV, WebM",
      "Pick the MP3 bitrate (128–320 kbps)",
      "Drop in a whole batch at once",
    ],
  },
  {
    path: "stems",
    title: "Stem Splitter",
    icon: "graphic_eq",
    summary: "Split a song into vocals, drums, bass and other instruments with AI.",
    features: [
      "Vocals + instrumental, or all four stems",
      "Runs the HT-Demucs model on your device (GPU when available)",
      "Exports each stem in the format you choose",
      "One-time 170 MB model download, then works offline",
    ],
  },
];
