import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import {
  createSearchHighlightLayer,
  SearchHighlightLayer,
  SEARCH_HIGHLIGHT_STAGE_NAME,
} from './search-highlight-layer.js';
import { EMPTY_SEARCH_HIGHLIGHT, type SearchHighlightModel } from './search-highlight-model.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };
const BOX = { bounds: { minX: 40, minY: 80, maxX: 200, maxY: 160 }, isActive: false };
const MODEL: SearchHighlightModel = {
  color: [0.6, 0.7, 0.8, 1],
  boxes: [BOX],
};

function setUp() {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
  const layer = new SearchHighlightLayer(backend);
  layer.install(renderer.frame);
  const frame = (camera: Camera = CAMERA): void => {
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 0, camera });
  };
  const instanceWrites = (): string[] =>
    backend
      .writes()
      .map(({ label }) => label)
      .filter((label) => label.startsWith('search-highlight') && label.endsWith('instances'));
  return { backend, renderer, layer, frame, instanceWrites };
}

describe('SearchHighlightLayer', () => {
  it('installs a transient stage after the scene draw', () => {
    const { renderer } = setUp();
    const names = renderer.frame.stageNames;
    expect(names.indexOf(SEARCH_HIGHLIGHT_STAGE_NAME)).toBe(names.indexOf('draw') + 1);
  });

  it('draws and uploads nothing when empty, even after a camera change', () => {
    const { backend, layer, frame, instanceWrites } = setUp();
    frame();
    const draws = backend.count('draw');
    frame({ ...CAMERA, zoom: 2, x: 20 });
    expect(layer.rectCount).toBe(0);
    expect(backend.count('draw')).toBe(draws);
    expect(instanceWrites()).toEqual([]);
  });

  it('draws four edges per ordinary hit and an extra fill for an active hit', () => {
    const { backend, layer, frame } = setUp();
    frame();
    const sceneDraws = backend.draws().length;
    layer.setModel(MODEL);
    frame();
    expect(layer.rectCount).toBe(4);
    expect(backend.draws()).toHaveLength(sceneDraws + 1);
    expect(backend.draws().at(-1)).toMatchObject({ vertexCount: 6, instanceCount: 4 });
    layer.setModel({ ...MODEL, boxes: [{ ...BOX, isActive: true }] });
    frame();
    expect(layer.rectCount).toBe(5);
    expect(backend.draws().at(-1)).toMatchObject({ vertexCount: 6, instanceCount: 5 });
  });

  it('keeps instances on a pan, rebuilds on zoom and model change, and clears on close', () => {
    const { layer, frame, instanceWrites } = setUp();
    layer.setModel(MODEL);
    frame();
    frame({ ...CAMERA, x: 20 });
    expect(instanceWrites()).toEqual([]);
    frame({ ...CAMERA, zoom: 2 });
    expect(instanceWrites()).toContain('search-highlight instances');
    layer.setModel({ ...MODEL, boxes: [...MODEL.boxes, ...MODEL.boxes] });
    frame({ ...CAMERA, zoom: 2 });
    expect(layer.rectCount).toBe(8);
    expect(instanceWrites()).toContain('search-highlight instances');
    layer.setModel(EMPTY_SEARCH_HIGHLIGHT);
    frame({ ...CAMERA, zoom: 2 });
    expect(layer.rectCount).toBe(0);
  });
});

describe('createSearchHighlightLayer', () => {
  it('refuses malformed models at the host boundary', () => {
    const layer = createSearchHighlightLayer(new FakeGpuBackend());
    expect(layer.setModel({ boxes: 'no', color: [1, 1, 1, 1] })).toBe(false);
    expect(layer.setModel(MODEL)).toBe(true);
    layer.destroy();
  });
});
