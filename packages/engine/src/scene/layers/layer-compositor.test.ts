import { describe, expect, it } from 'vitest';

import type { Camera } from '../../camera/camera.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject, groupObject } from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

import { layerScratchBytes, layerScratchBytesPerTexel } from './layer-budget.js';
import { LAYER_COMPOSITE_PASS_NAME } from './layer-composite-pass-name.js';
import { createLayerCompositePass, LAYER_COMPOSITE_PASS } from './layer-composite-pass.js';
import type { LayerCompositor } from './layer-compositor.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

/** The fake backend's scratch bytes per texel: WebGPU, one sample. */
const RATE = layerScratchBytesPerTexel(new FakeGpuBackend().capabilities);

function setUp(pass = LAYER_COMPOSITE_PASS) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { passes: [SOLID_RECT_PASS, pass] });
  const document = new FakeSceneDocument();
  let time = 0;
  const frame = (camera: Camera = CAMERA, timeMs = (time += 16)): void => {
    time = timeMs;
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    renderer.renderFrame({ timeMs, camera });
  };
  const resources = (
    renderer as unknown as { passes: { pass: { name: string }; drawer?: unknown }[] }
  ).passes;
  const compositor = resources.find(({ pass }) => pass.name === LAYER_COMPOSITE_PASS_NAME)
    ?.drawer as LayerCompositor;
  const liveTargets = (): number => backend.targets.filter((target) => !target.isDestroyed).length;
  const targetPasses = (): number =>
    backend.calls.filter((call) => call.method === 'beginRenderPass' && call.target).length;
  return { backend, renderer, document, frame, compositor, liveTargets, targetPasses };
}

