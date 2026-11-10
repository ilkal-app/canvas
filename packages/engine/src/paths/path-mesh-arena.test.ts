import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { PathMeshArena } from './path-mesh-arena.js';

// Path meshes share vertex buffers, so a zoomed-out frame binds a buffer per page of
// meshes rather than one per path, and draws each mesh at its first vertex.

/**
 * A mesh's vertices: `count` vertices of `x, y`.
 *
 * @param count - Its vertex count.
 * @returns The vertices.
 */
function vertices(count: number): Float32Array<ArrayBuffer> {
  return new Float32Array(count * 2);
}

/** 1 KiB pages: 128 vertices of 8 bytes. */
const PAGE_BYTES = 1024;

describe('PathMeshArena', () => {
  it('places meshes side by side in one buffer, each at its first vertex', () => {
    const backend = new FakeGpuBackend();
    const arena = new PathMeshArena(backend, 'paths mesh', PAGE_BYTES);
    const first = arena.place(vertices(10));
    const second = arena.place(vertices(20));
    expect(second.buffer).toBe(first.buffer);
    expect([first.firstVertex, second.firstVertex]).toEqual([0, 10]);
    expect(backend.writes().map(({ byteOffset, byteLength }) => [byteOffset, byteLength])).toEqual([
      [0, 80],
      [80, 160],
    ]);
    expect(backend.calls.filter(({ method }) => method === 'createBuffer')).toHaveLength(1);
    expect(arena.byteLength).toBe(PAGE_BYTES);
  });

  it('reuses freed room, merging neighbours, and opens a page when none has room', () => {
    const backend = new FakeGpuBackend();
    const arena = new PathMeshArena(backend, 'paths mesh', PAGE_BYTES);
    const [a, b, c] = [
      arena.place(vertices(40)),
      arena.place(vertices(40)),
      arena.place(vertices(40)),
    ];
    arena.release(a);
    arena.release(b);
    // a and b merged: 80 vertices at 0.
    const merged = arena.place(vertices(70));
    expect([merged.buffer, merged.firstVertex]).toEqual([c.buffer, 0]);
    const next = arena.place(vertices(60));
    expect(next.buffer).not.toBe(c.buffer);
    expect(next.firstVertex).toBe(0);
    expect(arena.byteLength).toBe(2 * PAGE_BYTES);
  });

  it('merges freed room with both neighbours at once', () => {
    const arena = new PathMeshArena(new FakeGpuBackend(), 'paths mesh', PAGE_BYTES);
    const [a, b, c] = [
      arena.place(vertices(30)),
      arena.place(vertices(30)),
      arena.place(vertices(30)),
    ];
    const kept = arena.place(vertices(30));
    arena.release(a);
    arena.release(c);
    arena.release(b);
    // 0–90 is one run again: a mesh of 90 fits at 0, beside the kept one.
    const merged = arena.place(vertices(90));
    expect([merged.buffer, merged.firstVertex]).toEqual([kept.buffer, 0]);
  });

  it('gives a mesh larger than a page a buffer of its own, freed with it', () => {
    const backend = new FakeGpuBackend();
    const arena = new PathMeshArena(backend, 'paths mesh', PAGE_BYTES);
    const large = arena.place(vertices(500));
    expect(large.firstVertex).toBe(0);
    expect(large.buffer.byteLength).toBe(4000);
    expect(arena.byteLength).toBe(4000);
    arena.release(large);
    expect((large.buffer as { isDestroyed?: boolean }).isDestroyed).toBe(true);
    expect(arena.byteLength).toBe(0);
  });

  it('frees a page once its last mesh goes, and everything on destroy', () => {
    const backend = new FakeGpuBackend();
    const arena = new PathMeshArena(backend, 'paths mesh', PAGE_BYTES);
    const one = arena.place(vertices(5));
    const two = arena.place(vertices(5));
    arena.release(one);
    expect((one.buffer as { isDestroyed?: boolean }).isDestroyed).toBe(false);
    arena.release(two);
    expect((two.buffer as { isDestroyed?: boolean }).isDestroyed).toBe(true);
    expect(arena.byteLength).toBe(0);
    const three = arena.place(vertices(5));
    arena.destroy();
    expect((three.buffer as { isDestroyed?: boolean }).isDestroyed).toBe(true);
    expect(arena.byteLength).toBe(0);
  });

  it('ignores a placement released twice', () => {
    const arena = new PathMeshArena(new FakeGpuBackend(), 'paths mesh', PAGE_BYTES);
    const kept = arena.place(vertices(5));
    const gone = arena.place(vertices(5));
    arena.release(gone);
    arena.release(gone);
    const again = arena.place(vertices(5));
    expect(again.firstVertex).toBe(5);
    expect(again.buffer).toBe(kept.buffer);
  });
});
