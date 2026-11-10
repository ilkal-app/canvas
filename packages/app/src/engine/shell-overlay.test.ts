import { describe, expect, it } from 'vitest';

import {
  EMPTY_PEER_EDITING,
  EMPTY_PEER_SELECTION,
  EMPTY_SEARCH_HIGHLIGHT,
  EMPTY_TRACE_TINT,
  Frame,
  overlayLayerModel,
} from '@canvas/engine';
import { EMPTY_OVERLAY, SELECTION_OVERLAY_STAGE_NAME } from '@canvas/tools';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import {
  createShellOverlay,
  PEER_EDITING_LAYER,
  PEER_SELECTION_LAYER,
  SEARCH_HIGHLIGHT_LAYER,
  TRACE_TINT_LAYER,
} from './shell-overlay.js';

describe('createShellOverlay', () => {
  it('draws the selection overlay over peers editing, over peers’ selections, over the search highlight, over the trace tint, each taking its own models', () => {
    const layer = createShellOverlay(new FakeGpuBackend());
    const frame = new Frame([
      { name: 'draw', run: () => undefined },
      { name: 'submit', run: () => undefined },
    ]);
    layer.install(frame);
    expect(frame.stageNames).toEqual([
      'draw',
      'traceTint',
      'searchHighlight',
      'peerSelection',
      'peerEditing',
      SELECTION_OVERLAY_STAGE_NAME,
      'submit',
    ]);
    expect(layer.setModel(EMPTY_OVERLAY)).toBe(true);
    expect(layer.setModel(overlayLayerModel(TRACE_TINT_LAYER, EMPTY_TRACE_TINT))).toBe(true);
    expect(layer.setModel(overlayLayerModel(TRACE_TINT_LAYER, EMPTY_OVERLAY))).toBe(false);
    expect(layer.setModel(overlayLayerModel(PEER_EDITING_LAYER, EMPTY_PEER_EDITING))).toBe(true);
    expect(layer.setModel(overlayLayerModel(PEER_EDITING_LAYER, EMPTY_TRACE_TINT))).toBe(false);
    expect(layer.setModel(overlayLayerModel(PEER_SELECTION_LAYER, EMPTY_PEER_SELECTION))).toBe(
      true,
    );
    expect(layer.setModel(overlayLayerModel(PEER_SELECTION_LAYER, EMPTY_PEER_EDITING))).toBe(false);
    expect(layer.setModel(overlayLayerModel(SEARCH_HIGHLIGHT_LAYER, EMPTY_SEARCH_HIGHLIGHT))).toBe(
      true,
    );
    expect(layer.setModel(overlayLayerModel(SEARCH_HIGHLIGHT_LAYER, EMPTY_TRACE_TINT))).toBe(false);
    layer.destroy();
  });
});
