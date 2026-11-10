import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { PEER_EDITING_STAGE_NAME, PeerEditingLayer } from './peer-editing-layer.js';
import {
  createPeerSelectionLayer,
  PEER_SELECTION_STAGE_NAME,
  PeerSelectionLayer,
} from './peer-selection-layer.js';
import {
  EMPTY_PEER_SELECTION,
  isPeerSelectionModel,
  MAX_PEER_SELECTION_OUTLINES,
  peerSelectionRectsOf,
  type PeerSelectionModel,
} from './peer-selection-model.js';

// Collaborators' selections (item 14): the model's rectangles and the layer's frames.

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

const MODEL: PeerSelectionModel = {
  outlines: [
    { box: { x: 40, y: 60, width: 100, height: 50, rotation: 0 }, color: [0.2, 0.4, 0.8, 1] },
    { box: { x: 200, y: 60, width: 40, height: 40, rotation: Math.PI / 2 }, color: [1, 0, 0, 1] },
  ],
};

function setUp() {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
  const layer = new PeerSelectionLayer(backend);
  layer.install(renderer.frame);
  const frame = (camera: Camera = CAMERA): void => {
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 0, camera });
  };
  const layerWrites = (): string[] =>
    backend
      .writes()
      .map(({ label }) => label)
      .filter((label) => label.startsWith('peer-selection'));
  return { backend, renderer, layer, frame, layerWrites };
}

describe('peerSelectionRectsOf', () => {
  it('outlines each box with four bands just outside it, 1.5 px rounded to 2 device px at 1x', () => {
    const rects = peerSelectionRectsOf(MODEL, 1, 1);
    expect(rects).toHaveLength(8);
    const [top, bottom, left, right] = rects;
    expect(top).toMatchObject({ x: 38, y: 58, width: 104, height: 2 });
    expect(bottom).toMatchObject({ x: 38, y: 110, width: 104, height: 2 });
    expect(left).toMatchObject({ x: 38, y: 60, width: 2, height: 50 });
    expect(right).toMatchObject({ x: 140, y: 60, width: 2, height: 50 });
    expect(rects[4]?.cos).toBeCloseTo(0, 12);
    expect(rects[4]?.sin).toBeCloseTo(1, 12);
  });

  it('keeps the bands one screen width at any zoom, in whole device pixels', () => {
    const [top] = peerSelectionRectsOf(MODEL, 4, 2);
    expect(top?.height).toBeCloseTo(1.5 / 4, 12);
    const [thin] = peerSelectionRectsOf(MODEL, 2, 1);
    expect(thin?.height).toBeCloseTo(2 / 2, 12);
  });

  it('draws at most MAX_PEER_SELECTION_OUTLINES outlines', () => {
    const outline = MODEL.outlines[0];
    if (outline === undefined) throw new Error('no outline');
    const many = {
      outlines: Array.from({ length: MAX_PEER_SELECTION_OUTLINES + 3 }, () => outline),
    };
    expect(peerSelectionRectsOf(many, 1, 1)).toHaveLength(MAX_PEER_SELECTION_OUTLINES * 4);
  });
});

describe('isPeerSelectionModel', () => {
  it('takes a well-formed model and refuses anything else', () => {
    expect(isPeerSelectionModel(MODEL)).toBe(true);
    expect(isPeerSelectionModel(EMPTY_PEER_SELECTION)).toBe(true);
    expect(
      isPeerSelectionModel({ outlines: [{ box: MODEL.outlines[0]?.box, color: [1, 0, 0] }] }),
    ).toBe(false);
    const box = { x: 0, y: 0, width: -1, height: 1, rotation: 0 };
    expect(isPeerSelectionModel({ outlines: [{ box, color: [1, 0, 0, 1] }] })).toBe(false);
    expect(isPeerSelectionModel({ peers: [] })).toBe(false);
  });
});

describe('PeerSelectionLayer', () => {
  it('runs right after the scene is drawn', () => {
    const { renderer } = setUp();
    const names = renderer.frame.stageNames;
    expect(names.indexOf(PEER_SELECTION_STAGE_NAME)).toBe(names.indexOf('draw') + 1);
  });

  it('writes and draws nothing with no peer selecting, whatever the camera does', () => {
    const { backend, layer, frame, layerWrites } = setUp();
    frame();
    const draws = backend.count('draw');
    frame({ ...CAMERA, x: 50, zoom: 3 });
    expect(layerWrites()).toEqual([]);
    expect(backend.count('draw')).toBe(draws);
    expect(layer.rectCount).toBe(0);
  });

  it('draws the outlines, rebuilds on a zoom, and on a pan writes only its camera', () => {
    const { layer, frame, layerWrites } = setUp();
    layer.setModel(MODEL);
    frame();
    expect(layer.rectCount).toBe(8);
    expect(layerWrites().some((label) => label.includes('instances'))).toBe(true);
    frame({ ...CAMERA, x: 30 });
    expect(layerWrites().every((label) => !label.includes('instances'))).toBe(true);
    frame({ ...CAMERA, zoom: 2 });
    expect(layerWrites().some((label) => label.includes('instances'))).toBe(true);
    layer.setModel(EMPTY_PEER_SELECTION);
    frame();
    expect(layer.rectCount).toBe(0);
  });

  it('draws under the peer editing marks when installed after them', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
    new PeerEditingLayer(backend).install(renderer.frame);
    new PeerSelectionLayer(backend).install(renderer.frame);
    const names = renderer.frame.stageNames;
    expect(names.indexOf(PEER_SELECTION_STAGE_NAME)).toBeLessThan(
      names.indexOf(PEER_EDITING_STAGE_NAME),
    );
  });

  it('as an overlay, refuses a model of another shape', () => {
    const overlay = createPeerSelectionLayer(new FakeGpuBackend());
    expect(overlay.setModel(MODEL)).toBe(true);
    expect(overlay.setModel({ peers: [] })).toBe(false);
    overlay.destroy();
  });
});
