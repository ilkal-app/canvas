import { describe, expect, it, vi } from 'vitest';

import type { ObjectId, PathObject } from '@canvas/schema';

import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import { TransformTable } from '../gpu/transform-table.js';
import { FakeGpuBackend, type FakeGpuCall } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { AllVisibleCuller } from '../scene/scene-culler.js';
import type { ScenePassDrawer } from '../scene/scene-pass-drawer.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { createPathScene, PATH_CAMERA, squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { PATH_MESH_PAGE_BYTES } from './path-mesh-arena.js';
import { INLINE_MESH_BUILDER } from './path-mesh-builder.js';
import { createPathPass } from './path-pass.js';

interface RecordedWrite {
  readonly label: string;
  readonly offset: number;
  readonly data: Float32Array;
}
const batchedOptions = { isBatched: true, maxMeshSegmentsPerFrame: Infinity };

function captureWrites(backend: FakeGpuBackend): RecordedWrite[] {
  const writes: RecordedWrite[] = [];
  const original = backend.writeBuffer.bind(backend);
  vi.spyOn(backend, 'writeBuffer').mockImplementation((buffer, offset, data) => {
    writes.push({
      label: (buffer as GpuBuffer & { label: string }).label,
      offset,
      data: new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    });
    original(buffer, offset, data);
  });
  return writes;
}

function stroke(id: string, rank: number, fields: Partial<PathObject> = {}): PathObject {
  return zigzagPath(id, rank, { x: 100, y: 10, ...fields });
}

function load(scene: ReturnType<typeof createPathScene>, paths: readonly PathObject[]): void {
  // Create in paint order so the path pass gets one draw-list entry.
  for (const path of paths) scene.document.create(path);
  scene.frame();
}

function batchWrites(writes: readonly RecordedWrite[]): RecordedWrite[] {
  return writes.filter(({ label }) => /batch/i.test(label));
}

function pipelineDraws(
  calls: readonly FakeGpuCall[],
): { pipeline: string; draw: Extract<FakeGpuCall, { method: 'draw' }> }[] {
  let pipeline = '';
  const result: { pipeline: string; draw: Extract<FakeGpuCall, { method: 'draw' }> }[] = [];
  for (const call of calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method === 'draw') result.push({ pipeline, draw: call });
  }
  return result;
}

function recordsOf(
  scene: ReturnType<typeof createPathScene>,
  id: string,
): { slot: number; values: number[] } {
  const slot = scene.renderer.scene.slotsOf(id as ObjectId, 'path')[0];
  if (slot === undefined) throw new Error(`No path slot for ${id}`);
  const instances = scene.renderer.scene.instanceBuffers.get('path');
  if (!instances) throw new Error('No path instance buffer');
  const start = slot * instances.layout.floatsPerRecord;
  return {
    slot,
    values: [...instances.data.slice(start, start + instances.layout.floatsPerRecord)],
  };
}

function batchVertices(writes: readonly RecordedWrite[]): number[] {
  return batchWrites(writes).flatMap(({ data }) => [...data]);
}

