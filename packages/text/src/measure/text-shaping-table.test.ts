// A shaping service measures a face it has no file for, but a table for, from the
// table, eagerly and when shaped alike; every other face shapes from its file.
import { describe, expect, it } from 'vitest';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import type { TableFontMetrics } from '../shaping/metrics-shaping.js';
import { loadShaper } from '../shaping/shaper.js';

import { createTextShaping, MissingFontFileError } from './text-shaping.js';

const TABLE_FACE: FontFaceKey = { family: 'Table Sans', weight: 400, isItalic: false };
const TABLE: TableFontMetrics = {
  face: TABLE_FACE,
  ascent: 0.88,
  descent: 0.12,
  missingAdvance: 0.5,
  advances: [[0x3042, 1]],
  kerning: [],
};

const [regular] = loadBundledFaces();
if (regular === undefined) throw new Error('No bundled face');
const REGULAR = createFontMetrics(regular.face, parseFont(regular.bytes));
const source = {
  bytesOf: (face: FontFaceKey) =>
    fontFaceId(face) === fontFaceId(regular.face) ? new Uint8Array(regular.bytes) : undefined,
};
const coverage = {
  bytesOf: () => undefined,
  metricsOf: (face: FontFaceKey) =>
    fontFaceId(face) === fontFaceId(TABLE_FACE) ? TABLE : undefined,
};

describe('a shaping service over a face known only by its table', () => {
  it.each(['eagerly', 'when-shaped'] as const)(
    'shapes it from the table, %s',
    async (readFiles) => {
      const shaping = createTextShaping(await loadShaper(), source, { readFiles, coverage });
      const measurer = shaping.measurerFor([REGULAR, TABLE]);
      const tableId = fontFaceId(TABLE_FACE);
      expect(measurer.shape?.(tableId, 'ああ', 0, 2).glyphs.map((g) => g.advance)).toEqual([1, 1]);
      expect(measurer.variationsOf?.(tableId, { wght: 700 })).toEqual({});
      const regularId = fontFaceId(regular.face);
      expect(measurer.shape?.(regularId, 'A', 0, 1).glyphs).toHaveLength(1);
      expect(measurer.variationsOf?.(regularId, {})).toEqual({});
    },
  );

  it('still refuses a face with neither a file nor a table', async () => {
    const shaping = createTextShaping(await loadShaper(), source, { coverage });
    const other = { ...TABLE, face: { ...TABLE_FACE, family: 'Nowhere Sans' } };
    expect(() => shaping.measurerFor([REGULAR, other])).toThrow(MissingFontFileError);
  });
});
