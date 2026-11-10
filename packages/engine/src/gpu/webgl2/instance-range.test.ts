import { describe, expect, it } from 'vitest';

import { firstRecordByteOffset } from './instance-range.js';

describe('firstRecordByteOffset', () => {
  it('aims per-instance attributes at the range start, since WebGL2 has no base instance', () => {
    expect(firstRecordByteOffset('instance', 32, 0, 5)).toBe(160);
  });

  it('adds the offset the vertex buffer was bound at', () => {
    expect(firstRecordByteOffset('instance', 32, 64, 1)).toBe(96);
  });

  it('leaves per-vertex buffers at their bound offset: drawArrays handles firstVertex', () => {
    expect(firstRecordByteOffset('vertex', 12, 24, 5)).toBe(24);
  });
});
