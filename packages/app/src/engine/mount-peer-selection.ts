import type { PeerSelectionOutline, WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import {
  boxCornersOf,
  selectionBoxOf,
  selectionFrameOf,
  type OrientedBox,
  type SelectionSource,
} from '@canvas/tools';

import { rgbaOfHex } from '../editing/peer-editing-geometry.js';

import type { EngineDocument } from './engine-document.js';
import type { HostLayers } from './host-layers.js';
import { PEER_SELECTION_LAYER } from './shell-overlay.js';

/**
 * Up to this many selected objects a peer's frame is worked out from each object's own box;
 * past it, from the spatial index's bounds, so a peer selecting a whole board costs one lookup
 * per object, not every object's geometry.
 */
export const MAX_OUTLINED_PER_PEER = 100;

/** What presence says one peer selects (item 14). */
export interface PeerSelectionInput {
  /** The peer's awareness client id: one selection per open tab. */
  readonly clientId: number;
  /** The peer's principal id. */
  readonly principalId: string;
  /** The name their tag shows. */
  readonly name: string;
  /** Their presence colour, `#rrggbb`. */
  readonly color: string;
  /** The ids they select, as presence carries them (at most 1,000). */
  readonly ids: readonly string[];
}

/** A peer's selection placed on the board: who, and the frame round what they select. */
export interface PeerSelectionPlacement extends PeerSelectionInput {
  /** The frame round the selection, world units: one object's own turned box, or the box round all. */
  readonly frame: OrientedBox;
}

/** Peers' selections as a mounted engine shows them (item 14). Main thread. */
export interface PeerSelectionSurface {
  /**
   * Shows peers' selections from now on: each peer's selection outlined as one box in their
   * colour by the engine's peer selection layer, placed on the board as it is now and placed
   * again whenever the board changes or a drag under way moves an object (`placements` and
   * `subscribe` tell the shell). Call it again when presence changes.
   *
   * @param peers - What presence says each peer selects.
   * @returns The peers shown and where, for their name tags; a peer none of whose objects is on
   *   the board shown is left out.
   */
  show(peers: readonly PeerSelectionInput[]): readonly PeerSelectionPlacement[];
  /**
   * The peers shown and where, as last placed.
   *
   * @returns The placements; the same array until they change.
   */
  placements(): readonly PeerSelectionPlacement[];
  /**
   * Calls `listener` whenever the placements change: a show, or the board or a drag moving what
   * a peer selects.
   *
   * @param listener - Called with no arguments; read `placements`.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void;
}

const NO_PLACEMENTS: readonly PeerSelectionPlacement[] = Object.freeze([]);

/** The tool services the mount reads the board as stored and its spatial index from. */
type BoardServices = Pick<ReturnType<EngineDocument['tools']['services']>, 'snapIndex' | 'store'>;

/**
 * The axis-aligned box round turned boxes; the box itself when there is one. Pure.
 *
 * @param boxes - The boxes, at least one.
 * @returns The frame.
 */
function frameRound(boxes: readonly OrientedBox[]): OrientedBox {
  const [only] = boxes;
  if (boxes.length === 1 && only !== undefined) return only;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    for (const corner of boxCornersOf(box)) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
}

/**
 * Whether a drag under way may move an object: the source gives it, or one of its parents (a
 * dragged group carries its children, whose own records do not change), otherwise than the
 * store; or it is a connector, whose route follows the objects it joins wherever they are.
 *
 * @param id - The object.
 * @param source - The board as the select tool reads it, the drag under way laid over it.
 * @param stored - The board as stored.
 * @returns Whether it is previewed.
 */
function isPreviewed(
  id: ObjectId,
  source: SelectionSource,
  stored: Pick<SelectionSource, 'get'>,
): boolean {
  for (let at: ObjectId | null = id; at !== null;) {
    const object = source.get(at);
    if (object !== stored.get(at) || object?.type === 'connector') return true;
    at = object?.parentId ?? null;
  }
  return false;
}

/**
 * The frame round many objects, for a selection too large to outline object by object: each
 * object's drawn bounds from the board's spatial index (one lookup each), and, for an object the
 * index does not hold (a group, which has no box of its own there) or one a drag under way
 * moves ({@link isPreviewed}: the index follows the board as stored, not the preview), its own
 * box as the select tool reads it (`selectionBoxOf`).
 *
 * @param ids - The objects on the board shown.
 * @param boundsOf - The index's bounds of an object.
 * @param source - The board as the select tool reads it, the drag under way laid over it.
 * @param stored - The board as stored: an object the source gives otherwise is previewed.
 * @returns The frame, or undefined when none has a box.
 */
function indexedFrameOf(
  ids: readonly ObjectId[],
  boundsOf: (id: ObjectId) => WorldBounds | undefined,
  source: SelectionSource,
  stored: Pick<SelectionSource, 'get'>,
): OrientedBox | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const id of ids) {
    const bounds = isPreviewed(id, source, stored) ? undefined : boundsOf(id);
    if (bounds !== undefined) {
      take(bounds.minX, bounds.minY);
      take(bounds.maxX, bounds.maxY);
      continue;
    }
    const box = selectionBoxOf(id, source);
    if (box !== undefined) for (const corner of boxCornersOf(box)) take(corner.x, corner.y);
  }
  if (minX > maxX) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
}

