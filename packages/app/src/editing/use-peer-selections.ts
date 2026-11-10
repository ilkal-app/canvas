import { useEffect, useSyncExternalStore } from 'react';

import { colorForPrincipal, type PresenceSnapshot } from '@canvas/collab';
import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import type { BoardView } from '../engine/board-view.js';
import type {
  PeerSelectionInput,
  PeerSelectionPlacement,
  PeerSelectionSurface,
} from '../engine/mount-peer-selection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

/** The most ids the person's selection shares: presence keeps no more (`setLocal`). */
export const MAX_SHARED_SELECTION = 1000;

const NO_PLACEMENTS: readonly PeerSelectionPlacement[] = Object.freeze([]);

function noUnsubscribe(): void {
  // Nothing was subscribed.
}

/**
 * What presence says each peer selects on the page shown (item 14), one entry per open
 * tab with a selection; a client of a build without pages shows the first page. A peer whose
 * only selected object is the text they edit is left to peer editing, whose outline
 * and "is editing" tag already show it. Pure.
 *
 * @param snapshot - The remote presence.
 * @param page - The page shown.
 * @param firstPage - The board's first page.
 * @returns The peers' selections, in the snapshot's order.
 */
export function peerSelectionsOf(
  snapshot: PresenceSnapshot,
  page: string,
  firstPage: string,
): PeerSelectionInput[] {
  const peers: PeerSelectionInput[] = [];
  for (const [clientId, state] of snapshot) {
    const { selection, principal, editing } = state;
    if (selection === undefined || selection.length === 0) continue;
    if ((state.page ?? firstPage) !== page) continue;
    if (selection.length === 1 && selection[0] === editing?.objectId) continue;
    peers.push({
      clientId,
      principalId: principal.id,
      name: principal.name,
      // Their colourway's dark, derived from their id as every view does.
      color: colorForPrincipal(principal.id),
      ids: selection,
    });
  }
  return peers;
}

/**
 * Shares which objects the person selects in presence (item 14): the board's selection
 * as ids (the first {@link MAX_SHARED_SELECTION}), `null` when nothing is selected, and `null`
 * once the shell lets go of the board. Ids only: what an object is or looks like never leaves
 * the document. Nothing is sent while the selection stays the same. Viewers share theirs too,
 * as their cursor.
 *
 * @param connection - The board's connection, which shares it.
 * @param board - The board view, once the engine runs.
 */
export function useShareSelection(
  connection: Pick<BoardConnection, 'showSelection'> | undefined,
  board: Pick<BoardView, 'state' | 'subscribe'> | undefined,
): void {
  useEffect(() => {
    const share = connection?.showSelection?.bind(connection);
    if (share === undefined || board === undefined) return undefined;
    let sent: readonly string[] | undefined;
    const update = (): void => {
      const ids = board.state().selectedIds;
      if (ids === sent) return;
      sent = ids;
      share(ids.length === 0 ? null : ids.slice(0, MAX_SHARED_SELECTION));
    };
    update();
    const stop = board.subscribe((change) => {
      if (change.kind === 'selection') update();
    });
    return () => {
      stop();
      if (sent !== undefined && sent.length > 0) share(null);
    };
  }, [connection, board]);
}

/**
 * The peers' selections on the board (item 14), shown by the engine
 * (`PeerSelectionSurface`) and placed for their name tags: shown again when presence says
 * something else or another page shows; the surface places them again itself whenever the board
 * changes or a drag moves a selected object (from the live document by id, never cached bounds),
 * and the tags follow its placements. With no peer selecting it follows nothing but presence.
 *
 * @param connection - The board's connection, whose presence says who selects what.
 * @param engine - The engine, once it runs: its peer selection and the page shown.
 * @returns The peers shown and where.
 */
export function usePeerSelections(
  connection: BoardConnection | undefined,
  engine: Pick<MountedEngine, 'peerSelection' | 'pages'> | undefined,
): readonly PeerSelectionPlacement[] {
  const surface: PeerSelectionSurface | undefined = engine?.peerSelection;
  const pages = engine?.pages;
  const page = useSyncExternalStore(
    (listener) => pages?.subscribe(listener) ?? noUnsubscribe,
    () => pages?.current() ?? DEFAULT_PAGE_ID,
  );
  const remote = connection?.remotePresence?.bind(connection);
  // Keyed by what presence says of selections, not the snapshot, which is new on every cursor
  // move.
  const key = useSyncExternalStore(
    (listener) => connection?.subscribe(listener) ?? noUnsubscribe,
    () =>
      remote === undefined
        ? '[]'
        : JSON.stringify(peerSelectionsOf(remote(), page, DEFAULT_PAGE_ID)),
  );
  useEffect(() => {
    if (surface === undefined) return undefined;
    surface.show(JSON.parse(key) as PeerSelectionInput[]);
    return () => {
      surface.show([]);
    };
  }, [key, surface]);
  return useSyncExternalStore(
    (listener) => surface?.subscribe(listener) ?? noUnsubscribe,
    () => surface?.placements() ?? NO_PLACEMENTS,
  );
}
