import { useEffect, useState, useSyncExternalStore } from 'react';

import type { CollaboratorSummary } from '../collab/board-connection-status.js';
import type { BoardConnection } from '../collab/board-connection.js';
import type { PeerEditingPlacement, PeerEditingSurface } from '../engine/mount-peer-editing.js';

import type { PeerEditingInput } from './peer-editing-geometry.js';
import type { TextEditingFeed } from './text-editing-feed.js';

const NO_PLACEMENTS: readonly PeerEditingPlacement[] = Object.freeze([]);

const NO_COLLABORATORS: readonly CollaboratorSummary[] = Object.freeze([]);

function noUnsubscribe(): void {
  // Nothing was subscribed.
}

/**
 * What presence says each collaborator edits, in the status's order (by principal id). Pure.
 *
 * @param collaborators - Who is on the board.
 * @returns One entry per collaborator editing a text.
 */
export function peersEditingOf(collaborators: readonly CollaboratorSummary[]): PeerEditingInput[] {
  return collaborators.flatMap(({ principalId, name, color, editing }) =>
    editing === undefined ? [] : [{ principalId, name, color, ...editing }],
  );
}

/**
 * Shares where the person edits text in presence: the spot the engine publishes,
 * while the page has the focus and the person may edit the board; `null` once editing ends
 * (Escape, a click elsewhere), the page loses the focus, or the shell lets go of the board. A
 * person who may not edit (a viewer, a commenter) shares nothing, whatever the engine reports;
 * the relay drops such a claim too. Nothing is sent while nothing changes.
 *
 * @param feed - The person's editing spot (`PeerEditingSurface.local`), once the engine runs.
 * @param connection - The board's connection, which shares it.
 * @param canEdit - Whether the person may edit the board.
 */
export function useShareEditing(
  feed: TextEditingFeed | undefined,
  connection: BoardConnection | undefined,
  canEdit: boolean,
): void {
  useEffect(() => {
    const share = connection?.showEditing?.bind(connection);
    if (feed === undefined || share === undefined || !canEdit) return undefined;
    let isFocused = typeof document === 'undefined' || document.hasFocus();
    let sent: ReturnType<TextEditingFeed['snapshot']> | null = null;
    const update = (): void => {
      const spot = isFocused ? (feed.snapshot() ?? null) : null;
      if (spot === sent) return;
      sent = spot;
      share(spot);
    };
    const focus = (isNowFocused: boolean) => () => {
      isFocused = isNowFocused;
      update();
    };
    const onFocus = focus(true);
    const onBlur = focus(false);
    update();
    const stop = feed.subscribe(update);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      stop();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      if (sent !== null) share(null);
    };
  }, [feed, connection, canEdit]);
}

/**
 * The peers editing text on the board, shown by the engine (`PeerEditingSurface`)
 * and placed for their name tags: worked out again when presence says something else, and,
 * while any peer edits, when the board changes (the text moved, grew or was typed into). With
 * no peer editing it follows nothing but the connection's status.
 *
 * @param connection - The board's connection, whose presence says who edits what.
 * @param surface - The engine's peer editing, once it runs.
 * @returns The peers shown and where.
 */
export function usePeerEditing(
  connection: BoardConnection | undefined,
  surface: PeerEditingSurface | undefined,
): readonly PeerEditingPlacement[] {
  const status = useSyncExternalStore(
    (listener) => connection?.subscribe(listener) ?? noUnsubscribe,
    () => connection?.status(),
  );
  // Keyed by what presence says of editing, not the array, which is new on every cursor move.
  const key = JSON.stringify(peersEditingOf(status?.collaborators ?? NO_COLLABORATORS));
  const [placements, setPlacements] = useState(NO_PLACEMENTS);
  useEffect(() => {
    if (surface === undefined) return undefined;
    const peers = JSON.parse(key) as PeerEditingInput[];
    const place = (): void => {
      setPlacements(surface.show(peers));
    };
    place();
    const stop = peers.length === 0 ? undefined : connection?.store.subscribe(place);
    return () => {
      stop?.();
      surface.show([]);
      setPlacements(NO_PLACEMENTS);
    };
  }, [key, surface, connection]);
  return placements;
}
