import type { PathNetwork, WorldTransform } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SnapGuide } from '../snap/snap-guide.js';

import { networkOverlayRects } from './network-overlay.js';
import { vertexOf } from './network.js';
import type { PenChain } from './pen-gesture.js';

/** What the pen shows at one moment. */
export interface PenOverlayState {
  /** The network as the press under way leaves it, or the pen's working network. */
  readonly network: PathNetwork;
  /** The path's frame in the world. */
  readonly frame: WorldTransform;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** The chain being drawn. */
  readonly chain: PenChain;
  /** The vertex a press under way pulls the handles of, if any. */
  readonly dragVertexId: string | undefined;
  /** The pointer with no button down, local units: the next segment's preview end. */
  readonly hover: Point | undefined;
  /** The snap guides of the last press. */
  readonly guides: readonly SnapGuide[];
}

/**
 * The pen's overlay (the prototype's `PenMode.renderOverlay`): the network's skeleton and
 * vertices, the chain's vertex and the vertex being dragged selected, the outgoing handle, and
 * the next segment from the chain's vertex to the pointer. Pure.
 *
 * @param state - What the pen shows.
 * @returns The overlay model.
 */
export function penOverlay(state: PenOverlayState): Partial<SelectionOverlayModel> {
  const { network, chain } = state;
  const anchorId = state.dragVertexId ?? chain.vertexId;
  const selected = new Set([anchorId, chain.vertexId].filter((id) => id !== undefined));
  const anchor = anchorId === undefined ? undefined : vertexOf(network, anchorId);
  const from = chain.vertexId === undefined ? undefined : vertexOf(network, chain.vertexId);
  const { outHandle } = chain;
  const { hover } = state;
  const previewSegment =
    from && hover
      ? ([from, { x: from.x + outHandle.x, y: from.y + outHandle.y }, hover, hover] as const)
      : undefined;
  return {
    frame: undefined,
    outlines: [],
    canResize: false,
    guides: state.guides,
    toolRects: networkOverlayRects({
      network,
      frame: state.frame,
      zoom: state.zoom,
      selected,
      pendingHandle: anchor ? { from: anchor, handle: outHandle } : undefined,
      previewSegment,
    }),
  };
}
