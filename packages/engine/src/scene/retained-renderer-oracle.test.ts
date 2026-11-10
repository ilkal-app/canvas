import { describe, expect, it, vi } from 'vitest';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { SceneRenderer } from './scene-renderer.js';
import { stickyObject } from './segments/__fixtures__/note-and-text-passes.js';
import { worldTransformOf } from './world-transform.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 400, viewportHeightPx: 300 };
const bits = (values: readonly number[]) => [...new Uint32Array(new Float32Array(values).buffer)];

function setup() {
  const backend = new FakeGpuBackend();
  const gpu: GpuBackend = backend;
  const tableData = new Map<GpuTexture, Float32Array>();
  const originalTextureWrite = backend.writeTexture.bind(backend);
  vi.spyOn(gpu, 'writeTexture').mockImplementation((texture, data, region) => {
    originalTextureWrite(texture, data);
    if ((texture as { readonly label?: string }).label !== 'move-transform-table') return;
    const mirror = tableData.get(texture) ?? new Float32Array(texture.width * texture.height * 4);
    const floats = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    mirror.set(floats, ((region?.y ?? 0) * texture.width + (region?.x ?? 0)) * 4);
    tableData.set(texture, mirror);
  });
  const writes = vi.spyOn(gpu, 'writeBuffer');
  const renderer = new SceneRenderer(backend, { passes: [SDF_SHAPE_PASS] });
  const document = new FakeSceneDocument();
  const frame = () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
  return { backend, renderer, document, frame, writes, tableData };
}

