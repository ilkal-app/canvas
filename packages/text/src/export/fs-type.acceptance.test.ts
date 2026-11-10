import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildSfnt, ByteWriter } from '../__fixtures__/sfnt-builder.js';
import * as text from '../index.js';

import { fsTypeOf } from './fs-type.js';

/**
 * Builds only the sfnt table needed to exercise the OS/2 embedding flags.
 *
 * @param flags - The big-endian OS/2 fsType value.
 * @param version - The OS/2 table version; bits 8 and 9 count from version 2.
 * @returns A synthetic sfnt file.
 */
function fontWithFsType(flags: number, version = 2): Uint8Array {
  const os2 = new ByteWriter().u16(version, 0, 400, 5, flags).toBytes();
  return new Uint8Array(buildSfnt({ 'OS/2': os2 }));
}

// Field names follow the repo's boolean naming rule (can/is prefixes); canSubset is the
// inverse of the design's noSubsetting.
describe('OS/2 fsType embedding rights', () => {
  it('exports fsTypeOf from @canvas/text', () => {
    expect(text.fsTypeOf).toBe(fsTypeOf);
  });

  it.each([
    [0x0000, { canEmbed: true, canEdit: true, canSubset: true, isBitmapOnly: false }],
    [0x0002, { canEmbed: false, canEdit: false, canSubset: true, isBitmapOnly: false }],
    [0x0004, { canEmbed: true, canEdit: false, canSubset: true, isBitmapOnly: false }],
    [0x0008, { canEmbed: true, canEdit: true, canSubset: true, isBitmapOnly: false }],
    [0x0100, { canEmbed: true, canEdit: true, canSubset: false, isBitmapOnly: false }],
    [0x0200, { canEmbed: true, canEdit: true, canSubset: true, isBitmapOnly: true }],
    [0x0304, { canEmbed: true, canEdit: false, canSubset: false, isBitmapOnly: true }],
  ] as const)('reads OS/2 fsType 0x%s', (flags, expected) => {
    expect(fsTypeOf(fontWithFsType(flags))).toEqual(expected);
  });

  // OS/2 versions 0 and 1 ignore bits 8 and 9.
  it('ignores the subsetting and bitmap bits before OS/2 version 2', () => {
    expect(fsTypeOf(fontWithFsType(0x0304, 0))).toEqual({
      canEmbed: true,
      canEdit: false,
      canSubset: true,
      isBitmapOnly: false,
    });
  });

  it('refuses embedding when the OS/2 table is missing', () => {
    expect(fsTypeOf(new Uint8Array(buildSfnt({ head: new Uint8Array(12) })))).toEqual({
      canEmbed: false,
      canEdit: false,
      canSubset: true,
      isBitmapOnly: false,
    });
  });

  it('recognizes the bundled OFL Lora font as embeddable', () => {
    const lora = readFileSync(
      new URL('../__fixtures__/format-corpus/corpus-serif-regular.ttf', import.meta.url),
    );
    expect(fsTypeOf(lora)).toMatchObject({ canEmbed: true });
  });
});
