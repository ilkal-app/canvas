import { useSyncExternalStore, type ReactElement } from 'react';

import { worldToScreen } from '@canvas/engine';

import { avatarColorsOf } from '../collab/avatar-colors.js';
import type { BoardConnection } from '../collab/board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import type { CameraSource } from './camera-source.js';
import styles from './peer-selections.module.css';
import { usePeerSelections, useShareSelection } from './use-peer-selections.js';

/**
 * Subscribes to nothing: the layer stops following the camera while no peer selects.
 *
 * @returns A function that does nothing.
 */
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/** Props of {@link PeerSelections}. */
export interface PeerSelectionsProps {
  /** The board's connection: its presence says who selects what, and shares the person's. */
  readonly connection: BoardConnection | undefined;
  /** The engine, once it runs: it outlines the objects and holds the person's selection. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource;
}

/**
 * Collaborators' selections (item 14, as Figma shows them): the engine outlines each
 * object a peer selects in their presence colour (`PeerSelectionSurface`); this layer adds a tag
 * with their name on the selection's top-left corner, in the same colour, marked
 * `data-peer-selection` (the peer's awareness client id), `data-principal-id`,
 * `data-presence-color` and `data-selected-count`. It also shares the person's own selection as
 * ids (`useShareSelection`). Everything comes from presence and goes with it: a peer who
 * deselects, changes page, leaves or drops clears. It follows the camera only while a peer
 * selects. Page.
 *
 * @param props - The connection, engine and camera.
 * @returns The layer, or nothing while no peer selects.
 */
export function PeerSelections(props: PeerSelectionsProps): ReactElement | null {
  const { connection, engine, camera } = props;
  useShareSelection(connection, engine?.board);
  const placements = usePeerSelections(connection, engine);
  const view = useSyncExternalStore(
    placements.length > 0 ? camera.subscribe : NO_SUBSCRIPTION,
    camera.read,
  );
  if (placements.length === 0 || view === undefined) return null;
  return (
    <div className={styles.layer} data-peer-selections="">
      {placements.map((peer) => {
        const corner = worldToScreen(view, peer.frame);
        const { fill, ink } = avatarColorsOf(peer.color);
        return (
          <span
            key={peer.clientId}
            className={styles.tag}
            // The colour is data (the peer's presence colour), so it is set here.
            style={{ left: corner.x, top: corner.y, backgroundColor: fill }}
            data-ink={ink}
            data-peer-selection={peer.clientId}
            data-principal-id={peer.principalId}
            data-presence-color={peer.color}
            data-selected-count={peer.ids.length}
            aria-hidden="true"
          >
            {peer.name}
          </span>
        );
      })}
    </div>
  );
}
