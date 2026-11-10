// Acceptance: bounded layers retain visible multiply-form content.
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH } from '../../gpu/layer-composite-pass.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import { frameObject, groupObject, shapeObject, zKeyAt } from '../__fixtures__/scene-objects.js';
import type { FrameStats } from '../frame-context.js';
import {
  createDrawn,
  STANDARD_CAMERA,
  type Drawn,
} from '../segments/__fixtures__/standard-draw-order.js';

import { layerScratchBytesPerTexel } from './layer-budget.js';
import type { LayerCompositor } from './layer-compositor.js';

type C2cStats = FrameStats & {
  layersDrawn: number;
  layersFallbackSmall: number;
  layersFallbackLimit: number;
  layersFallbackBudget: number;
  layerBytes: number;
};

const pools: WorkerPool[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

async function ready(
  objects: BoardObject[],
  viewportWidthPx = 800,
  viewportHeightPx = 600,
): Promise<Drawn> {
  const drawn = createDrawn(pools);
  drawn.document.create(...objects);
  drawn.renderer.enqueue(drawn.document.takeChanges());
  for (let index = 0; index < 6; index += 1) {
    drawn.renderer.renderFrame({
      timeMs: index * 16,
      camera: { ...STANDARD_CAMERA, viewportWidthPx, viewportHeightPx },
    });
    drawn.pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return drawn;
}

function draw(
  drawn: Drawn,
  timeMs: number,
  zoom = 1,
  viewportWidthPx = 800,
  viewportHeightPx = 600,
) {
  drawn.backend.resetCalls();
  return drawn.renderer.renderFrame({
    timeMs,
    camera: { ...STANDARD_CAMERA, zoom, viewportWidthPx, viewportHeightPx },
  }) as C2cStats;
}

function targetPasses(drawn: Drawn): number {
  return drawn.backend.calls.filter(
    (call) => call.method === 'beginRenderPass' && call.target !== undefined,
  ).length;
}

function compositorOf(drawn: Drawn): LayerCompositor {
  const resources = (
    drawn.renderer as unknown as { passes: { pass: { name: string }; drawer: unknown }[] }
  ).passes;
  return resources.find(({ pass }) => pass.name === 'layer-composite')?.drawer as LayerCompositor;
}

function shapeDrawn(drawn: Drawn, id: string): boolean {
  const slots = drawn.renderer.scene.slotsOf(id as ObjectId, 'sdf-shape');
  let isShape = false;
  for (const call of drawn.backend.calls) {
    if (call.method === 'setPipeline') isShape = call.label.split(' ')[0] === 'sdf-shape';
    if (
      call.method === 'draw' &&
      isShape &&
      slots.some(
        (slot) => slot >= call.firstInstance && slot < call.firstInstance + call.instanceCount,
      )
    )
      return true;
  }
  return false;
}

function compositedIds(drawn: Drawn): string[] {
  const owners = new Map<number, string>();
  for (const [id, slots] of drawn.renderer.scene.slotEntriesOf('layer-composite')) {
    for (const slot of slots) owners.set(slot, id);
  }
  let isComposite = false;
  const ids: string[] = [];
  for (const call of drawn.backend.calls) {
    if (call.method === 'setPipeline') isComposite = call.label.split(' ')[0] === 'layer-composite';
    if (call.method === 'draw' && isComposite) {
      for (
        let slot = call.firstInstance;
        slot < call.firstInstance + call.instanceCount;
        slot += 1
      ) {
        const id = owners.get(slot);
        if (id !== undefined) ids.push(id);
      }
    }
  }
  return ids;
}

describe('layer fallback', () => {
  it('draws a sub-64 px group in multiply form with its opacity', async () => {
    const drawn = await ready([
      groupObject('tiny', { opacity: 0.5 }),
      shapeObject('child', { parentId: 'tiny', width: 50, height: 50 }),
    ]);
    const stats = draw(drawn, 200);
    expect(targetPasses(drawn)).toBe(0);
    expect(shapeDrawn(drawn, 'child')).toBe(true);
    const [slot] = drawn.renderer.scene.slotsOf('child' as ObjectId, 'sdf-shape');
    const pass = drawn.renderer.scene.passes.find((item) => item.name === 'sdf-shape');
    if (slot === undefined || pass?.layout.opacityFloat === undefined)
      throw new Error('missing child opacity');
    expect(
      drawn.renderer.scene.instanceBufferOf('sdf-shape').data[
        slot * pass.layout.floatsPerRecord + pass.layout.opacityFloat
      ],
    ).toBeCloseTo(0.5);
    expect(stats.layersFallbackSmall).toBe(1);
  });

  it('holds fallback through the 20% band during a slow zoom in both directions', async () => {
    const drawn = await ready([frameObject('layer', { opacity: 0.5, width: 100, height: 100 })]);
    const zooms = [0.5, 0.6, 0.65, 0.7, 0.75, 0.79, 0.81, 0.79, 0.7, 0.65, 0.6, 0.5];
    const passes = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0];
    for (const [index, zoom] of zooms.entries()) {
      draw(drawn, 200 + index * 16, zoom);
      expect(targetPasses(drawn), String(zoom)).toBe(passes[index]);
    }
  });

  it('composites at most 16 of 20 layers and draws every fallback subtree', async () => {
    const objects: BoardObject[] = [];
    for (let index = 0; index < 20; index += 1) {
      const id = 'group-' + String(index).padStart(2, '0');
      objects.push(
        groupObject(id, {
          x: (index % 5) * 120,
          y: Math.floor(index / 5) * 120,
          z: zKeyAt(index),
          opacity: 0.5,
        }),
      );
      objects.push(
        shapeObject('child-' + String(index).padStart(2, '0'), {
          parentId: id,
          width: index < 4 ? 110 : 100,
          height: index < 4 ? 110 : 100,
        }),
      );
    }
    const drawn = await ready(objects);
    const stats = draw(drawn, 200);
    expect(targetPasses(drawn)).toBe(16);
    for (let index = 0; index < 20; index += 1)
      expect(shapeDrawn(drawn, 'child-' + String(index).padStart(2, '0'))).toBe(true);
    expect(stats.layersDrawn).toBe(16);
    expect(stats.layersFallbackLimit).toBe(4);
    expect(compositedIds(drawn).sort()).toEqual(
      Array.from({ length: 16 }, (unused, index) => 'group-' + String(index).padStart(2, '0')),
    );
  });

  it('keeps an outermost layer when descendants exceed the limit', async () => {
    const objects: BoardObject[] = [
      frameObject('outer', { x: 10, y: 10, width: 500, height: 500, opacity: 0.5 }),
      shapeObject('outer-child', { parentId: 'outer', width: 80, height: 80 }),
    ];
    for (let index = 0; index < 16; index += 1) {
      const id = 'peer-' + String(index).padStart(2, '0');
      objects.push(
        frameObject(id, {
          parentId: 'outer',
          x: (index % 4) * 110,
          y: Math.floor(index / 4) * 110,
          width: 100,
          height: 100,
          opacity: 0.5,
        }),
      );
    }
    const drawn = await ready(objects);
    draw(drawn, 200);
    expect(targetPasses(drawn)).toBe(16);
    expect(compositedIds(drawn)).toContain('outer');
    expect(shapeDrawn(drawn, 'outer-child')).toBe(true);
  });

  it('falls back before the layer share is exceeded and still draws content', async () => {
    const drawn = await ready(
      [
        frameObject('huge', { opacity: 0.5, width: 4096, height: 4096 }),
        shapeObject('child', { parentId: 'huge', width: 100, height: 100 }),
      ],
      4096,
      4096,
    );
    const stats = draw(drawn, 200, 1, 4096, 4096);
    expect(stats.layersFallbackBudget).toBeGreaterThan(0);
    expect(stats.layerBytes).toBeLessThanOrEqual((512 * 1024 * 1024 * 6) / 64);
    expect(shapeDrawn(drawn, 'child')).toBe(true);
  });

  it('tiles a layer over 1024 px into six placed target passes', async () => {
    const drawn = await ready(
      [frameObject('wide', { opacity: 0.5, width: 2200, height: 1300 })],
      2300,
      1400,
    );
    const stats = draw(drawn, 200, 1, 2300, 1400);
    const tiles = drawn.backend.calls.filter(
      (call) => call.method === 'beginRenderPass' && call.target !== undefined,
    );
    expect(tiles).toHaveLength(6);
    expect(
      tiles.every(
        (call) =>
          call.method === 'beginRenderPass' &&
          call.target !== undefined &&
          call.target.width <= 1024 &&
          call.target.height <= 1024,
      ),
    ).toBe(true);
    expect(stats.layersDrawn).toBe(1);
  });

  it('counts composited layers, each fallback reason and charged bytes per frame', async () => {
    const drawn = await ready([
      frameObject('large', { opacity: 0.5, width: 200, height: 200 }),
      frameObject('small', { x: 300, opacity: 0.5, width: 40, height: 40 }),
    ]);
    const stats = draw(drawn, 200);
    expect(stats.layersDrawn).toBe(1);
    expect(stats.layersFallbackSmall).toBe(1);
    expect(stats.layersFallbackLimit).toBe(0);
    expect(stats.layersFallbackBudget).toBe(0);
    expect(stats.layerBytes).toBeGreaterThan(200 * 200 * 4);
  });

  it('charges shared MSAA colour and stencil scratch under layers with resolved targets', async () => {
    const drawn = await ready([frameObject('large', { opacity: 0.5, width: 200, height: 200 })]);
    draw(drawn, 200);
    expect(compositorOf(drawn).memory().category).toBe('layers');
    // The scratch as the backend allocates it: the 256 px target's extent at its bytes per texel.
    const scratch = 256 * 256 * layerScratchBytesPerTexel(drawn.backend.capabilities);
    // Exactly the scratch, the one resolved target and its composite uniform: nothing charged
    // twice, nothing at a whole tile.
    const [target] = drawn.backend.targets;
    expect(target).toBeDefined();
    const resolved = (target?.width ?? 0) * (target?.height ?? 0) * 4;
    expect(resolved).toBeGreaterThanOrEqual(200 * 200 * 4);
    expect(compositorOf(drawn).memory().bytes).toBe(
      scratch + resolved + LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH,
    );
  });

  it('reuses a 64 px bucket target through a slow zoom without allocating every frame', async () => {
    const drawn = await ready([frameObject('layer', { opacity: 0.5, width: 100, height: 100 })]);
    for (const [index, zoom] of [1, 1.01, 1.02, 1.03, 1.04].entries())
      draw(drawn, 200 + index * 16, zoom);
    expect(drawn.backend.targets).toHaveLength(1);
    expect(drawn.backend.targets[0]?.width).toBe(128);
    expect(drawn.backend.targets[0]?.height).toBe(128);
  });

  it('retains an idle target briefly and frees it after about two seconds', async () => {
    const drawn = await ready([frameObject('layer', { opacity: 0.5, width: 100, height: 100 })]);
    draw(drawn, 200);
    const target = drawn.backend.targets[0];
    draw(drawn, 216, 1, 800, 600);
    drawn.document.update('layer', { opacity: 1 });
    drawn.renderer.enqueue(drawn.document.takeChanges());
    draw(drawn, 300);
    expect(target?.isDestroyed).toBe(false);
    draw(drawn, 2200);
    expect(target?.isDestroyed).toBe(false);
    draw(drawn, 2301);
    expect(target?.isDestroyed).toBe(true);
  });
});
