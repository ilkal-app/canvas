import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ClipRect } from '../spatial/clip-chain.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { ClipTableTexture } from './clip-table-texture.js';
import { ClipTable } from './clip-table.js';

function rect(id: string, x = 0): ClipRect {
  return { id: id as ObjectId, x, y: 0, cos: 1, sin: 0, width: 100, height: 50 };
}

function stats(): { uploadedBytes: number } {
  return { uploadedBytes: 0 };
}

describe('ClipTableTexture', () => {
  it('allocates an rgba32float texture of the table capacity, four texels a slot', () => {
    const backend = new FakeGpuBackend();
    const table = new ClipTable();
    const clips = new ClipTableTexture(backend, table);
    expect(clips.texture).toMatchObject({ format: 'rgba32float', width: table.capacity * 4 });
    expect(clips.texture.height).toBe(1);
    expect(clips.byteLength).toBe(table.capacity * 4 * 16);
  });

  it('uploads only the dirty texels, and nothing when the table is clean', () => {
    const backend = new FakeGpuBackend();
    const table = new ClipTable();
    const clips = new ClipTableTexture(backend, table);
    table.set(rect('a'), undefined, 0);
    table.set(rect('b'), undefined, 0);
    table.clearDirty();
    table.set(rect('b', 7), undefined, 0);
    backend.resetCalls();
    const counters = stats();
    clips.flush(counters);
    expect(backend.calls).toEqual([
      { method: 'writeTexture', label: 'clip-table', byteLength: 64 },
    ]);
    expect(counters.uploadedBytes).toBe(64);
    backend.resetCalls();
    clips.flush(counters);
    expect(backend.calls).toEqual([]);
  });

  it('splits a dirty range at the end of each texture row', () => {
    const backend = new FakeGpuBackend({ maxTextureSize: 6 });
    const table = new ClipTable();
    const clips = new ClipTableTexture(backend, table);
    table.set(rect('a'), undefined, 0);
    const counters = stats();
    clips.flush(counters);
    // Texels 4 to 7: the last two of row 0, then two of row 1.
    expect(backend.calls.filter((call) => call.method === 'writeTexture')).toEqual([
      { method: 'writeTexture', label: 'clip-table', byteLength: 32 },
      { method: 'writeTexture', label: 'clip-table', byteLength: 32 },
    ]);
    expect(counters.uploadedBytes).toBe(64);
  });

  it('replaces the texture when the table grows and writes its used texels once', () => {
    const backend = new FakeGpuBackend();
    const table = new ClipTable();
    const clips = new ClipTableTexture(backend, table);
    const first = clips.texture;
    const capacity = table.capacity;
    for (let index = 1; index <= capacity; index++)
      table.set(rect(`f${String(index)}`), undefined, 0);
    backend.resetCalls();
    clips.flush(stats());
    expect(clips.texture).not.toBe(first);
    expect(backend.liveTextures()).toEqual([clips.texture]);
    expect(clips.texture.width).toBe(table.capacity * 4);
    const writes = backend.calls.filter((call) => call.method === 'writeTexture');
    expect(writes).toEqual([
      { method: 'writeTexture', label: 'clip-table', byteLength: (capacity + 1) * 4 * 16 },
    ]);
  });

  it('keeps a lone zero slot for passes drawn outside a scene', () => {
    const backend = new FakeGpuBackend();
    const clips = new ClipTableTexture(backend);
    expect(clips.texture.width).toBe(4);
    backend.resetCalls();
    clips.flush(stats());
    expect(backend.calls).toEqual([]);
    clips.destroy();
    expect(backend.liveTextures()).toEqual([]);
  });
});
