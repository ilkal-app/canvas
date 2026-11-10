import { describe, expect, it } from 'vitest';

import { loadBundledFaces, loadRegularFontBytes } from '../__fixtures__/bundled-fonts.js';

import { FontFormatError } from './font-format-error.js';
import { parseFont } from './parse-font.js';

const cp = (character: string): number => character.codePointAt(0) ?? 0;

/**
 * Hides a table by renaming its directory entry to `xxxx`.
 *
 * @param bytes - A font file, changed in place.
 * @param tag - The table to hide.
 * @returns The same buffer.
 */
function renameTable(bytes: ArrayBuffer, tag: string): ArrayBuffer {
  const view = new Uint8Array(bytes);
  const tableCount = new DataView(bytes).getUint16(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (String.fromCharCode(...view.subarray(record, record + 4)) === tag) {
      view.set([0x78, 0x78, 0x78, 0x78], record);
    }
  }
  return bytes;
}

// Reference values read from the same files by msdfgen (stb_truetype) through the
// WebAssembly build the GPU test uses; the parser must agree with the glyph generator.
const REFERENCE = [
  { advances: { A: 0.6669921875, T: 0.61083984375, i: 0.22216796875, ' ': 0.27783203125 } },
  { advances: { A: 0.72216796875, T: 0.61083984375, i: 0.27783203125, ' ': 0.27783203125 } },
  { advances: { A: 0.6669921875, T: 0.61083984375, i: 0.22216796875, ' ': 0.27783203125 } },
  { advances: { A: 0.72216796875, T: 0.61083984375, i: 0.27783203125, ' ': 0.27783203125 } },
] as const;

const KERNING = [
  { AV: -0.07421875, To: -0.11083984375, Yo: -0.091796875, av: 0, ff: -0.01806640625 },
  { AV: -0.07421875, To: -0.07421875, Yo: -0.07421875, av: 0, ff: 0 },
  { AV: -0.05517578125, To: -0.091796875, Yo: -0.05517578125, av: 0, ff: 0 },
  { AV: -0.07421875, To: -0.037109375, Yo: -0.037109375, av: 0, ff: -0.01806640625 },
] as const;

