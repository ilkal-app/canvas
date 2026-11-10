import { describe, expect, it, vi } from 'vitest';

import type { ObjectId, PathObject } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import { TransformTable } from '../gpu/transform-table.js';
import type { FakeGpuBackend, FakeGpuCall } from '../scene/__fixtures__/fake-gpu-backend.js';

import { createPathScene, PATH_CAMERA, zigzagPath } from './__fixtures__/path-scene.js';

const OPTIONS = { isBatched: true, maxMeshSegmentsPerFrame: Infinity };
type Scene = ReturnType<typeof createPathScene>;
interface Counts {
  readonly plans: number;
  readonly syncedSlots: number;
}

function stroke(id: string, rank: number, fields: Partial<PathObject> = {}): PathObject {
  return zigzagPath(id, rank, { x: 100, y: 10, ...fields });
}

function drawerOf(scene: Scene): object {
  const passes = Reflect.get(scene.renderer, 'passes') as { drawer?: object }[];
  const drawer = passes.find((pass) => pass.drawer)?.drawer;
  if (!drawer) throw new Error('Path drawer missing');
  return drawer;
}

function countsOf(scene: Scene): Counts {
  const counts = Reflect.get(drawerOf(scene), 'batchCounts') as Counts | undefined;
  if (!counts) throw new Error('PathDrawer.batchCounts must report batch work');
  return counts;
}

function texelsOf(scene: Scene, id: string): number[] {
  const texture = Reflect.get(drawerOf(scene), 'recordTexture') as {
    texelsOf(slot: number): Float32Array;
  };
  return [...texture.texelsOf(slotOf(scene, id))];
}

function slotOf(scene: Scene, id: string): number {
  const slot = scene.renderer.scene.slotsOf(id as ObjectId, 'path')[0];
  if (slot === undefined) throw new Error(`No path slot for ${id}`);
  return slot;
}

function recordOf(scene: Scene, id: string): number[] {
  const buffer = scene.renderer.scene.instanceBuffers.get('path');
  if (!buffer) throw new Error('Path instances missing');
  const start = slotOf(scene, id) * buffer.layout.floatsPerRecord;
  return [...buffer.data.slice(start, start + buffer.layout.floatsPerRecord)];
}

function drawsOf(calls: readonly FakeGpuCall[]): { pipeline: string; vertices: number }[] {
  let pipeline = '';
  const draws: { pipeline: string; vertices: number }[] = [];
  for (const call of calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method === 'draw') draws.push({ pipeline, vertices: call.vertexCount });
  }
  return draws;
}

function batchCalls(backend: FakeGpuBackend): FakeGpuCall[] {
  return backend.calls.filter(
    (call) =>
      (call.method === 'createBuffer' || call.method === 'writeBuffer') &&
      /batch/i.test(call.label),
  );
}

function captureBatches(backend: FakeGpuBackend): () => number[][] {
  const values = new Map<GpuBuffer, number[]>();
  const original = backend.writeBuffer.bind(backend);
  vi.spyOn(backend, 'writeBuffer').mockImplementation((buffer, offset, data) => {
    if (/batch/i.test((buffer as GpuBuffer & { label: string }).label)) {
      expect(offset).toBe(0);
      values.set(buffer, [
        ...new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
      ]);
    }
    original(buffer, offset, data);
  });
  return () =>
    backend.buffers
      .filter((buffer) => !buffer.isDestroyed && /batch/i.test(buffer.label))
      .map((buffer) => values.get(buffer) ?? []);
}

function batchSlots(batches: readonly number[][]): number[] {
  const slots: number[] = [];
  for (const data of batches) {
    for (let index = 2; index < data.length; index += 3) {
      const slot = data[index];
      if (slot !== undefined && slot !== slots[slots.length - 1]) slots.push(slot);
    }
  }
  return slots;
}

function assertRecordPlacement(scene: Scene, ids: readonly string[]): void {
  for (const id of ids)
    expect(texelsOf(scene, id).slice(0, 4)).toEqual(recordOf(scene, id).slice(0, 4));
}

function expectReplan(scene: Scene, before: Counts): void {
  expect(countsOf(scene).plans).toBeGreaterThan(before.plans);
}

function expectBatchedVertices(scene: Scene, count: number): void {
  const draws = drawsOf(scene.backend.calls);
  expect(draws.length).toBeGreaterThan(0);
  expect(draws.every(({ pipeline }) => pipeline === 'path batched stroke')).toBe(true);
  expect(draws.reduce((total, draw) => total + draw.vertices, 0)).toBe(count);
}

