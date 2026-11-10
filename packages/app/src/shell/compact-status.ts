import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import { isLoadingLiveBoard, shortConnectionLabel } from '../collab/connection-label.js';
import { presencePeopleOf, withoutPrincipal } from '../collab/presence-people.js';

/** The compact top bar's line while the live board loads (at mobile width). */
export const COMPACT_LOADING_LIVE_STATUS = 'Saved copy · Connecting';

/**
 * The line under the board's name in the compact top bar (the design's "Live · 3 here"),
 * where the presence bar's state has no room of its own: the connection's short label
 * (`shortConnectionLabel`: Live, Connecting, Offline, Reconnecting, …) and, when anyone else is
 * on the board, how many; "Saved copy · Connecting" while the live board loads (L1). The
 * signed-in person is not counted. Pure.
 *
 * @param status - The connection's status.
 * @param principalId - The signed-in person's principal id, left out of the count; none if absent.
 * @returns The line.
 */
export function compactStatusOf(
  status: BoardConnectionStatus,
  principalId: string | undefined,
): string {
  if (isLoadingLiveBoard(status)) return COMPACT_LOADING_LIVE_STATUS;
  const label = shortConnectionLabel(status);
  const here = withoutPrincipal(presencePeopleOf(status.collaborators), principalId).length;
  return here > 0 ? `${label} · ${String(here)} here` : label;
}
