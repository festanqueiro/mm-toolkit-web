import type { IconName } from "./icons";

export type Route = {
  path: string;
  label: string;
  icon: IconName;
  subtitle: string;
};

/** Tabs in desktop order (spec 09). */
export const routes: readonly Route[] = [
  {
    path: "video-creator",
    label: "Video Creator",
    icon: "music_video",
    subtitle: "Turn audio plus an image or video into a new music video at the visual's native resolution.",
  },
  {
    path: "cutter",
    label: "Media Cutter",
    icon: "content_cut",
    subtitle:
      "Cut audio or video into precisely timed clips. Use HH:MM:SS, MM:SS, or seconds. End is optional; duration defaults to 60 seconds.",
  },
  {
    path: "converter",
    label: "Media Converter",
    icon: "swap_horiz",
    subtitle: "Convert batches of audio or video files into another common format.",
  },
  {
    path: "stems",
    label: "Stem Splitter",
    icon: "graphic_eq",
    subtitle: "Split a song into vocals, drums, bass and other instruments. Everything runs on this device.",
  },
  { path: "history", label: "History", icon: "history", subtitle: "Recent jobs are stored only in this browser." },
  { path: "settings", label: "Settings", icon: "settings", subtitle: "Defaults shared by all Media Tools features." },
  { path: "about", label: "About", icon: "info", subtitle: "" },
];

export const DEFAULT_ROUTE = routes[0]!;

export function routeFromHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  return routes.find((route) => route.path === path) ?? DEFAULT_ROUTE;
}