describe('LayerCompositor (C2c)', () => {
  it('keeps a layer’s 64 px bucket target across frames and counts it with the scratch', () => {
    const { backend, document, frame, compositor, liveTargets, targetPasses } = setUp();
    document.create(frameObject('f', { x: 10, y: 10, width: 100, height: 80, opacity: 0.5 }));
    frame();
    expect(backend.targets).toHaveLength(1);
    expect(backend.targets[0]).toMatchObject({ width: 128, height: 128 });
    expect(compositor.memory()).toEqual({
      category: 'layers',
      // The scratch as the backend allocates it: the one target's extent, not a whole tile.
      bytes: 128 * 128 * 4 + 32 + 128 * 128 * RATE,
    });
    frame();
    expect(backend.targets).toHaveLength(1);
    expect(targetPasses()).toBe(1);
    expect(liveTargets()).toBe(1);
    expect(compositor.hasPendingWork()).toBe(false);
  });

  it('grows a layer’s target on a zoom in, keeps it on a zoom out, and frees the outgrown one', () => {
    const { backend, document, frame, liveTargets } = setUp();
    document.create(frameObject('f', { x: 10, y: 10, width: 100, height: 80, opacity: 0.5 }));
    frame(CAMERA, 0);
    frame({ ...CAMERA, zoom: 0.9 }, 16);
    expect(backend.targets).toHaveLength(1);
    frame({ ...CAMERA, zoom: 1.5 }, 32);
    expect(backend.targets).toHaveLength(2);
    expect(backend.targets[1]).toMatchObject({ width: 192, height: 128 });
    expect(liveTargets()).toBe(2);
    // Back at 1×, the 192 × 128 target still holds the 128 px bucket within four times its area.
    frame({ ...CAMERA, zoom: 1 }, 48);
    expect(backend.targets).toHaveLength(2);
    expect(backend.targets[0]?.isDestroyed).toBe(false);
    frame({ ...CAMERA, zoom: 1 }, 2033);
    expect(backend.targets[0]?.isDestroyed).toBe(true);
    expect(backend.targets[1]?.isDestroyed).toBe(false);
    expect(liveTargets()).toBe(1);
    // Far out, the large target would waste too much: a new one of the bucket replaces it.
    frame({ ...CAMERA, zoom: 0.58 }, 2049);
    expect(backend.targets.at(-1)).toMatchObject({ width: 64, height: 64 });
  });

  it('frees idle targets and uniforms after two seconds, and everything on destroy', () => {
    const { backend, renderer, document, frame, compositor, liveTargets } = setUp();
    document.create(
      frameObject('f', { x: 10, y: 10, width: 100, height: 80, opacity: 0.5 }),
      frameObject('g', { x: 200, y: 10, width: 100, height: 80, opacity: 0.5 }),
    );
    frame(CAMERA, 0);
    expect(liveTargets()).toBe(2);
    document.update('f', { opacity: 1 });
    frame(CAMERA, 16);
    expect(liveTargets()).toBe(2);
    frame({ ...CAMERA, x: 5000 }, 1000);
    expect(liveTargets()).toBe(2);
    frame({ ...CAMERA, x: 5000 }, 3000);
    expect(liveTargets()).toBe(0);
    expect(compositor.hasPooledLayers).toBe(false);
    expect(compositor.memory().bytes).toBe(0);
    document.update('f', { opacity: 0.5 });
    frame(CAMERA, 3016);
    expect(liveTargets()).toBe(2);
    renderer.destroy();
    expect(liveTargets()).toBe(0);
    const uniforms = backend.buffers.filter(({ label }) => label === 'layer-composite layer');
    expect(uniforms).toHaveLength(4);
    expect(uniforms.every(({ isDestroyed }) => isDestroyed)).toBe(true);
  });

  it('keeps the pool under the budget by freeing idle targets first', () => {
    // So small a budget takes the smallest tile, 256 px. At 2.2× the 256 × 192 target and its
    // scratch fit, with 50 000 bytes to spare, but not with an idle 128 or 192 px one too.
    const scratch = layerScratchBytes({ width: 256, height: 192 }, RATE);
    const budget = 256 * 192 * 4 + scratch + 50_000;
    const { document, frame, liveTargets } = setUp(
      createLayerCompositePass({ byteBudget: budget }),
    );
    document.create(frameObject('f', { x: 10, y: 10, width: 100, height: 80, opacity: 0.5 }));
    frame(CAMERA, 0);
    frame({ ...CAMERA, zoom: 1.5 }, 16);
    expect(liveTargets()).toBe(2);
    frame({ ...CAMERA, zoom: 2.2 }, 32);
    // The 256 px target fits only once both idle ones are gone.
    expect(liveTargets()).toBe(1);
  });

  it('composites a nested layer into its parent’s target, placed in the parent’s pixels', () => {
    const { backend, document, frame } = setUp();
    document.create(
      frameObject('outer', { x: 20, y: 20, width: 200, height: 100, opacity: 0.5 }),
      groupObject('inner', { parentId: 'outer', opacity: 0.5 }),
      frameObject('child', { parentId: 'inner', x: 10, y: 10, width: 80, height: 70 }),
    );
    frame();
    const order = backend.calls
      .filter((call) => call.method === 'beginRenderPass' || call.method === 'setPipeline')
      .map((call) =>
        call.method === 'setPipeline' ? call.label : call.target ? 'target' : 'canvas',
      );
    expect(order).toEqual([
      'target',
      'solid-rect',
      'target',
      'solid-rect',
      'layer-composite',
      'canvas',
      'layer-composite',
    ]);
    const uniforms = backend.calls.filter(
      (call) => call.method === 'writeBuffer' && call.label === 'layer-composite layer',
    );
    expect(uniforms).toHaveLength(2);
  });

  it('composites a nested layer into every tile of a tiled parent it overlaps', () => {
    const { backend, document, frame, compositor } = setUp();
    const wide: Camera = { ...CAMERA, viewportWidthPx: 1400 };
    document.create(
      frameObject('outer', { x: 0, y: 0, width: 1300, height: 200, opacity: 0.5 }),
      groupObject('inner', { parentId: 'outer', opacity: 0.5 }),
      frameObject('child', { parentId: 'inner', x: 950, y: 10, width: 150, height: 100 }),
      groupObject('left', { parentId: 'outer', opacity: 0.5 }),
      frameObject('leaf', { parentId: 'left', x: 10, y: 10, width: 100, height: 100 }),
    );
    frame(wide);
    expect(compositor.stateOf('outer' as never)?.tiles).toHaveLength(2);
    // Two outer tiles to the canvas, the inner layer into both outer tiles it crosses, and the
    // left one into the first outer tile only.
    expect(
      backend.calls.filter(
        (call) => call.method === 'writeBuffer' && call.label === 'layer-composite layer',
      ),
    ).toHaveLength(5);
    expect(
      backend.calls.filter(
        (call) => call.method === 'setPipeline' && call.label === 'layer-composite',
      ),
    ).toHaveLength(5);
  });

  it('draws a layer over budget in place, its composited child there at both opacities', () => {
    const { backend, renderer, document, frame, compositor } = setUp();
    const huge: Camera = { ...CAMERA, viewportWidthPx: 4096, viewportHeightPx: 4096 };
    document.create(
      frameObject('huge', { width: 4096, height: 4096, opacity: 0.5 }),
      groupObject('inner', { parentId: 'huge', opacity: 0.5 }),
      frameObject('child', { parentId: 'inner', x: 10, y: 10, width: 200, height: 200 }),
    );
    frame(huge);
    expect(compositor.stateOf('huge' as never)?.tiles).toEqual([]);
    expect(compositor.stateOf('inner' as never)?.tiles).toHaveLength(1);
    const order = backend.calls
      .filter((call) => call.method === 'beginRenderPass' || call.method === 'setPipeline')
      .map((call) =>
        call.method === 'setPipeline' ? call.label : call.target ? 'target' : 'canvas',
      );
    // The child in its group's target; on the canvas the frame's own background, drawn in
    // place, then the group's composite.
    expect(order).toEqual(['target', 'solid-rect', 'canvas', 'solid-rect', 'layer-composite']);
    expect(renderer.scene.layerOpacity.multiplierOf('inner' as never)).toBeCloseTo(0.5);
  });

  it('restores the canvas camera after drawing the layers', () => {
    const { backend, document, frame } = setUp();
    document.create(frameObject('f', { x: 10, y: 10, width: 100, height: 80, opacity: 0.5 }));
    frame();
    const camera = backend.calls.filter(
      (call) => call.method === 'writeBuffer' && call.label === 'camera',
    );
    expect(camera).toHaveLength(3);
    frame();
    expect(
      backend.calls.filter((call) => call.method === 'writeBuffer' && call.label === 'camera'),
    ).toHaveLength(2);
  });

  it('skips a composite record with no layer this frame, and selects no move placement', () => {
    const { backend, compositor } = setUp();
    compositor.install();
    compositor.setMovePlacement();
    const renderPass = backend.beginRenderPass({});
    compositor.drawEntry(
      {
        renderPass,
        instanceBuffer: backend.createBuffer({ usage: 'vertex', byteLength: 4 }),
        frame: { stats: { drawCalls: 0 } } as never,
      },
      { passName: LAYER_COMPOSITE_PASS_NAME, ranges: [{ start: 3, count: 2 }] },
    );
    renderPass.end();
    expect(backend.count('draw')).toBe(0);
    expect(compositor.stateOf('nothing' as never)).toBeUndefined();
  });

  it('gives no state to a layer whose parent has none, and reads a missing record as opaque', () => {
    const { backend, compositor } = setUp();
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const stats = { bufferWrites: 0, uploadedBytes: 0 };
    compositor.prepare({
      camera: CAMERA,
      frameIndex: 1,
      timeMs: 0,
      scene: { layerOpacity: { multiplierOf: () => 1 } },
      stats,
      layers: [
        { id: 'orphan' as never, slot: 0, parent: 'absent' as never, bounds },
        { id: 'far' as never, slot: 1_000_000, parent: undefined, bounds },
      ],
    } as never);
    expect(compositor.stateOf('orphan' as never)).toBeUndefined();
    expect(compositor.stateOf('far' as never)).toMatchObject({ rect: { width: 11, height: 11 } });
    const uniform = backend.calls.filter(
      (call) => call.method === 'writeBuffer' && call.label === 'layer-composite layer',
    );
    expect(uniform).toHaveLength(1);
    expect(stats.bufferWrites).toBe(1);
  });
});
