/** Google Material Icons (Apache-2.0), inlined so they inherit `currentColor`. */
import add from "../../assets/material-icons/add.svg?raw";
import audiotrack from "../../assets/material-icons/audiotrack.svg?raw";
import contentCut from "../../assets/material-icons/content_cut.svg?raw";
import deleteIcon from "../../assets/material-icons/delete.svg?raw";
import dragIndicator from "../../assets/material-icons/drag_indicator.svg?raw";
import expandMore from "../../assets/material-icons/expand_more.svg?raw";
import folderOpen from "../../assets/material-icons/folder_open.svg?raw";
import history from "../../assets/material-icons/history.svg?raw";
import image from "../../assets/material-icons/image.svg?raw";
import info from "../../assets/material-icons/info.svg?raw";
import lock from "../../assets/material-icons/lock.svg?raw";
import movie from "../../assets/material-icons/movie.svg?raw";
import musicVideo from "../../assets/material-icons/music_video.svg?raw";
import notifications from "../../assets/material-icons/notifications.svg?raw";
import pause from "../../assets/material-icons/pause.svg?raw";
import playArrow from "../../assets/material-icons/play_arrow.svg?raw";
import settings from "../../assets/material-icons/settings.svg?raw";
import stop from "../../assets/material-icons/stop.svg?raw";
import swapHoriz from "../../assets/material-icons/swap_horiz.svg?raw";

const withCurrentColor = (svg: string) => svg.replace("<svg ", '<svg fill="currentColor" aria-hidden="true" ');

export const icons = {
  add: withCurrentColor(add),
  audiotrack: withCurrentColor(audiotrack),
  content_cut: withCurrentColor(contentCut),
  delete: withCurrentColor(deleteIcon),
  drag_indicator: withCurrentColor(dragIndicator),
  expand_more: withCurrentColor(expandMore),
  folder_open: withCurrentColor(folderOpen),
  history: withCurrentColor(history),
  image: withCurrentColor(image),
  info: withCurrentColor(info),
  lock: withCurrentColor(lock),
  movie: withCurrentColor(movie),
  music_video: withCurrentColor(musicVideo),
  notifications: withCurrentColor(notifications),
  pause: withCurrentColor(pause),
  play_arrow: withCurrentColor(playArrow),
  settings: withCurrentColor(settings),
  stop: withCurrentColor(stop),
  swap_horiz: withCurrentColor(swapHoriz),
} as const;

export type IconName = keyof typeof icons;
