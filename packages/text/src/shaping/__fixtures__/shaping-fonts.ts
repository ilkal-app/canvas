/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { createFontMetrics, parseFont, type FontMetrics } from '../../index.js';

/** The bundled face used by an acceptance test. */
export interface AcceptanceFont {
  /** Font file bytes for HarfBuzz. */
  readonly bytes: Uint8Array;
  /** Font metrics and the family name used by layout. */
  readonly metrics: FontMetrics;
}

const FILES = {
  'eb-garamond': ['../../../../app/assets/fonts/library/ebgaramond/400.ttf', 'EB Garamond'],
  'dm-sans': ['../../../../app/assets/fonts/library/dmsans/400.ttf', 'DM Sans'],
  'liberation-sans': [
    '../../../../engine/assets/fonts/LiberationSans-Regular.ttf',
    'Liberation Sans',
  ],
  'noto-sans-arabic': [
    '../../../../app/assets/fonts/script-coverage/notosansarabic/400.ttf',
    'Noto Sans Arabic',
  ],
  'noto-sans-devanagari': [
    '../../../../app/assets/fonts/script-coverage/notosansdevanagari/400.ttf',
    'Noto Sans Devanagari',
  ],
} as const;

/**
 * Reads one checked-in font and derives its metrics without adding a font dependency to tests.
 *
 * @param name - The font's fixture name.
 * @returns The file bytes and metrics for its regular face.
 */
export function acceptanceFont(name: keyof typeof FILES): AcceptanceFont {
  const [path, family] = FILES[name];
  const bytes = readFileSync(new URL(path, import.meta.url));
  const metrics = createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes));
  return { bytes, metrics };
}
