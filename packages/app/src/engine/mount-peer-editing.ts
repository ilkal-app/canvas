import { EMPTY_PEER_EDITING, type PeerEditingModel, type SceneSource } from '@canvas/engine';
import type { TextLayoutService } from '@canvas/tools';

import {
  peerEditingGeometryOf,
  rgbaOfHex,
  type PeerEditingGeometry,
  type PeerEditingInput,
} from '../editing/peer-editing-geometry.js';
import type { TextEditingFeed } from '../editing/text-editing-feed.js';

import type { EngineDocument } from './engine-document.js';
import type { HostLayers } from './host-layers.js';
import { PEER_EDITING_LAYER } from './shell-overlay.js';

/** A peer's edit placed on the board: who, and where. */
export interface PeerEditingPlacement extends PeerEditingInput, PeerEditingGeometry {}

const NO_PLACEMENTS: readonly PeerEditingPlacement[] = Object.freeze([]);

/**
 * Peers editing text as a mounted engine shows them, and the person's own editing spot for
 * presence. Main thread.
 */
export interface PeerEditingSurface {
  /** Where the person is editing text, which the shell shares in presence. */
  readonly local: TextEditingFeed;
  /**
   * Shows peers editing text: their text box outlined in their colour, their caret and their
   * selection, drawn by the engine's peer editing layer from the text the board holds now. Call
   * it again when presence or the board changes.
   *
   * @param peers - What presence says each peer edits.
   * @returns The peers shown and where, for their name tags; a peer whose object is no text on
   *   the board, or whose text no font lays out yet, is left out.
   */
  show(peers: readonly PeerEditingInput[]): readonly PeerEditingPlacement[];
}

/**
 * A mount's peers editing text: from what presence says each peer edits, it places
 * their text box, caret and selection on the board as the engine draws the text, sends the
 * engine's peer editing layer ({@link PEER_EDITING_LAYER}) its model only when that changed,
 * and gives the shell the placements for the name tags. With no peer editing it sends nothing.
 * It also hands the shell the person's own editing spot (`MountText.editing`). Main thread.
 */
export class MountPeerEditing implements PeerEditingSurface {
  readonly local: TextEditingFeed;
  private readonly board: SceneSource;
  private readonly layout: TextLayoutService;
  private readonly layers: Pick<HostLayers, 'show'>;
  private sentKey = JSON.stringify(EMPTY_PEER_EDITING);

  /**
   * Starts with nothing shown.
   *
   * @param document - The mount's document side, whose board it places peers on.
   * @param layout - Lays text out on the page, as the engine draws it.
   * @param text - The mount's text editing, whose spot it hands on.
   * @param text.editing - The person's editing spot.
   * @param layers - The mount's overlay layers, which get the model.
   */
  constructor(
    document: Pick<EngineDocument, 'tools'>,
    layout: TextLayoutService,
    text: { readonly editing: TextEditingFeed },
    layers: Pick<HostLayers, 'show'>,
  ) {
    this.board = document.tools.services().store;
    this.layout = layout;
    this.local = text.editing;
    this.layers = layers;
  }

  /**
   * Shows peers editing text: those whose object is a text the board holds, laid out now.
   *
   * @param peers - What presence says each peer edits.
   * @returns The placed peers, in the order given; none shown are left out.
   */
  show(peers: readonly PeerEditingInput[]): readonly PeerEditingPlacement[] {
    const placed: PeerEditingPlacement[] = [];
    for (const peer of peers) {
      const geometry = peerEditingGeometryOf(this.board, this.layout, peer);
      if (geometry !== undefined) placed.push({ ...peer, ...geometry });
    }
    const model: PeerEditingModel = {
      peers: placed.map(({ box, caret, highlights, color }) => ({
        box,
        caret,
        highlights,
        color: rgbaOfHex(color),
      })),
    };
    const key = JSON.stringify(model);
    if (key !== this.sentKey) {
      this.sentKey = key;
      this.layers.show(PEER_EDITING_LAYER, model);
    }
    return placed.length === 0 ? NO_PLACEMENTS : placed;
  }
}
