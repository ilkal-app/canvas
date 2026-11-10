/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from './parse-font.js';

/**
 * A bundled face's bytes with one table field overwritten.
 *
 * @param tag - The table.
 * @param offset - The field's offset in it.
 * @param value - Its new int16 value.
 * @returns The patched bytes.
 */
function patched(tag: string, offset: number, value: number): Uint8Array {
  const bytes = Uint8Array.from(
    readFileSync(new URL('../../../app/assets/fonts/library/dmsans/400.ttf', import.meta.url)),
  );
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const at = 12 + index * 16;
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === tag) {
      view.setInt16(view.getUint32(at + 8) + offset, value);
    }
  }
  return bytes;
}

describe('readDecorationMetrics', () => {
  it('reads the underline and strikethrough a face gives', () => {
    const { decoration } = parseFont(patched('head', 0, 1));
    expect(decoration?.underlineThickness).toBeGreaterThan(0);
    expect(decoration?.underlinePosition).toBeLessThan(0);
    expect(decoration?.strikeoutPosition).toBeGreaterThan(0);
    expect(decoration?.strikeoutThickness).toBeGreaterThan(0);
  });

  it('leaves out a line whose thickness the font leaves at 0', () => {
    const noUnderline = parseFont(patched('post', 10, 0)).decoration;
    expect(noUnderline).not.toHaveProperty('underlinePosition');
    expect(noUnderline).toHaveProperty('strikeoutPosition');
    const noStrikeout = parseFont(patched('OS/2', 26, 0)).decoration;
    expect(noStrikeout).not.toHaveProperty('strikeoutPosition');
    expect(noStrikeout).toHaveProperty('underlinePosition');
  });
});