describe('keeping the opaque path batch plan', () => {
  it('keeps 200 moved strokes in the same batch and syncs exactly their slots', () => {
    const scene = createPathScene(OPTIONS);
    const ids: string[] = [];
    for (let rank = 0; rank < 200; rank += 1) ids.push(`p${String(rank)}`);
    for (const [rank, id] of ids.entries()) scene.document.create(stroke(id, rank));
    scene.frame();
    const initialDraws = drawsOf(scene.backend.calls);
    expect(initialDraws.every(({ pipeline }) => /batch/i.test(pipeline))).toBe(true);
    for (let frame = 1; frame <= 3; frame += 1) {
      const before = countsOf(scene);
      for (const [rank, id] of ids.entries())
        scene.document.update(id, { x: 100 + frame * 5 + rank });
      scene.backend.resetCalls();
      scene.frame();
      expect(countsOf(scene)).toEqual({
        plans: before.plans,
        syncedSlots: before.syncedSlots + 200,
      });
      expect(batchCalls(scene.backend)).toEqual([]);
      assertRecordPlacement(scene, ids);
      expect(drawsOf(scene.backend.calls)).toEqual(initialDraws);
    }
    scene.renderer.destroy();
  });

  it('syncs only three changed slots, then does no work on a camera-only frame', () => {
    const scene = createPathScene(OPTIONS);
    for (let rank = 0; rank < 200; rank += 1)
      scene.document.create(stroke(`p${String(rank)}`, rank));
    scene.frame();
    const before = countsOf(scene);
    for (const rank of [3, 50, 197]) scene.document.update(`p${String(rank)}`, { x: 120 + rank });
    scene.frame();
    expect(countsOf(scene)).toEqual({ plans: before.plans, syncedSlots: before.syncedSlots + 3 });
    scene.backend.resetCalls();
    const still = countsOf(scene);
    scene.frame({ ...PATH_CAMERA, x: 1 });
    expect(countsOf(scene)).toEqual(still);
    expect(
      scene.backend.calls.filter(
        (call) => call.method === 'writeTexture' && call.label.includes('records'),
      ),
    ).toEqual([]);
    scene.renderer.destroy();
  });

  it('keeps an opaque recolour but rebuilds for a stroke-width mesh change', () => {
    const scene = createPathScene(OPTIONS);
    const batches = captureBatches(scene.backend);
    for (let rank = 0; rank < 3; rank += 1) scene.document.create(stroke(`p${String(rank)}`, rank));
    scene.frame();
    const originalVertices = batches();
    const before = countsOf(scene);
    scene.document.update('p1', { stroke: { color: [1, 0.25, 0, 1], width: 4 } });
    scene.backend.resetCalls();
    scene.frame();
    expect(countsOf(scene).plans).toBe(before.plans);
    expect(texelsOf(scene, 'p1').slice(4, 8)).toEqual([1, 0.25, 0, 1]);
    expect(batchCalls(scene.backend)).toEqual([]);
    const recoloured = countsOf(scene);
    scene.document.update('p1', { stroke: { color: [1, 0.25, 0, 1], width: 8 } });
    scene.frame();
    expectReplan(scene, recoloured);
    expect(batches()).not.toEqual(originalVertices);
    expect(drawsOf(scene.backend.calls).every(({ pipeline }) => /batch/i.test(pipeline))).toBe(
      true,
    );
    scene.renderer.destroy();
  });

  it('splits and rejoins a run when stroke opacity flips', () => {
    const scene = createPathScene(OPTIONS);
    const batches = captureBatches(scene.backend);
    for (let rank = 0; rank < 3; rank += 1) scene.document.create(stroke(`p${String(rank)}`, rank));
    scene.frame();
    let before = countsOf(scene);
    scene.document.update('p1', { stroke: { color: [0, 0, 0, 0.5], width: 4 } });
    scene.backend.resetCalls();
    scene.frame();
    expectReplan(scene, before);
    expect(drawsOf(scene.backend.calls).map(({ pipeline }) => pipeline)).toEqual([
      expect.stringMatching(/batch/i),
      'path stroke once',
      'path stencil clear',
      expect.stringMatching(/batch/i),
    ]);
    expect(batchSlots(batches())).toEqual([slotOf(scene, 'p0'), slotOf(scene, 'p2')]);
    before = countsOf(scene);
    scene.document.update('p1', { stroke: { color: [0, 0, 0, 1], width: 4 } });
    scene.backend.resetCalls();
    scene.frame();
    expectReplan(scene, before);
    expectBatchedVertices(scene, 126);
    scene.renderer.destroy();
  });

  it('re-plans for creation, deletion, compaction and a chord LOD switch', () => {
    const scene = createPathScene(OPTIONS);
    const batches = captureBatches(scene.backend);
    scene.document.create(stroke('a', 0), stroke('c', 2), stroke('d', 3));
    scene.frame();
    let before = countsOf(scene);
    scene.document.create(stroke('b', 1));
    scene.backend.resetCalls();
    scene.frame();
    expectReplan(scene, before);
    expect(batchSlots(batches())).toEqual(['a', 'b', 'c', 'd'].map((id) => slotOf(scene, id)));
    before = countsOf(scene);
    scene.document.delete('c');
    scene.backend.resetCalls();
    scene.frame();
    expectReplan(scene, before);
    expectBatchedVertices(scene, 126);
    before = countsOf(scene);
    scene.renderer.scene.compactSlots('path', ['d', 'b', 'a'] as ObjectId[]);
    scene.backend.resetCalls();
    scene.frame();
    expectReplan(scene, before);
    expect(batchSlots(batches())).toEqual(['a', 'b', 'd'].map((id) => slotOf(scene, id)));
    before = countsOf(scene);
    scene.backend.resetCalls();
    scene.frame({ ...PATH_CAMERA, zoom: 0.05 });
    expectReplan(scene, before);
    expect(drawsOf(scene.backend.calls).length).toBeGreaterThan(0);
    before = countsOf(scene);
    scene.backend.resetCalls();
    scene.frame(PATH_CAMERA);
    expectReplan(scene, before);
    expectBatchedVertices(scene, 126);
    scene.renderer.destroy();
  });

  it('keeps the plan and texels on retained-move revisions, restoring move indices on end', () => {
    const scene = createPathScene(OPTIONS);
    scene.document.create(stroke('a', 0), stroke('b', 1));
    scene.frame();
    const slots = ['a', 'b'].map((id) => slotOf(scene, id));
    const indexData = new Float32Array(Math.max(...slots) + 1);
    for (const slot of slots) indexData[slot] = 1;
    const indices = scene.backend.createBuffer({
      usage: 'vertex',
      byteLength: indexData.byteLength,
    });
    scene.backend.writeBuffer(indices, 0, indexData);
    const table = new TransformTable(scene.backend, 1);
    const drawer = drawerOf(scene) as { setMovePlacement(placement: unknown): void };
    table.set(1, { x: 10, y: 10, cos: 1, sin: 0 });
    table.flush();
    drawer.setMovePlacement({ table, indices, indexData });
    scene.frame();
    const started = countsOf(scene);
    for (let frame = 1; frame <= 3; frame += 1) {
      table.set(1, { x: 10 + frame, y: 10, cos: 1, sin: 0 });
      table.flush();
      scene.backend.resetCalls();
      scene.frame();
      expect(countsOf(scene)).toEqual(started);
      expect(drawsOf(scene.backend.calls).map(({ pipeline }) => pipeline)).toEqual([
        'path batched move stroke',
      ]);
      for (const id of ['a', 'b']) expect(texelsOf(scene, id)[11]).toBe(1);
    }
    drawer.setMovePlacement(undefined);
    scene.backend.resetCalls();
    scene.frame();
    for (const id of ['a', 'b']) expect(texelsOf(scene, id)[11]).toBe(0);
    expect(drawsOf(scene.backend.calls).map(({ pipeline }) => pipeline)).toEqual([
      'path batched stroke',
    ]);
    scene.renderer.destroy();
    table.destroy();
    indices.destroy();
  });
});

