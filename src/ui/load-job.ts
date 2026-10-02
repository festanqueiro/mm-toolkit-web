/** Load Job (spec 07): restore a History record's tool form and switch to its tab. */
import { TOOL_ROUTES, type HistoryTool } from "../engine/history";
import { converter } from "./tabs/converter/state.svelte";
import { cutter } from "./tabs/cutter/state.svelte";
import { vc } from "./tabs/video-creator/state.svelte";

export function loadJob(record: { tool: HistoryTool } & Record<string, unknown>): void {
  if (record.tool === "promo") vc.loadFromHistory(record);
  else if (record.tool === "clips") cutter.loadFromHistory(record);
  else if (record.tool === "converter") converter.loadFromHistory(record);
  else return;
  location.hash = `#/${TOOL_ROUTES[record.tool]}`;
}