describe('parseFont on the bundled Liberation Sans faces', () => {
  const fonts = loadBundledFaces().map(({ bytes }) => parseFont(bytes));

  it('reads the vertical metrics in em units, descent positive', () => {
    for (const font of fonts) {
      expect(font.unitsPerEm).toBe(2048);
      expect(font.ascent).toBe(0.9052734375);
      expect(font.descent).toBe(0.2119140625);
    }
  });

  it('maps characters to glyphs and reads their advances as msdfgen does', () => {
    fonts.forEach((font, faceIndex) => {
      for (const [character, advance] of Object.entries(REFERENCE[faceIndex]?.advances ?? {})) {
        expect(font.advanceOf(font.glyphIdOf(cp(character)))).toBe(advance);
      }
    });
  });

  it('maps characters outside the Basic Multilingual Plane subtable ranges to .notdef', () => {
    const [regular] = fonts;
    expect(regular?.glyphIdOf(0x1f600)).toBe(0);
    expect(regular?.glyphIdOf(cp('€'))).toBeGreaterThan(0);
  });

  it('reads pair kerning from the kern table with the values msdfgen reads', () => {
    fonts.forEach((font, faceIndex) => {
      for (const [pair, value] of Object.entries(KERNING[faceIndex] ?? {})) {
        const left = font.glyphIdOf(cp(pair.charAt(0)));
        const right = font.glyphIdOf(cp(pair.charAt(1)));
        expect(font.kerningOf(left, right)).toBe(value);
      }
    });
  });

  it('lists every mapped character with its glyph', () => {
    const [regular] = fonts;
    const mapping = new Map(regular?.characterMap());
    expect(mapping.get(cp('A'))).toBe(regular?.glyphIdOf(cp('A')));
    expect(mapping.size).toBeGreaterThan(600);
    expect([...mapping.values()].every((glyphId) => glyphId > 0)).toBe(true);
  });

  it('decodes a glyph outline into closed contours in em units, y up', () => {
    const [regular] = fonts;
    const outline = regular?.outlineOf(regular.glyphIdOf(cp('L')));
    expect(outline?.contours).toHaveLength(1);
    const xs = outline?.contours.flatMap((contour) => contour.flatMap((s) => [s.x0, s.x1])) ?? [];
    const ys = outline?.contours.flatMap((contour) => contour.flatMap((s) => [s.y0, s.y1])) ?? [];
    expect(Math.max(...xs)).toBeCloseTo(0.52294921875, 6);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(0.68798828125, 6);
    for (const contour of outline?.contours ?? []) {
      const first = contour[0];
      const last = contour.at(-1);
      expect([last?.x1, last?.y1]).toEqual([first?.x0, first?.y0]);
    }
  });

  it('decodes curves as quadratic segments and holes as extra contours', () => {
    const [regular] = fonts;
    const outline = regular?.outlineOf(regular.glyphIdOf(cp('o')));
    expect(outline?.contours).toHaveLength(2);
    expect(outline?.contours.flat().some((segment) => segment.kind === 'quadratic')).toBe(true);
  });

  it('decodes a composite glyph from its components', () => {
    const [regular] = fonts;
    const accented = regular?.outlineOf(regular.glyphIdOf(cp('é')));
    const plain = regular?.outlineOf(regular.glyphIdOf(cp('e')));
    expect(accented?.contours.length).toBeGreaterThan(plain?.contours.length ?? 0);
  });

  it('reads a font from a view into a larger buffer', () => {
    const bytes = new Uint8Array(loadRegularFontBytes());
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    const font = parseFont(padded.subarray(8));
    expect(font.advanceOf(font.glyphIdOf(cp('A')))).toBe(0.6669921875);
  });

  it('gives an out-of-range glyph no advance and no outline', () => {
    const [regular] = fonts;
    expect(regular?.advanceOf(100_000)).toBe(0);
    expect(regular?.outlineOf(100_000).contours).toEqual([]);
  });

  it('gives a blank glyph, such as the space, no contours', () => {
    const [regular] = fonts;
    expect(regular?.outlineOf(regular.glyphIdOf(cp(' '))).contours).toEqual([]);
  });

  it('does not mutate or keep a view that breaks when the caller reuses the bytes', () => {
    const bytes = loadRegularFontBytes();
    const copy = new Uint8Array(bytes.slice(0));
    const font = parseFont(bytes);
    expect(new Uint8Array(bytes).every((byte, index) => byte === copy[index])).toBe(true);
    new Uint8Array(bytes).fill(0);
    expect(font.advanceOf(font.glyphIdOf(cp('A')))).toBe(0.6669921875);
  });
});

describe('parseFont on malformed input', () => {
  it('rejects a file too short to hold a table directory', () => {
    expect(() => parseFont(new ArrayBuffer(4))).toThrow(FontFormatError);
  });

  it('rejects a font collection, which needs a face index', () => {
    const bytes = new Uint8Array(16);
    bytes.set([0x74, 0x74, 0x63, 0x66]);
    expect(() => parseFont(bytes.buffer)).toThrow(/collection/);
  });

  it('rejects an unknown sfnt version', () => {
    expect(() => parseFont(new Uint8Array(16).fill(7).buffer)).toThrow(FontFormatError);
  });

  it('rejects a table that runs past the end of the file', () => {
    const bytes = new Uint8Array(loadRegularFontBytes().slice(0, 4096));
    expect(() => parseFont(bytes.buffer)).toThrow(FontFormatError);
  });

  it('names a missing required table', () => {
    expect(() => parseFont(renameTable(loadRegularFontBytes(), 'hmtx'))).toThrow(/hmtx/);
  });

  it('reads metrics but no outlines from a font without a glyf table', () => {
    const font = parseFont(renameTable(loadRegularFontBytes(), 'glyf'));
    expect(font.advanceOf(font.glyphIdOf(cp('A')))).toBe(0.6669921875);
    expect(font.outlineOf(font.glyphIdOf(cp('A'))).contours).toEqual([]);
  });

  it('lays out unkerned when the font has no kern table', () => {
    const font = parseFont(renameTable(loadRegularFontBytes(), 'kern'));
    expect(font.kerningOf(font.glyphIdOf(cp('A')), font.glyphIdOf(cp('V')))).toBe(0);
  });
});