describe('batched opaque path strokes', () => {
  it.each([200, 4000])('draws %i visible opaque strokes within the batch page bound', (count) => {
    const scene = createPathScene(batchedOptions);
    const writes = captureWrites(scene.backend);
    for (let index = 0; index < count; index += 1) {
      scene.document.create(stroke(`p${String(index)}`, index));
    }
    scene.renderer.enqueue(scene.document.takeChanges());
    const stats = scene.renderer.renderFrame({ camera: PATH_CAMERA, timeMs: 0 });
    const batches = batchWrites(writes);
    expect(batches.length).toBeGreaterThan(0);
    const batchBytes = batches.reduce((sum, write) => sum + write.data.byteLength, 0);
    const draws = pipelineDraws(scene.backend.calls);
    expect(draws.every(({ pipeline }) => /batch/i.test(pipeline))).toBe(true);
    expect(draws.length).toBeLessThanOrEqual(1 + Math.ceil(batchBytes / PATH_MESH_PAGE_BYTES));
    // FrameStats counts exactly the GPU commands, including batches.
    expect(stats.drawCalls).toBe(draws.length);
    scene.renderer.destroy();
  });

  it('preserves mixed run order and the existing fill and translucent stencil sequences', () => {
    const scene = createPathScene(batchedOptions);
    const writes = captureWrites(scene.backend);
    load(scene, [
      stroke('a', 0),
      stroke('b', 1),
      squarePath('fill', 2, { x: 100, y: 10, stroke: null }),
      stroke('c', 3),
      stroke('d', 4),
      stroke('alpha', 5, { stroke: { color: [0, 0, 0, 0.5], width: 4 } }),
      stroke('e', 6),
      stroke('f', 7),
    ]);
    expect(pipelineDraws(scene.backend.calls).map(({ pipeline }) => pipeline)).toEqual([
      expect.stringMatching(/batch/i),
      'path fill stencil',
      'path fill cover',
      expect.stringMatching(/batch/i),
      'path stroke once',
      'path stencil clear',
      expect.stringMatching(/batch/i),
    ]);
    const slots = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => recordsOf(scene, id).slot);
    const actualSlots = batchVertices(writes).filter((value, index) => index % 3 === 2);
    expect([...new Set(actualSlots)]).toEqual(slots);
    const meshWrites = writes.filter(({ label }) => label === 'path mesh');
    const expected: number[] = [];
    for (const [index, slot] of [
      [0, slots[0]],
      [1, slots[1]],
      [3, slots[2]],
      [4, slots[3]],
      [6, slots[4]],
      [7, slots[5]],
    ] as const) {
      const floats = meshWrites[index]?.data.slice(12) ?? new Float32Array();
      for (let vertex = 0; vertex < floats.length / 2; vertex += 1) {
        expected.push(floats[vertex * 2] ?? NaN, floats[vertex * 2 + 1] ?? NaN, slot ?? NaN);
      }
    }
    expect(batchVertices(writes)).toEqual(expected);
    scene.renderer.destroy();
  });

  it('copies each stroke vertex from the mesh in slot order with its record slot', () => {
    const scene = createPathScene(batchedOptions);
    const writes = captureWrites(scene.backend);
    load(scene, [stroke('a', 0), stroke('b', 1), stroke('c', 2)]);
    const mesh = writes.filter(({ label }) => label === 'path mesh');
    const batch = batchVertices(writes);
    const slots = ['a', 'b', 'c'].map((id) => recordsOf(scene, id).slot);
    expect(mesh).toHaveLength(3);
    expect(batch.length % 3).toBe(0);
    let cursor = 0;
    for (let index = 0; index < mesh.length; index += 1) {
      // Stroke-only path meshes start with their six cover vertices.
      const strokeFloats = mesh[index]?.data.slice(12) ?? new Float32Array();
      for (let vertex = 0; vertex < strokeFloats.length / 2; vertex += 1) {
        expect(batch.slice(cursor, cursor + 3)).toEqual([
          strokeFloats[vertex * 2],
          strokeFloats[vertex * 2 + 1],
          slots[index],
        ]);
        cursor += 3;
      }
    }
    expect(cursor).toBe(batch.length);
    scene.renderer.destroy();
  });

  it('updates record texels on a move and recolour without rewriting the batch, then breaks on alpha', () => {
    const scene = createPathScene(batchedOptions);
    const writes = captureWrites(scene.backend);
    load(scene, [stroke('a', 0), stroke('b', 1), stroke('c', 2)]);
    const drawer = (Reflect.get(scene.renderer, 'passes') as { drawer?: object }[]).find(
      (pass) => pass.drawer,
    )?.drawer;
    const texture =
      drawer &&
      (Reflect.get(drawer, 'recordTexture') as
        { texelsOf(slot: number): Float32Array; readonly revision: number } | undefined);
    if (!texture) throw new Error('PathRecordTexture is missing from the path drawer');
    expect(texture.constructor.name).toBe('PathRecordTexture');
    const { slot, values } = recordsOf(scene, 'b');
    expect([...texture.texelsOf(slot)]).toEqual([...values.slice(0, 8), 0, 0, 0, 0]);
    const revision = texture.revision;
    writes.length = 0;
    scene.backend.resetCalls();
    scene.document.update('b', { x: 150, stroke: { color: [1, 0.25, 0, 1], width: 4 } });
    scene.frame();
    expect(texture.revision).toBeGreaterThan(revision);
    expect([...texture.texelsOf(slot)].slice(0, 8)).toEqual(
      recordsOf(scene, 'b').values.slice(0, 8),
    );
    expect(batchWrites(writes)).toHaveLength(0);
    scene.document.update('b', { stroke: { color: [1, 0.25, 0, 0.5], width: 4 } });
    writes.length = 0;
    scene.backend.resetCalls();
    scene.frame();
    expect(batchWrites(writes).length).toBeGreaterThan(0);
    expect(pipelineDraws(scene.backend.calls).map(({ pipeline }) => pipeline)).toEqual([
      expect.stringMatching(/batch/i),
      'path stroke once',
      'path stencil clear',
      expect.stringMatching(/batch/i),
    ]);
    scene.renderer.destroy();
  });

  it('rebuilds the cached batch with new slots after scene compaction', () => {
    const scene = createPathScene(batchedOptions);
    const writes = captureWrites(scene.backend);
    load(scene, [stroke('a', 0), stroke('b', 1), stroke('c', 2)]);
    const oldSlots = ['a', 'b', 'c'].map((id) => recordsOf(scene, id).slot);
    scene.renderer.scene.compactSlots('path', ['c', 'b', 'a'] as ObjectId[]);
    writes.length = 0;
    scene.backend.resetCalls();
    scene.frame();
    const newSlots = ['a', 'b', 'c'].map((id) => recordsOf(scene, id).slot);
    expect(newSlots).not.toEqual(oldSlots);
    expect(batchWrites(writes).length).toBeGreaterThan(0);
    expect([...new Set(batchVertices(writes).filter((value, index) => index % 3 === 2))]).toEqual(
      newSlots,
    );
    scene.renderer.destroy();
  });
});

