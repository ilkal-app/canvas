import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';

import { createLayoutJobRequest } from './layout-request.js';

const style = (overrides: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: BUNDLED_FAMILY,
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
  ...overrides,
});

function library(): FontLibrary {
  const fonts = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
  return fonts;
}

describe('createLayoutJobRequest', () => {
  it('carries the text, runs, width and alignment unchanged', () => {
    const runs: StyleRun[] = [{ length: 5, style: style() }];
    const request = createLayoutJobRequest(
      { objectId: 'text-1', text: 'Hello', runs, maxWidth: 120, align: 'right' },
      library(),
    );
    expect(request).toMatchObject({
      objectId: 'text-1',
      text: 'Hello',
      maxWidth: 120,
      align: 'right',
    });
    expect(request.runs).toBe(runs);
  });

  it('sends only the faces the runs resolve to, each cut to the characters it sets', () => {
    const runs: StyleRun[] = [
      { length: 3, style: style() },
      { length: 2, style: style({ weight: 700, fontFamily: 'Helvetica' }) },
      { length: 2, style: style({ weight: 700 }) },
    ];
    const request = createLayoutJobRequest(
      { objectId: 'o', text: 'To AVxy', runs, maxWidth: null, align: 'left' },
      library(),
    );
    expect(request.fonts.map(({ face }) => [face.weight, face.isItalic])).toEqual([
      [400, false],
      [700, false],
    ]);
    const [regular, bold] = request.fonts;
    // Missing Helvetica preserves bold when it falls back to the available sans family.
    expect(regular?.advances.map(([codepoint]) => String.fromCodePoint(codepoint)).join('')).toBe(
      ' To',
    );
    expect(bold?.advances.map(([codepoint]) => String.fromCodePoint(codepoint)).join('')).toBe(
      'AVxy',
    );
    expect(bold?.kerning.some(([left, right]) => left === 0x41 && right === 0x56)).toBe(true);
  });

  it('lists the default face first even when no run uses it', () => {
    const runs: StyleRun[] = [{ length: 2, style: style({ weight: 700 }) }];
    const request = createLayoutJobRequest(
      { objectId: 'o', text: 'ab', runs, maxWidth: null, align: 'left' },
      library(),
    );
    expect(request.fonts.map(({ face }) => face.weight)).toEqual([400, 700]);
    expect(request.fonts[0]?.advances).toEqual([]);
  });

  it('rejects a library with no faces', () => {
    const input = {
      objectId: 'o',
      text: 'a',
      runs: [{ length: 1, style: style() }],
      maxWidth: null,
      align: 'left',
    } as const;
    expect(() => createLayoutJobRequest(input, new FontLibrary())).toThrow(RangeError);
  });
});
