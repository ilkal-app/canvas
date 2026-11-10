import { describe, expect, it } from 'vitest';

import { resolveVertexBufferLayouts } from '../gpu/vertex-layout.js';

import {
  packShapeInstances,
  SHAPE_INSTANCE_BYTES,
  SHAPE_INSTANCE_FLOATS,
  SHAPE_KIND_CODES,
  SHAPE_VERTEX_BUFFERS,
} from './shape-instance-layout.js';
import type { ShapeInstance } from './shape-instance.js';

const BOX: ShapeInstance = {
  kind: 'rounded-box',
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  color: [1, 0.5, 0.25, 0.75],
  radius: 6,
  softness: 0,
};

const ELLIPSE: ShapeInstance = {
  kind: 'ellipse',
  x: -4,
  y: 8,
  width: 64,
  height: 32,
  color: [0, 0, 1, 1],
  radius: 0,
  softness: 2,
};

describe('packShapeInstances', () => {
  it('writes each instance as rect, straight-alpha colour, radius, softness, kind and axis', () => {
    const target = new Float32Array(SHAPE_INSTANCE_FLOATS);
    packShapeInstances([BOX], target);
    expect(Array.from(target)).toEqual([
      10, 20, 200, 120, 1, 0.5, 0.25, 0.75, 6, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("appends the outline's straight-alpha colour and width, then the sides, after the axis", () => {
    const target = new Float32Array(SHAPE_INSTANCE_FLOATS);
    const stroke = { color: [0.25, 0.5, 0.75, 1] as const, width: 3 };
    packShapeInstances([{ ...BOX, kind: 'star', sides: 5, stroke }], target);
    expect(Array.from(target.subarray(10))).toEqual([4, 1, 0, 0.25, 0.5, 0.75, 1, 3, 5, 0]);
  });

  it('appends the fraction of the outline outside the edge, by its alignment', () => {
    const target = new Float32Array(SHAPE_INSTANCE_FLOATS);
    const color = [0, 0, 0, 1] as const;
    const fractions = (['inside', 'center', 'outside'] as const).map((align) => {
      packShapeInstances([{ ...BOX, stroke: { color, width: 4, align } }], target);
      return target[19];
    });
    expect(fractions).toEqual([0, 0.5, 1]);
    packShapeInstances([{ ...BOX, stroke: { color, width: 4 } }], target);
    expect(target[19]).toBe(0);
  });

  it("writes a turned instance's rotation about its top-left corner as its axis (cos, sin)", () => {
    const target = new Float32Array(SHAPE_INSTANCE_FLOATS);
    packShapeInstances([{ ...BOX, rotation: Math.PI / 6 }], target);
    expect(target[11]).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(target[12]).toBeCloseTo(0.5, 6);
  });

  it('encodes the kinds as rounded box 0, ellipse 1, diamond 2, polygon 3 and star 4', () => {
    expect(SHAPE_KIND_CODES).toEqual({
      'rounded-box': 0,
      ellipse: 1,
      diamond: 2,
      polygon: 3,
      star: 4,
    });
    const target = new Float32Array(2 * SHAPE_INSTANCE_FLOATS);
    packShapeInstances([BOX, ELLIPSE], target);
    expect(target[10]).toBe(0);
    expect(target[SHAPE_INSTANCE_FLOATS + 10]).toBe(1);
  });

  it('starts at the given record and leaves every other float of the slice untouched', () => {
    const target = new Float32Array(3 * SHAPE_INSTANCE_FLOATS).fill(-1);
    packShapeInstances([ELLIPSE], target, 1);
    expect(Array.from(target.subarray(0, SHAPE_INSTANCE_FLOATS))).toEqual(
      new Array<number>(SHAPE_INSTANCE_FLOATS).fill(-1),
    );
    expect(Array.from(target.subarray(SHAPE_INSTANCE_FLOATS, 2 * SHAPE_INSTANCE_FLOATS))).toEqual([
      -4, 8, 64, 32, 0, 0, 1, 1, 0, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(target.subarray(2 * SHAPE_INSTANCE_FLOATS))).toEqual(
      new Array<number>(SHAPE_INSTANCE_FLOATS).fill(-1),
    );
  });

  it('packs nothing and accepts any slice when there are no instances', () => {
    const target = new Float32Array(0);
    expect(() => {
      packShapeInstances([], target, 0);
    }).not.toThrow();
  });

  it('rejects a slice too short to hold every record', () => {
    const target = new Float32Array(2 * SHAPE_INSTANCE_FLOATS - 1);
    expect(() => {
      packShapeInstances([BOX, ELLIPSE], target);
    }).toThrow(RangeError);
    expect(() => {
      packShapeInstances([BOX], new Float32Array(SHAPE_INSTANCE_FLOATS), 1);
    }).toThrow(RangeError);
  });

  it('rejects a negative or fractional first record', () => {
    const target = new Float32Array(4 * SHAPE_INSTANCE_FLOATS);
    expect(() => {
      packShapeInstances([BOX], target, -1);
    }).toThrow(RangeError);
    expect(() => {
      packShapeInstances([BOX], target, 1.5);
    }).toThrow(RangeError);
  });

  it('does not mutate the instances it packs', () => {
    const instances = Object.freeze([
      Object.freeze({ ...BOX, color: Object.freeze([...BOX.color]) }),
    ]) as readonly ShapeInstance[];
    const before = JSON.stringify(instances);
    packShapeInstances(instances, new Float32Array(SHAPE_INSTANCE_FLOATS));
    expect(JSON.stringify(instances)).toBe(before);
  });
});

describe('SHAPE_VERTEX_BUFFERS', () => {
  it('resolves to a unit-quad corner, clip index, transparency and zero corner radii per vertex and an 80-byte record per instance', () => {
    const [corners, instances] = resolveVertexBufferLayouts(SHAPE_VERTEX_BUFFERS);
    expect(corners?.stepMode).toBe('vertex');
    expect(corners?.byteStride).toBe(32);
    expect(corners?.attributes.map(({ location }) => location)).toEqual([0, 14, 12, 15]);
    expect(instances?.stepMode).toBe('instance');
    expect(instances?.byteStride).toBe(SHAPE_INSTANCE_BYTES);
    expect(SHAPE_INSTANCE_BYTES).toBe(SHAPE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT);
    expect(SHAPE_INSTANCE_BYTES).toBe(80);
  });

  it('places rect, colour, shape, axis, outline, sides and alignment where the packer writes', () => {
    const [, instances] = resolveVertexBufferLayouts(SHAPE_VERTEX_BUFFERS);
    expect(
      instances?.attributes.map(({ location, format, byteOffset }) => ({
        location,
        format,
        byteOffset,
      })),
    ).toEqual([
      { location: 1, format: 'float32x4', byteOffset: 0 },
      { location: 2, format: 'float32x4', byteOffset: 16 },
      { location: 3, format: 'float32x3', byteOffset: 32 },
      { location: 4, format: 'float32x2', byteOffset: 44 },
      { location: 5, format: 'float32x4', byteOffset: 52 },
      { location: 6, format: 'float32x3', byteOffset: 68 },
    ]);
  });
});