it('uses the batched move pipeline and stores the retained move index in texel 2', () => {
  const backend = new FakeGpuBackend();
  const pass = createPathPass({ meshBuilder: INLINE_MESH_BUILDER, isBatched: true });
  let drawer: ScenePassDrawer | undefined;
  const renderer = new SceneRenderer(backend, {
    culler: new AllVisibleCuller(),
    passes: [
      {
        ...pass,
        createDrawer(setup) {
          drawer = pass.createDrawer?.(setup);
          if (!drawer) throw new Error('Expected the path drawer');
          return drawer;
        },
      },
    ],
  });
  const document = new FakeSceneDocument();
  document.create(stroke('a', 0), stroke('b', 1));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ camera: PATH_CAMERA, timeMs: 0 });
  const slots = ['a', 'b'].map((id) => {
    const slot = renderer.scene.slotsOf(id as ObjectId, 'path')[0];
    if (slot === undefined) throw new Error(`No path slot for ${id}`);
    return slot;
  });
  const indexData = new Float32Array(Math.max(...slots) + 1);
  for (const slot of slots) indexData[slot] = 1;
  const indices = backend.createBuffer({ usage: 'vertex', byteLength: indexData.byteLength });
  backend.writeBuffer(indices, 0, indexData);
  const table = new TransformTable(backend, 1);
  table.set(1, { x: 10, y: 10, cos: 1, sin: 0 });
  table.flush();
  drawer?.setMovePlacement?.({ table, indices, indexData });
  backend.resetCalls();
  renderer.renderFrame({ camera: PATH_CAMERA, timeMs: 0 });
  expect(pipelineDraws(backend.calls).map(({ pipeline }) => pipeline)).toEqual([
    expect.stringMatching(/batch.*move|move.*batch/i),
  ]);
  const texture =
    drawer &&
    (Reflect.get(drawer, 'recordTexture') as { texelsOf(slot: number): Float32Array } | undefined);
  if (!texture) throw new Error('PathRecordTexture is missing from the path drawer');
  for (const slot of slots) expect(texture.texelsOf(slot)[11]).toBe(1);
  renderer.destroy();
  table.destroy();
  indices.destroy();
});
