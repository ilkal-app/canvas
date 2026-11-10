import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from './__fixtures__/scene-objects.js';
import {
  dotGridUniformOf,
  GRID_DOT_COLOR,
  GRID_UNIFORM_BYTE_LENGTH,
  GridBackground,
} from './grid-background.js';
import { SceneRenderer } from './scene-renderer.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

function setUp(isVisible: boolean): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  grid: GridBackground;
} {
  const backend = new FakeGpuBackend();
  const grid = new GridBackground(backend, { isVisible });
  const renderer = new SceneRenderer(backend, { background: grid });
  const document = new FakeSceneDocument();
  document.create(shapeObject('a', { x: 10, z: zKeyAt(0) }));
  renderer.enqueue(document.takeChanges());
  backend.resetCalls();
  return { backend, renderer, grid };
}

function gridWrites(backend: FakeGpuBackend): number {
  return backend.writes().filter((write) => write.label === 'dot-grid uniform').length;
}

function gridPipelineSets(backend: FakeGpuBackend): number {
  return backend.calls.filter((call) => call.method === 'setPipeline' && call.label === 'dot-grid')
    .length;
}

describe('dotGridUniformOf', () => {
  it('places the lattice at the world origin, in device pixels, at the zoom-adaptive spacing', () => {
    const uniform = dotGridUniformOf(CAMERA, GRID_DOT_COLOR, 1);
    expect([...uniform]).toEqual([0, 0, 200, 100, ...GRID_DOT_COLOR, 16, 1, 0, 0]);
    expect(uniform.byteLength).toBe(GRID_UNIFORM_BYTE_LENGTH);
  });

  it('fills the array it is given', () => {
    const out = new Float32Array(12);
    expect(dotGridUniformOf(CAMERA, GRID_DOT_COLOR, 1, out)).toBe(out);
    expect(out[8]).toBe(16);
  });

  it('reduces a pan to its phase modulo the spacing, whatever its sign', () => {
    const panned = dotGridUniformOf({ ...CAMERA, x: 21, y: -5 }, GRID_DOT_COLOR, 1);
    // The world origin is 21 px left of the canvas: the next dot is at 16·2 − 21 = 11 px.
    expect(panned[0]).toBe(11);
    expect(panned[1]).toBe(5);
    const far = dotGridUniformOf({ ...CAMERA, x: 1e9 + 3 }, GRID_DOT_COLOR, 1);
    expect(far[0]).toBe(13);
  });

  it('scales the spacing and the dot with the device pixel ratio and follows the zoom', () => {
    const dense = dotGridUniformOf({ ...CAMERA, zoom: 2, dpr: 2 }, GRID_DOT_COLOR, 1);
    // At 200% the spacing halves to 8 world units, 16 CSS px, 32 device px.
    expect(dense[8]).toBe(32);
    expect(dense[9]).toBe(2);
    expect(dense[2]).toBe(400);
    const coarse = dotGridUniformOf({ ...CAMERA, zoom: 0.25 }, GRID_DOT_COLOR, 1);
    expect(coarse[8]).toBe(16);
  });

  it('scales the dots’ alpha by the zoom fade, and only the alpha', () => {
    const full = dotGridUniformOf({ ...CAMERA, zoom: 0.25 }, GRID_DOT_COLOR, 1);
    expect(full[7]).toBe(GRID_DOT_COLOR[3]);
    // 18.75% is the middle of the fade band: half the alpha, the same grey.
    const fading = dotGridUniformOf({ ...CAMERA, zoom: 0.1875 }, GRID_DOT_COLOR, 1);
    expect([...fading.subarray(4, 8)]).toEqual([0.5, 0.5, 0.5, GRID_DOT_COLOR[3] * 0.5]);
    expect(fading[8]).toBe(24);
  });
});

describe('GridBackground', () => {
  it('draws the grid first in the scene pass, under every object', () => {
    const { backend, renderer } = setUp(true);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const draws = backend.draws();
    expect(draws[0]).toMatchObject({ vertexCount: 6, instanceCount: 1 });
    expect(draws.length).toBe(2);
    expect(backend.count('beginRenderPass')).toBe(1);
  });

  it('writes its uniform only when the camera changes', () => {
    const { backend, renderer } = setUp(true);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(gridWrites(backend)).toBe(1);
    const stats = renderer.renderFrame({ timeMs: 32, camera: { ...CAMERA, x: 3 } });
    expect(gridWrites(backend)).toBe(2);
    // The camera uniform and the grid's.
    expect(stats.bufferWrites).toBe(2);
  });

  it('writes and draws nothing while hidden, and shows again from the next frame', () => {
    const { backend, renderer, grid } = setUp(false);
    const hidden = renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(gridWrites(backend)).toBe(0);
    expect(hidden.drawCalls).toBe(1);
    grid.setVisible(true);
    expect(grid.isVisible).toBe(true);
    const shown = renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(gridWrites(backend)).toBe(1);
    expect(shown.drawCalls).toBe(2);
  });

  it('fades with the zoom: a frame inside the band writes the faded alpha and draws', () => {
    const { backend, renderer } = setUp(true);
    const stats = renderer.renderFrame({ timeMs: 0, camera: { ...CAMERA, zoom: 0.1875 } });
    expect(gridWrites(backend)).toBe(1);
    expect(stats.drawCalls).toBe(2);
  });

  it('does no grid work below the band: no write, no draw, also when only the camera moves', () => {
    const { backend, renderer, grid } = setUp(true);
    const far = { ...CAMERA, zoom: 0.1 };
    const first = renderer.renderFrame({ timeMs: 0, camera: far });
    const panned = renderer.renderFrame({ timeMs: 16, camera: { ...far, x: 40 } });
    const zoomed = renderer.renderFrame({ timeMs: 32, camera: { ...far, zoom: 0.05 } });
    expect(gridWrites(backend)).toBe(0);
    for (const stats of [first, panned, zoomed]) expect(stats.drawCalls).toBe(1);
    expect(gridPipelineSets(backend)).toBe(0);
    // The grid stays on: zooming back in draws it again, with a fresh uniform.
    expect(grid.isVisible).toBe(true);
    const back = renderer.renderFrame({ timeMs: 48, camera: { ...far, zoom: 0.5 } });
    expect(gridWrites(backend)).toBe(1);
    expect(back.drawCalls).toBe(2);
  });

  it('frees its buffers', () => {
    const { backend, grid } = setUp(true);
    grid.destroy();
    const own = backend.buffers.filter((buffer) => buffer.label.startsWith('dot-grid'));
    expect(own.map((buffer) => buffer.isDestroyed)).toEqual([true, true]);
  });
});
