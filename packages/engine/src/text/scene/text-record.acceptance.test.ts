import { describe, expect, it } from 'vitest';

import { TEXT_RECORD_LAYOUT, writeTextRecord } from './text-record.js';

const TRANSFORM = { x: 10, y: 20, cos: 1, sin: 0 };
const QUAD = {
  x: 2,
  y: 3,
  width: 4,
  height: 5,
  u0: 0,
  v0: 0,
  u1: 1,
  v1: 1,
  color: [1, 0, 0, 1] as [number, number, number, number],
};

describe('scene text page index records', () => {
  it('appends one float32 at location 6 before the scene clip and opacity', () => {
    const attributes = TEXT_RECORD_LAYOUT.vertexBufferLayout.attributes;
    expect(attributes.find((attribute) => attribute.location === 6)).toEqual({
      location: 6,
      format: 'float32',
    });
    expect(TEXT_RECORD_LAYOUT.floatsPerRecord).toBe(19);
    expect(TEXT_RECORD_LAYOUT.byteStride).toBe(76);
    expect(TEXT_RECORD_LAYOUT.clipFloat).toBe(17);
    expect(TEXT_RECORD_LAYOUT.opacityFloat).toBe(18);
  });

  it('writes the glyph page index and defaults bars to index zero', () => {
    const record = new Float32Array(TEXT_RECORD_LAYOUT.floatsPerRecord);
    writeTextRecord(record, TRANSFORM, QUAD, undefined, 5);
    expect(record[16]).toBe(5);
    expect([...record.slice(0, 4)]).toEqual([10, 20, 1, 0]);
    expect([...record.slice(12, 16)]).toEqual([1, 0, 0, 1]);
    expect([...record.slice(17)]).toEqual([0, 0]);
    record[16] = 7;
    writeTextRecord(record, TRANSFORM, { ...QUAD, u0: -1, v0: -1, u1: -1, v1: -1 });
    expect(record[16]).toBe(0);
  });
});
