import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { EngineOverlay } from '../host/engine-overlay.js';

import { PeerRectLayer } from './peer-rect-layer.js';
import {
  EMPTY_PEER_SELECTION,
  isPeerSelectionModel,
  peerSelectionRectsOf,
  type PeerSelectionModel,
} from './peer-selection-model.js';

/** The name of the frame stage that draws peers' selections, right after `draw`. */
export const PEER_SELECTION_STAGE_NAME = 'peerSelection';

/**
 * Draws collaborators' selections (item 14, as Figma shows them): each selected object
 * outlined in its peer's presence colour, through the solid-rect pipeline in a render pass of
 * its own after the scene's `draw` stage, as a transient overlay (`PeerRectLayer`): rebuilt only
 * when the model, the zoom or the pixel ratio changes, a pan writing only its camera uniform,
 * and nothing written or drawn with no peer selecting. Runs on the thread that owns the backend.
 */
export class PeerSelectionLayer extends PeerRectLayer<PeerSelectionModel> {
  /**
   * Creates the layer's GPU resources.
   *
   * @param backend - The backend the scene draws through.
   */
  constructor(backend: GpuBackend) {
    super(backend, {
      passName: 'peer-selection',
      stageName: PEER_SELECTION_STAGE_NAME,
      empty: EMPTY_PEER_SELECTION,
      rectsOf: peerSelectionRectsOf,
    });
  }
}

/**
 * The peers' selections ({@link PeerSelectionLayer}) as an engine host's overlay layer
 * (`EngineOverlay`), for `layerOverlays` where the engine renders. A model that is not a
 * `PeerSelectionModel` is refused (the host reports it as a fault). Runs on the thread that
 * renders.
 *
 * @param backend - The host's backend.
 * @returns The layer.
 */
export function createPeerSelectionLayer(backend: GpuBackend): EngineOverlay {
  const layer = new PeerSelectionLayer(backend);
  return {
    install: (frame) => {
      layer.install(frame);
    },
    setModel: (model) => {
      if (!isPeerSelectionModel(model)) return false;
      layer.setModel(model);
      return true;
    },
    destroy: () => {
      layer.destroy();
    },
  };
}
