import { describe, expect, it } from 'vitest';

import { TriangleWriter } from './triangle-writer.js';

describe('TriangleWriter', () => {
  it('grows past its initial room and copies out exactly what was written', () => {
    const writer = new TriangleWriter(6);
    for (let index = 0; index < 5; index += 1) writer.triangle(index, 0, 1, 1, 2, 2);
    writer.append(new Float32Array(60).fill(7));
    expect(writer.floatLength).toBe(90);
    expect(writer.vertexCount).toBe(45);
    const triangles = writer.toFloat32Array();
    expect(triangles).toHaveLength(90);
    expect([...triangles.subarray(24, 30)]).toEqual([4, 0, 1, 1, 2, 2]);
    expect(triangles.at(-1)).toBe(7);
  });

  it('is empty until written', () => {
    expect(new TriangleWriter().toFloat32Array()).toHaveLength(0);
  });
});
