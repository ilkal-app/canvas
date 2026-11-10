import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { TransformTable } from '../gpu/transform-table.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { AllVisibleCuller } from '../scene/scene-culler.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { createPathScene, PATH_CAMERA, zigzagPath } from './__fixtures__/path-scene.js';
import type { PathDrawer } from './path-drawer.js';
import { INLINE_MESH_BUILDER } from './path-mesh-builder.js';
import { createPathPass } from './path-pass.js';

const stroke = (id: string, rank: number) => zigzagPath(id, rank, { x: 100, y: 10 });

function pipelinesOfDraws(backend: FakeGpuBackend): string[] {
  let pipeline = '';
  const result: string[] = [];
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method === 'draw') result.push(pipeline);
  }
  return result;
}

function batchBufferBytes(backend: FakeGpuBackend): number[] {
  return backend.buffers
    .filter((buffer) => !buffer.isDestroyed && buffer.label.includes('batch'))
    .map((buffer) => buffer.byteLength);
}

describe('PathBatches', () => {
  it('draws a planned entry batched each time it is asked, as a layer does once per tile', () => {
    const backend = new FakeGpuBackend();
    const pass = createPathPass({ meshBuilder: INLINE_MESH_BUILDER, isBatched: true });
    const renderer = new SceneRenderer(backend, {
      culler: new AllVisibleCuller(),
      passes: [
        {
          ...pass,
          createDrawer(setup) {
            const drawer = pass.createDrawer?.(setup);
            if (!drawer) throw new Error('Expected the path drawer');
            // Two tiles: the same entry twice in one frame.
            return Object.assign(Object.create(drawer) as typeof drawer, {
              drawEntry: (...args: Parameters<typeof drawer.drawEntry>) => {
                drawer.drawEntry(...args);
                drawer.drawEntry(...args);
              },
            });
          },
        },
      ],
    });
    const document = new FakeSceneDocument();
    document.create(stroke('a', 0), stroke('b', 1), stroke('c', 2));
    renderer.enqueue(document.takeChanges());
    const stats = renderer.renderFrame({ camera: PATH_CAMERA, timeMs: 0 });
    expect(pipelinesOfDraws(backend)).toEqual(['path batched stroke', 'path batched stroke']);
    expect(stats.drawCalls).toBe(2);
    renderer.destroy();
  });

  it('splits runs at the batch cap and draws a stroke larger than a batch on its own', () => {
    // Each zigzag stroke is 42 vertices, 504 bytes batched: two fit under 1,100 bytes.
    const scene = createPathScene({ isBatched: true, meshPageBytes: 1100 });
    for (let index = 0; index < 5; index += 1)
      scene.document.create(stroke(`p${String(index)}`, index));
    scene.frame();
    expect(pipelinesOfDraws(scene.backend)).toEqual([
      'path batched stroke',
      'path batched stroke',
      'path batched stroke',
    ]);
    expect(batchBufferBytes(scene.backend).every((bytes) => bytes <= 1100)).toBe(true);
    scene.renderer.destroy();

    const small = createPathScene({ isBatched: true, meshPageBytes: 256 });
    for (let index = 0; index < 3; index += 1)
      small.document.create(stroke(`q${String(index)}`, index));
    small.frame();
    expect(pipelinesOfDraws(small.backend)).toEqual(['path stroke', 'path stroke', 'path stroke']);
    expect(batchBufferBytes(small.backend)).toEqual([]);
    small.renderer.destroy();
  });
});

it('re-syncs move indices for a new placement binding that reuses the index array', () => {
  const scene = createPathScene({ isBatched: true, maxMeshSegmentsPerFrame: Infinity });
  scene.document.create(stroke('a', 0), stroke('b', 1));
  scene.frame();
  const passes = Reflect.get(scene.renderer, 'passes') as { drawer?: PathDrawer }[];
  const drawer = passes.find((pass) => pass.drawer)?.drawer;
  if (!drawer?.recordTexture) throw new Error('Expected the batched path drawer');
  const slots = ['a', 'b'].map(
    (id) => scene.renderer.scene.slotsOf(id as ObjectId, 'path')[0] ?? 0,
  );
  const indexData = new Float32Array(Math.max(...slots) + 1);
  for (const slot of slots) indexData[slot] = 1;
  const indices = scene.backend.createBuffer({ usage: 'vertex', byteLength: indexData.byteLength });
  const table = new TransformTable(scene.backend, 2);
  table.set(1, { x: 10, y: 10, cos: 1, sin: 0 });
  table.set(2, { x: 20, y: 20, cos: 1, sin: 0 });
  table.flush();
  drawer.setMovePlacement({ table, indices, indexData });
  scene.frame();
  for (const slot of slots) expect(drawer.recordTexture.texelsOf(slot)[11]).toBe(1);
  // The same array with new indices, in a new binding.
  for (const slot of slots) indexData[slot] = 2;
  drawer.setMovePlacement({ table, indices, indexData });
  scene.frame();
  for (const slot of slots) expect(drawer.recordTexture.texelsOf(slot)[11]).toBe(2);
  drawer.setMovePlacement(undefined);
  scene.frame();
  for (const slot of slots) expect(drawer.recordTexture.texelsOf(slot)[11]).toBe(0);
  scene.renderer.destroy();
  table.destroy();
  indices.destroy();
});

it('keeps strokes that leave the viewport in their batch through a retained move', () => {
  const scene = createPathScene({ isBatched: true, maxMeshSegmentsPerFrame: Infinity });
  const ids = Array.from({ length: 30 }, (unused, index) => `p${String(index)}`);
  ids.forEach((id, index) => {
    scene.document.create(stroke(id, index));
  });
  scene.frame();
  const passes = Reflect.get(scene.renderer, 'passes') as { drawer?: PathDrawer }[];
  const drawer = passes.find((pass) => pass.drawer)?.drawer;
  if (!drawer) throw new Error('Expected the batched path drawer');
  const plansOf = (): number => drawer.batchCounts?.plans ?? Number.NaN;
  const slots = ids.map((id) => scene.renderer.scene.slotsOf(id as ObjectId, 'path')[0] ?? 0);
  const indexData = new Float32Array(Math.max(...slots) + 1);
  slots.forEach((slot, index) => {
    indexData[slot] = index + 1;
  });
  const indices = scene.backend.createBuffer({ usage: 'vertex', byteLength: indexData.byteLength });
  const table = new TransformTable(scene.backend, ids.length);
  const place = (frame: number): void => {
    // Spread across the 400 px viewport and moving right: more leave it every frame.
    for (let index = 0; index < ids.length; index += 1) {
      table.set(index + 1, { x: index * 12 + frame * 37, y: 10, cos: 1, sin: 0 });
    }
    table.flush();
  };
  place(0);
  drawer.setMovePlacement({ table, indices, indexData });
  scene.frame();
  const plans = plansOf();
  for (let frame = 1; frame <= 6; frame += 1) {
    place(frame);
    scene.backend.resetCalls();
    scene.frame();
    expect(plansOf()).toBe(plans);
    expect(pipelinesOfDraws(scene.backend)).toEqual(['path batched move stroke']);
  }
  // After the move the records' own placements (all on screen) draw again.
  drawer.setMovePlacement(undefined);
  scene.backend.resetCalls();
  scene.frame();
  expect(pipelinesOfDraws(scene.backend)).toEqual(['path batched stroke']);
  for (const slot of slots) expect(drawer.recordTexture?.texelsOf(slot)[11]).toBe(0);
  scene.renderer.destroy();
  table.destroy();
  indices.destroy();
});
