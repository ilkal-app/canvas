import { describe, expect, it } from 'vitest';

import { buildSfnt, ByteWriter } from '../__fixtures__/sfnt-builder.js';

import { FontFormatError } from './font-format-error.js';
import { SfntFile } from './sfnt-file.js';

describe('SfntFile', () => {
  it('finds tables by tag and bounds each view to its table', () => {
    const file = new SfntFile(buildSfnt({ head: new Uint8Array([1, 2, 3, 4]) }));
    expect(file.hasTable('head')).toBe(true);
    expect(file.hasTable('glyf')).toBe(false);
    const head = file.table('head');
    expect(head.byteLength).toBe(4);
    expect(() => head.getUint8(4)).toThrow(RangeError);
  });

  it('accepts TrueType and CFF-flavoured versions', () => {
    for (const version of [0x00010000, 0x74727565, 0x4f54544f]) {
      const bytes = new ByteWriter().u32(version).u16(0, 0, 0, 0).toBytes();
      expect(() => new SfntFile(bytes.buffer)).not.toThrow();
    }
  });

  it('rejects a table directory longer than the file', () => {
    const bytes = new ByteWriter().u32(0x00010000).u16(3, 0, 0, 0).toBytes();
    expect(() => new SfntFile(bytes.buffer)).toThrow(/directory/);
  });

  it('names a missing table', () => {
    const file = new SfntFile(buildSfnt({}));
    expect(() => file.table('cmap')).toThrow(FontFormatError);
    expect(() => file.table('cmap')).toThrow(/'cmap'/);
  });
});
