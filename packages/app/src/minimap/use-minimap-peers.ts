import { useMemo } from 'react';

import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { BoardConnection, ConnectionStatusSource } from '../collab/board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import type { MinimapPeers } from './minimap.js';

/**
 * The collaborators a minimap draws the views of: the connection's remote presence and
 * its changes, and the page the engine shows.
 *
 * @param connection - The board's connection; none without presence.
 * @param engine - The engine, for the page shown; the first page without one.
 * @returns The peers, or undefined on a board without presence.
 */
export function useMinimapPeers(
  connection:
    (ConnectionStatusSource & Partial<Pick<BoardConnection, 'remotePresence'>>) | undefined,
  engine: Pick<MountedEngine, 'pages'> | undefined,
): MinimapPeers | undefined {
  return useMemo(() => {
    const presence = connection?.remotePresence?.bind(connection);
    if (connection === undefined || presence === undefined) return undefined;
    return {
      remotePresence: presence,
      subscribe: (listener) => connection.subscribe(listener),
      pageOf: () => engine?.pages?.current() ?? DEFAULT_PAGE_ID,
    };
  }, [connection, engine]);
}
