import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { EngineOverlay } from '../host/engine-overlay.js';

import {
  EMPTY_PEER_EDITING,
  isPeerEditingModel,
  peerEditingRectsOf,
  type PeerEditingModel,
} from './peer-editing-model.js';
import { PeerRectLayer } from './peer-rect-layer.js';

/** The name of the frame stage that draws peers' editing marks, right after `draw`. */
export const PEER_EDITING_STAGE_NAME = 'peerEditing';

/**
 * Draws peers editing text (Figma "States" E1, node 36:1836): per peer, the text box
 * outlined in their presence colour, their selection highlighted in it and their caret, through
 * the solid-rect pipeline in a render pass of its own after the scene's `draw` stage, as a
 * transient overlay (excluded from document-preview certificates), the way the trace tint is
 * (`TraceTintLayer`). The rectangles are rebuilt only when the model, the zoom or the pixel
 * ratio changes (outline and caret keep their screen width), into a persistent instance buffer
 * uploaded by dirty ranges; a pan writes only the layer's camera uniform, and with no peer
 * editing it writes and draws nothing at all (`PeerRectLayer`). The page sends a model only when
 * a peer's state or the text under it changes. Runs on the thread that owns the backend.
 */
export class PeerEditingLayer extends PeerRectLayer<PeerEditingModel> {
  /**
   * Creates the layer's GPU resources.
   *
   * @param backend - The backend the scene draws through.
   */
  constructor(backend: GpuBackend) {
    super(backend, {
      passName: 'peer-editing',
      stageName: PEER_EDITING_STAGE_NAME,
      empty: EMPTY_PEER_EDITING,
      rectsOf: peerEditingRectsOf,
    });
  }
}

/**
 * The peer editing marks ({@link PeerEditingLayer}) as an engine host's overlay layer
 * (`EngineOverlay`): the app combines it with the selection overlay through `layerOverlays`,
 * where the engine renders (the app's engine worker script, or the main-thread host). A model
 * that is not a `PeerEditingModel` is refused (the host reports it as a fault). Runs on the
 * thread that renders.
 *
 * @param backend - The host's backend.
 * @returns The layer.
 */
export function createPeerEditingLayer(backend: GpuBackend): EngineOverlay {
  const layer = new PeerEditingLayer(backend);
  return {
    install: (frame) => {
      layer.install(frame);
    },
    setModel: (model) => {
      if (!isPeerEditingModel(model)) return false;
      layer.setModel(model);
      return true;
    },
    destroy: () => {
      layer.destroy();
    },
  };
}
