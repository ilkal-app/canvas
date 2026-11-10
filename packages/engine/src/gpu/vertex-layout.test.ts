import { describe, expect, it } from 'vitest';

import { resolveVertexBufferLayouts, vertexFormatInfo } from './vertex-layout.js';
import type { GpuVertexBufferLayout } from './vertex-layout.js';

describe('vertexFormatInfo', () => {
  it('describes float formats as unnormalized 32-bit float components', () => {
    expect(vertexFormatInfo('float32x3')).toEqual({
      componentCount: 3,
      componentType: 'float32',
      byteSize: 12,
      isNormalized: false,
    });
  });

  it('describes unorm8x4 as four normalized unsigned bytes in 4 bytes', () => {
    expect(vertexFormatInfo('unorm8x4')).toEqual({
      componentCount: 4,
      componentType: 'uint8',
      byteSize: 4,
      isNormalized: true,
    });
  });
});

describe('resolveVertexBufferLayouts', () => {
  it('packs attributes in order and derives the stride, as the prototype createVao did', () => {
    const [instances] = resolveVertexBufferLayouts([
      {
        stepMode: 'instance',
        attributes: [
          { location: 1, format: 'float32x2' },
          { location: 2, format: 'float32x2' },
          { location: 3, format: 'float32x4' },
        ],
      },
    ]);
    expect(instances?.byteStride).toBe(32);
    expect(instances?.attributes.map((attribute) => attribute.byteOffset)).toEqual([0, 8, 16]);
    expect(instances?.stepMode).toBe('instance');
  });

  it('mixes formats in one buffer with byte offsets that follow each size', () => {
    const [vertices] = resolveVertexBufferLayouts([
      {
        stepMode: 'vertex',
        attributes: [
          { location: 0, format: 'float32x2' },
          { location: 1, format: 'unorm8x4' },
          { location: 2, format: 'float32' },
        ],
      },
    ]);
    expect(vertices?.attributes.map((attribute) => attribute.byteOffset)).toEqual([0, 8, 12]);
    expect(vertices?.byteStride).toBe(16);
  });

  it('resolves each buffer independently', () => {
    const layouts = resolveVertexBufferLayouts([
      { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
      { stepMode: 'instance', attributes: [{ location: 1, format: 'float32x4' }] },
    ]);
    expect(layouts.map((layout) => [layout.stepMode, layout.byteStride])).toEqual([
      ['vertex', 8],
      ['instance', 16],
    ]);
  });

  it('rejects a shader location used twice across buffers', () => {
    expect(() =>
      resolveVertexBufferLayouts([
        { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
        { stepMode: 'instance', attributes: [{ location: 0, format: 'float32x4' }] },
      ]),
    ).toThrow(RangeError);
  });

  it('rejects a buffer without attributes', () => {
    expect(() => resolveVertexBufferLayouts([{ stepMode: 'vertex', attributes: [] }])).toThrow(
      RangeError,
    );
  });

  it('does not mutate the layouts it is given', () => {
    const layouts: GpuVertexBufferLayout[] = [
      { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
    ];
    const before = structuredClone(layouts);
    resolveVertexBufferLayouts(layouts);
    expect(layouts).toEqual(before);
  });
});