/**
 * One peer's selection frame, the one box drawn for it, as their own select tool frames it
 * (a multi-selection is one box round it all, never an outline per
 * object): one object's own turned box; several objects' axis-aligned box round their boxes,
 * from each object's own box while there are at most {@link MAX_OUTLINED_PER_PEER}, past that
 * from the spatial index where the board has one, so its cost does not grow with every object's
 * geometry. Objects not on the board shown, or without a box, are left out.
 *
 * @param ids - What the peer selects.
 * @param board - The board shown and its index.
 * @param source - The board as the select tool reads it, the drag under way laid over it.
 * @returns The frame, or undefined when nothing has a box.
 */
function peerFrameOf(
  ids: readonly string[],
  board: BoardServices,
  source: SelectionSource,
): OrientedBox | undefined {
  const objectIds = ids as readonly ObjectId[];
  if (objectIds.length > MAX_OUTLINED_PER_PEER) {
    const boundsOf = board.snapIndex?.boundsOf?.bind(board.snapIndex);
    const present = objectIds.filter((id) => source.get(id) !== undefined);
    return boundsOf === undefined
      ? selectionFrameOf(present, source)
      : indexedFrameOf(present, boundsOf, source, board.store);
  }
  const boxes = objectIds.flatMap((id) =>
    source.get(id) === undefined ? [] : (selectionBoxOf(id, source) ?? []),
  );
  return boxes.length === 0 ? undefined : frameRound(boxes);
}

/**
 * A mount's peers' selections (item 14, as Figma shows a collaborator's): from what
 * presence says each peer selects, it outlines the selected objects in the peer's colour through
 * the engine's peer selection layer ({@link PEER_SELECTION_LAYER}), sending a model only when it
 * changed, and gives the shell each selection's frame for the name tag. With no peer selecting
 * it sends nothing. Main thread.
 */
export class MountPeerSelection implements PeerSelectionSurface {
  private readonly documentOf: () => Pick<EngineDocument, 'tools'>;
  private readonly layers: Pick<HostLayers, 'show'>;
  private readonly listeners = new Set<() => void>();
  private peers: readonly PeerSelectionInput[] = [];
  private placed: readonly PeerSelectionPlacement[] = NO_PLACEMENTS;
  private placedKey = '[]';
  private sentKey = JSON.stringify({ outlines: [] });

  /**
   * Starts with nothing shown.
   *
   * @param documentOf - The mount's document side, read at each placing (it comes after the
   *   mount starts); its board shown, with the drag under way laid over it, is what peers'
   *   selections are placed on.
   * @param layers - The mount's overlay layers, which get the model.
   */
  constructor(documentOf: () => Pick<EngineDocument, 'tools'>, layers: Pick<HostLayers, 'show'>) {
    this.documentOf = documentOf;
    this.layers = layers;
  }

  /**
   * Shows peers' selections: those with an object on the board shown.
   *
   * @param peers - What presence says each peer selects.
   * @returns The placed peers, in the order given; none shown are left out.
   */
  show(peers: readonly PeerSelectionInput[]): readonly PeerSelectionPlacement[] {
    this.peers = peers;
    this.place();
    return this.placed;
  }

  /**
   * Places the peers shown again, from the board as the engine has it now and the drag under
   * way: the mount calls it after every document change the engine applies and every preview
   * change (`EngineDocument`'s change callback). Nothing while no peer selects.
   */
  refresh(): void {
    if (this.peers.length > 0 || this.placed.length > 0) this.place();
  }

  /** @inheritdoc */
  placements(): readonly PeerSelectionPlacement[] {
    return this.placed;
  }

  /** @inheritdoc */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private place(): void {
    const services = this.documentOf().tools.services();
    // The document with the drag under way laid over it, as the scene draws it: a peer's box
    // follows an object the person drags, frame by frame.
    const source = services.selectTool.source;
    const placed: PeerSelectionPlacement[] = [];
    const outlines: PeerSelectionOutline[] = [];
    for (const peer of this.peers) {
      const frame = peer.ids.length === 0 ? undefined : peerFrameOf(peer.ids, services, source);
      if (frame === undefined) continue;
      outlines.push({ box: frame, color: rgbaOfHex(peer.color) });
      placed.push({ ...peer, frame });
    }
    const key = JSON.stringify({ outlines });
    if (key !== this.sentKey) {
      this.sentKey = key;
      this.layers.show(PEER_SELECTION_LAYER, { outlines });
    }
    const placedKey = JSON.stringify(placed);
    if (placedKey === this.placedKey) return;
    this.placedKey = placedKey;
    this.placed = placed.length === 0 ? NO_PLACEMENTS : placed;
    for (const listener of this.listeners) listener();
  }
}
