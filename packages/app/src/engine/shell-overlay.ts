import {
  createPeerEditingLayer,
  createPeerSelectionLayer,
  createSearchHighlightLayer,
  createTraceTintLayer,
  layerOverlays,
  type EngineOverlayFactory,
} from '@canvas/engine';
import { createSelectionOverlayLayer } from '@canvas/tools';

/** The name of the trace tint's layer in the shell's overlay. */
export const TRACE_TINT_LAYER = 'traceTint';

/** The name of the peers' editing marks' layer in the shell's overlay. */
export const PEER_EDITING_LAYER = 'peerEditing';

/** The name of the peers' selections' layer in the shell's overlay (item 14). */
export const PEER_SELECTION_LAYER = 'peerSelection';

/** The name of the board search highlight's layer in the shell's overlay. */
export const SEARCH_HIGHLIGHT_LAYER = 'searchHighlight';

/**
 * The shell's overlay layer, created where the engine renders (the engine worker's script and
 * the main-thread host alike): the select tool's overlay (the person's own caret included),
 * drawn over peers' editing marks (`createPeerEditingLayer`), whose models go to
 * {@link PEER_EDITING_LAYER}, drawn over peers' selections (`createPeerSelectionLayer`),
 * whose models go to {@link PEER_SELECTION_LAYER}, drawn over the board search highlight (`createSearchHighlightLayer`,
 *), whose models go to {@link SEARCH_HIGHLIGHT_LAYER}, drawn over the trace tint
 * (`createTraceTintLayer`), whose models go to {@link TRACE_TINT_LAYER}.
 */
export const createShellOverlay: EngineOverlayFactory = layerOverlays(createSelectionOverlayLayer, {
  [PEER_EDITING_LAYER]: createPeerEditingLayer,
  [PEER_SELECTION_LAYER]: createPeerSelectionLayer,
  [SEARCH_HIGHLIGHT_LAYER]: createSearchHighlightLayer,
  [TRACE_TINT_LAYER]: createTraceTintLayer,
});
