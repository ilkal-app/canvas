import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import {
  createPeerEditingLayer,
  PEER_EDITING_STAGE_NAME,
  PeerEditingLayer,
} from './peer-editing-layer.js';
import { EMPTY_PEER_EDITING, type PeerEditingModel } from './peer-editing-model.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

const MODEL: PeerEditingModel = {
  peers: [
    {
      box: { x: 40, y: 80, width: 160, height: 120, rotation: 0 },
      color: [0.6, 0.3, 0.8, 1],
      caret: { x: 60, y: 100, width: 0, height: 20, rotation: 0 },
      highlights: [{ x: 52, y: 100, width: 30, height: 20, rotation: 0 }],
    },
  ],
};

function setUp() {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
  const layer = new PeerEditingLayer(backend);
  layer.install(renderer.frame);
  const frame = (camera: Camera = CAMERA): void => {
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 0, camera });
  };
  const layerWrites = (): string[] =>
    backend
      .writes()
      .map(({ label }) => label)
      .filter((label) => label.startsWith('peer-editing'));
  return { backend, renderer, layer, frame, layerWrites };
}

describe('PeerEditingLayer', () => {
  it('runs right after the scene is drawn', () => {
    const { renderer } = setUp();
    const names = renderer.frame.stageNames;
    expect(names.indexOf(PEER_EDITING_STAGE_NAME)).toBe(names.indexOf('draw') + 1);
  });

  it('writes and draws nothing with no peer editing, whatever the camera does', () => {
    const { backend, layer, frame, layerWrites } = setUp();
    frame();
    const draws = backend.count('draw');
    frame({ ...CAMERA, x: 50, zoom: 3 });
    expect(layerWrites()).toEqual([]);
    expect(backend.count('draw')).toBe(draws);
    expect(layer.rectCount).toBe(0);
  });

  it('draws a peer as a highlight, four outline bands and a caret in one instanced draw', () => {
    const { backend, layer, frame } = setUp();
    frame();
    const sceneDraws = backend.draws().length;
    layer.setModel(MODEL);
    frame();
    expect(layer.rectCount).toBe(6);
    const draws = backend.draws();
    expect(draws).toHaveLength(sceneDraws + 1);
    expect(draws.at(-1)).toMatchObject({ vertexCount: 6, instanceCount: 6 });
  });

  it('uploads no instances when only the camera pans, nor on a frame where nothing changed', () => {
    const { layer, frame, layerWrites } = setUp();
    layer.setModel(MODEL);
    frame();
    frame();
    expect(layerWrites()).toEqual([]);
    frame({ ...CAMERA, x: 25, y: -10 });
    expect(layerWrites()).toEqual([]);
  });

  it('rebuilds on a zoom and on a new model, and stops drawing when the peers stop', () => {
    const { layer, frame, layerWrites } = setUp();
    layer.setModel(MODEL);
    frame();
    frame({ ...CAMERA, zoom: 2 });
    expect(layerWrites()).toContain('peer-editing instances');
    layer.setModel({ peers: [...MODEL.peers, ...MODEL.peers] });
    frame({ ...CAMERA, zoom: 2 });
    expect(layer.rectCount).toBe(12);
    layer.setModel(EMPTY_PEER_EDITING);
    frame({ ...CAMERA, zoom: 2 });
    expect(layer.rectCount).toBe(0);
  });
});

describe('createPeerEditingLayer', () => {
  it('refuses a model that is not a peer editing model', () => {
    const layer = createPeerEditingLayer(new FakeGpuBackend());
    const renderer = new SceneRenderer(new FakeGpuBackend(), { clearColor: [0, 0, 0, 0] });
    layer.install(renderer.frame);
    expect(renderer.frame.stageNames).toContain(PEER_EDITING_STAGE_NAME);
    expect(layer.setModel({ sheets: [] })).toBe(false);
    expect(layer.setModel(MODEL)).toBe(true);
    layer.destroy();
  });
});
