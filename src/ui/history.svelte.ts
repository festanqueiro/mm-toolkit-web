/** History tab signals shared by every tool (spec 07 "Completion signals"). */

export const historyUi = $state({
  /** Finished jobs not yet seen in the History tab. */
  unread: 0,
  /** The job History selects when opened (the latest finished one, or one picked elsewhere). */
  selectedId: null as string | null,
  /** Bumped whenever a record is added, so an open History tab reloads. */
  revision: 0,
});

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

const onHistoryTab = () => location.hash.replace(/^#\/?/, "").startsWith("history");

/** A tool recorded a finished job: select it, and count it as unread unless History is open. */
export function jobRecorded(id: string): void {
  historyUi.selectedId = id;
  historyUi.revision++;
  if (onHistoryTab()) return;
  historyUi.unread++;
  void (navigator as BadgeNavigator).setAppBadge?.(historyUi.unread).catch(() => {});
}

/** History was opened: everything is seen. */
export function historySeen(): void {
  historyUi.unread = 0;
  void (navigator as BadgeNavigator).clearAppBadge?.().catch(() => {});
}

/** Open History with `id` selected (the progress label link). */
export function openHistory(id?: string | null): void {
  if (id) historyUi.selectedId = id;
  location.hash = "#/history";
}
