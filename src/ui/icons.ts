/** Google Material Icons (Apache-2.0), inlined so they inherit `currentColor`. */
import contentCut from "../../assets/material-icons/content_cut.svg?raw";
import deleteIcon from "../../assets/material-icons/delete.svg?raw";
import history from "../../assets/material-icons/history.svg?raw";
import info from "../../assets/material-icons/info.svg?raw";
import musicVideo from "../../assets/material-icons/music_video.svg?raw";
import notifications from "../../assets/material-icons/notifications.svg?raw";
import playArrow from "../../assets/material-icons/play_arrow.svg?raw";
import settings from "../../assets/material-icons/settings.svg?raw";
import stop from "../../assets/material-icons/stop.svg?raw";
import swapHoriz from "../../assets/material-icons/swap_horiz.svg?raw";

const withCurrentColor = (svg: string) => svg.replace("<svg ", '<svg fill="currentColor" aria-hidden="true" ');

export const icons = {
  content_cut: withCurrentColor(contentCut),
  delete: withCurrentColor(deleteIcon),
  history: withCurrentColor(history),
  info: withCurrentColor(info),
  music_video: withCurrentColor(musicVideo),
  notifications: withCurrentColor(notifications),
  play_arrow: withCurrentColor(playArrow),
  settings: withCurrentColor(settings),
  stop: withCurrentColor(stop),
  swap_horiz: withCurrentColor(swapHoriz),
} as const;

export type IconName = keyof typeof icons;