it('matches a forced re-plan after each of 60 seeded document and camera frames', () => {
  const scene = createPathScene(OPTIONS);
  const reference = createPathScene(OPTIONS);
  const actualBatches = captureBatches(scene.backend);
  const expectedBatches = captureBatches(reference.backend);
  const paths = new Map<string, PathObject>();
  for (let rank = 0; rank < 12; rank += 1) {
    const path = stroke(`p${String(rank)}`, rank);
    paths.set(path.id, path);
    scene.document.create(path);
    reference.document.create(path);
  }
  scene.frame();
  reference.frame();
  countsOf(scene);
  let seed = 540;
  const random = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  let nextRank = 12;
  for (let frame = 0; frame < 60; frame += 1) {
    const ids = [...paths.keys()];
    const operation = Math.floor(random() * 5);
    const id = ids[Math.floor(random() * ids.length)] ?? 'p0';
    const path = paths.get(id);
    if (!path) throw new Error(`Missing random path ${id}`);
    let camera: Camera = PATH_CAMERA;
    if (operation === 0) {
      const x = 70 + Math.floor(random() * 100);
      scene.document.update(id, { x });
      reference.document.update(id, { x });
      paths.set(id, { ...path, x });
    } else if (operation === 1) {
      const color: [number, number, number, number] = [
        random(),
        0.2,
        0.4,
        random() < 0.5 ? 1 : 0.5,
      ];
      const updated = { stroke: { color, width: 4 } };
      scene.document.update(id, updated);
      reference.document.update(id, updated);
      paths.set(id, { ...path, ...updated });
    } else if (operation === 2) {
      const path = stroke(`p${String(nextRank)}`, nextRank);
      nextRank += 1;
      paths.set(path.id, path);
      scene.document.create(path);
      reference.document.create(path);
    } else if (operation === 3 && ids.length > 2) {
      paths.delete(id);
      scene.document.delete(id);
      reference.document.delete(id);
    } else {
      camera = { ...PATH_CAMERA, x: Math.floor(random() * 4) };
    }
    scene.backend.resetCalls();
    scene.frame(camera);
    const beforeReference = countsOf(reference);
    const batches = Reflect.get(drawerOf(reference), 'batches') as { invalidate(): void };
    batches.invalidate();
    reference.backend.resetCalls();
    reference.frame(camera);
    expectReplan(reference, beforeReference);
    expect(drawsOf(scene.backend.calls), `draw stream on frame ${String(frame)}`).toEqual(
      drawsOf(reference.backend.calls),
    );
    expect(actualBatches(), `batch vertices on frame ${String(frame)}`).toEqual(expectedBatches());
  }
  scene.renderer.destroy();
  reference.renderer.destroy();
});
