import { describe, expect, it } from 'vitest';

import { frameObject, groupObject, shapeObject } from './__fixtures__/scene-objects.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;

describe('SOLID_RECT_PASS', () => {
  it('gives a frame with a background one record and one without none', () => {
    expect(SOLID_RECT_PASS.recordCount(frameObject('f'))).toBe(1);
    expect(SOLID_RECT_PASS.recordCount(frameObject('f', { background: null }))).toBe(0);
  });

  it('leaves every shape to the SDF shape pass, filled rectangles included', () => {
    expect(SOLID_RECT_PASS.recordCount(shapeObject('s'))).toBe(0);
    expect(SOLID_RECT_PASS.recordCount(shapeObject('s', { kind: 'ellipse' }))).toBe(0);
    expect(SOLID_RECT_PASS.recordCount(groupObject('g'))).toBe(0);
    const record = new Float32Array(SOLID_RECT_PASS.layout.floatsPerRecord);
    SOLID_RECT_PASS.prepare(record, { object: shapeObject('s'), transform: IDENTITY }, 0);
    expect(record.every((value) => value === 0)).toBe(true);
  });

  it('flags what it draws as an occluder, since a background hides what is below', () => {
    expect(SOLID_RECT_PASS.isOccluder?.(frameObject('f'))).toBe(true);
    expect(SOLID_RECT_PASS.isOccluder?.(shapeObject('s'))).toBe(false);
    expect(SOLID_RECT_PASS.isOccluder?.(groupObject('g'))).toBe(false);
  });

  it('writes the world origin, size, rotation axis and colour of the box', () => {
    const record = new Float32Array(SOLID_RECT_PASS.layout.floatsPerRecord);
    const frame = frameObject('f', { width: 30, height: 20, background: [0.5, 0.25, 1, 0.75] });
    SOLID_RECT_PASS.prepare(
      record,
      { object: frame, transform: { cos: 0, sin: 1, x: 4, y: 6 } },
      0,
    );
    // The clip index and the transparency, last, are the scene's to write.
    expect(Array.from(record)).toEqual([4, 6, 30, 20, 0, 1, 0.5, 0.25, 1, 0.75, 0, 0]);
    expect(SOLID_RECT_PASS.layout.clipFloat).toBe(10);
    expect(SOLID_RECT_PASS.layout.opacityFloat).toBe(11);
  });

  it('writes a frame background as its colour', () => {
    const record = new Float32Array(SOLID_RECT_PASS.layout.floatsPerRecord);
    const frame = frameObject('f', { background: [0, 0.5, 0, 1] });
    SOLID_RECT_PASS.prepare(
      record,
      { object: frame, transform: { cos: 1, sin: 0, x: 0, y: 0 } },
      0,
    );
    expect(Array.from(record.subarray(6, 10))).toEqual([0, 0.5, 0, 1]);
  });

  it('draws a unit quad as two triangles', () => {
    const { vertices, vertexCount } = SOLID_RECT_PASS.pipelineSpec;
    expect(vertexCount).toBe(6);
    expect(vertices).toHaveLength(12);
  });
});
