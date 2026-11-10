import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { uploadPathMesh } from './gpu-path-mesh.js';
import { PathMeshArena } from './path-mesh-arena.js';

const RESPONSE = {
  objectId: 'p',
  version: 1,
  bucket: 0,
  fillVertexCount: 3,
  strokeVertexCount: 0,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
};

describe('uploadPathMesh', () => {
  it('copies the vertices into the arena, after the meshes already there', () => {
    const backend = new FakeGpuBackend();
    const arena = new PathMeshArena(backend, 'path mesh');
    const vertices = new Float32Array(18);
    const first = uploadPathMesh(arena, { ...RESPONSE, vertices });
    const second = uploadPathMesh(arena, { ...RESPONSE, vertices });
    expect(first).toMatchObject({ fillVertexCount: 3, strokeVertexCount: 0, byteLength: 72 });
    expect([first.firstVertex, second.firstVertex]).toEqual([0, 9]);
    expect(second.buffer).toBe(first.buffer);
    expect(backend.writes()).toEqual([
      { method: 'writeBuffer', label: 'path mesh', byteOffset: 0, byteLength: 72 },
      { method: 'writeBuffer', label: 'path mesh', byteOffset: 72, byteLength: 72 },
    ]);
  });

  it('creates no buffer for an empty mesh', () => {
    const backend = new FakeGpuBackend();
    const mesh = uploadPathMesh(new PathMeshArena(backend, 'path mesh'), {
      ...RESPONSE,
      fillVertexCount: 0,
      vertices: new Float32Array(0),
      bounds: null,
    });
    expect(mesh).toEqual({
      buffer: undefined,
      placement: undefined,
      firstVertex: 0,
      fillVertexCount: 0,
      strokeVertexCount: 0,
      byteLength: 0,
    });
    expect(backend.buffers).toHaveLength(0);
  });
});