describe('retained renderer placement oracle', () => {
  it('matches full preparation bits while keeping geometry records and uploads unchanged', () => {
    const test = setup();
    const { backend, renderer, document, frame, writes, tableData } = test;
    const note = stickyObject('note', { x: 10.123, y: 20.456, rotation: 0.371 });
    const shape = shapeObject('shape', { x: 100.789, y: 70.123, rotation: -0.27 });
    document.create(note, shape);
    renderer.enqueue(document.takeChanges());
    frame();
    const ids = [note.id, shape.id];
    document.update(note.id, { x: 22.456 });
    document.update(shape.id, { x: 122.333 });
    renderer.enqueueRetainedMove(document.takeChanges(), ids);
    frame();
    const instanceBuffer = renderer.scene.instanceBufferOf(SDF_SHAPE_PASS.name);
    const retained = instanceBuffer.data.slice();
    backend.resetCalls();
    document.update(note.id, { x: 33.333333333, y: -16.77777777 });
    document.update(shape.id, { x: 147.13579, y: 90.22222222 });
    renderer.enqueueRetainedMove(document.takeChanges(), ids);
    frame();
    expect(instanceBuffer.data).toEqual(retained);
    expect(backend.writes().filter((write) => write.label === 'sdf-shape instances')).toEqual([]);
    const indexWrite = writes.mock.calls.find(([buffer]) =>
      backend.buffers.some(
        (candidate) => candidate === buffer && candidate.label === 'sdf-shape move indices',
      ),
    );
    expect(indexWrite).toBeDefined();
    const indices = indexWrite?.[2] as Float32Array;
    const table = [...tableData.values()][0];
    expect(table).toBeDefined();
    for (const id of ids) {
      const object = document.get(id);
      if (!object || !table) throw new Error('Expected retained object and table.');
      const target = { object, transform: worldTransformOf(object, document) };
      renderer.scene.slotsOf(id, SDF_SHAPE_PASS.name).forEach((slot, recordIndex) => {
        const expected = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
        SDF_SHAPE_PASS.prepare(expected, target, recordIndex);
        const offset = (indices[slot] ?? 0) * 4;
        expect(bits([...table.subarray(offset, offset + 4)])).toEqual(
          bits([expected[0] ?? 0, expected[1] ?? 0, expected[11] ?? 0, expected[12] ?? 0]),
        );
      });
    }
    document.create(shapeObject('unrelated', { x: 350 }));
    renderer.enqueue(document.takeChanges());
    frame();
    for (const id of ids) {
      const object = document.get(id);
      if (!object) throw new Error('Expected restored object.');
      const target = { object, transform: worldTransformOf(object, document) };
      renderer.scene.slotsOf(id, SDF_SHAPE_PASS.name).forEach((slot, recordIndex) => {
        const expected = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
        SDF_SHAPE_PASS.prepare(expected, target, recordIndex);
        const offset = slot * expected.length;
        expect(instanceBuffer.data.slice(offset, offset + expected.length)).toEqual(expected);
      });
    }
    // The unrelated edit ends the session's overrides, and the session resumes with a new table
    // (a session survives edits that list none of its members).
    const tables = backend.textures.filter((texture) => texture.label === 'move-transform-table');
    expect(tables.slice(0, -1).every((texture) => texture.isDestroyed)).toBe(true);
    expect(tables.at(-1)?.isDestroyed).toBe(false);
    renderer.destroy();
    expect(tables.every((texture) => texture.isDestroyed)).toBe(true);
  });

  it('refuses a custom pass without a move shader before allocating a table', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { passes: [FILLED_RECT_PASS] });
    const document = new FakeSceneDocument();
    const shape = shapeObject('custom');
    document.create(shape);
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    document.update(shape.id, { x: 123 });
    renderer.enqueueRetainedMove(document.takeChanges(), [shape.id]);
    renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    expect(backend.textures.filter((texture) => texture.label === 'move-transform-table')).toEqual(
      [],
    );
    renderer.destroy();
  });
  it('refuses an initially empty custom pass whose record count depends on position', () => {
    const backend = new FakeGpuBackend();
    const pass = {
      ...FILLED_RECT_PASS,
      name: 'position-dependent',
      isRootMoveEmpty: false,
      recordCount: (object: Parameters<typeof FILLED_RECT_PASS.recordCount>[0]) =>
        object.x > 100 ? 1 : 0,
    };
    const renderer = new SceneRenderer(backend, { passes: [SDF_SHAPE_PASS, pass] });
    const document = new FakeSceneDocument();
    const shape = shapeObject('custom', { x: 10 });
    document.create(shape);
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    const ids = [shape.id];
    document.update(shape.id, { x: 20 });
    renderer.enqueueRetainedMove(document.takeChanges(), ids);
    renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    expect(backend.textures.filter((texture) => texture.label === 'move-transform-table')).toEqual(
      [],
    );
    document.update(shape.id, { x: 123 });
    renderer.enqueueRetainedMove(document.takeChanges(), ids);
    renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    expect(renderer.scene.slotsOf(shape.id, pass.name)).toHaveLength(1);
    renderer.destroy();
  });
  it('materializes a previous member when a new move session has different membership', () => {
    const { backend, renderer, document, frame } = setup();
    const first = shapeObject('first', { x: 10 });
    const second = shapeObject('second', { x: 100 });
    document.create(first, second);
    renderer.enqueue(document.takeChanges());
    frame();
    const firstIds = [first.id];
    document.update(first.id, { x: 20 });
    renderer.enqueueRetainedMove(document.takeChanges(), firstIds);
    frame();
    document.update(first.id, { x: 45 });
    renderer.enqueueRetainedMove(document.takeChanges(), firstIds);
    frame();
    document.update(second.id, { x: 110 });
    renderer.enqueueRetainedMove(document.takeChanges(), [second.id]);
    frame();
    const slot = renderer.scene.slotsOf(first.id, SDF_SHAPE_PASS.name)[0];
    if (slot === undefined) throw new Error('Missing first shape slot.');
    const buffer = renderer.scene.instanceBufferOf(SDF_SHAPE_PASS.name);
    expect(buffer.data[slot * buffer.layout.floatsPerRecord]).toBe(45);
    expect(
      backend.textures.filter(
        (texture) => texture.label === 'move-transform-table' && !texture.isDestroyed,
      ),
    ).toHaveLength(1);
    renderer.destroy();
  });

  it('falls back before allocating a placement table that exceeds backend dimensions', () => {
    const backend = new FakeGpuBackend({ maxTextureSize: 2 });
    const renderer = new SceneRenderer(backend, { passes: [SDF_SHAPE_PASS] });
    const document = new FakeSceneDocument();
    const objects = [shapeObject('first'), shapeObject('second')];
    document.create(...objects);
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    for (const object of objects) document.update(object.id, { x: 33 });
    renderer.enqueueRetainedMove(
      document.takeChanges(),
      objects.map(({ id }) => id),
    );
    expect(() => {
      renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
    }).not.toThrow();
    expect(backend.textures.filter((texture) => texture.label === 'move-transform-table')).toEqual(
      [],
    );
    renderer.destroy();
  });
});
