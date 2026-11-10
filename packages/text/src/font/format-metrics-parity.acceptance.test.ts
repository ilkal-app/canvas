/// <reference types="node" />
// MCP metrics, ordinary measurement, and HarfBuzz measurement stay the same
// across every sfnt outline format, extracted collection face, and decoded web format.
import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import type { StyleRun } from '@canvas/schema';

import { measureText } from '../measure/measure-text.js';
import { createTextShaping, type SyncFontBytesSource } from '../measure/text-shaping.js';
import { loadShaper, type Shaper } from '../shaping/shaper.js';

import { extractFace } from './font-collection.js';
import type { FontFaceKey } from './font-face.js';
import { createFontMetrics } from './font-metrics.js';
import { parseFont } from './parse-font.js';
import { decodeWebFont } from './web-font.js';

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const SAMPLE = 'AV To Wa café\nVoilà AV To Wa';
const WRAP_WIDTHS = [null, 85] as const;

const FACES: readonly { name: string; face: FontFaceKey; collectionIndex?: number }[] = [
  {
    name: 'corpus-sans-regular',
    face: { family: 'Corpus Sans', weight: 400, isItalic: false },
    collectionIndex: 0,
  },
  {
    name: 'corpus-sans-bold',
    face: { family: 'Corpus Sans', weight: 700, isItalic: false },
    collectionIndex: 1,
  },
  { name: 'corpus-serif-regular', face: { family: 'Corpus Serif', weight: 400, isItalic: false } },
];

function fileBytes(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(new URL(name, CORPUS)));
}

async function formatBytes(
  name: string,
  format: string,
  collectionIndex?: number,
): Promise<Uint8Array> {
  if (format === 'ttc') {
    if (collectionIndex === undefined) throw new Error('Missing collection face index.');
    return extractFace(fileBytes('corpus-sans.ttc'), collectionIndex);
  }
  const suffix = format === 'cff' || format === 'cff2' ? `${format}.otf` : format;
  const bytes = fileBytes(`${name}.${suffix}`);
  return format === 'woff' || format === 'woff2' ? decodeWebFont(bytes) : bytes;
}

function runsFor(face: FontFaceKey): StyleRun[] {
  return [
    {
      length: SAMPLE.length,
      style: {
        fontFamily: face.family,
        fontSize: 20,
        color: [0, 0, 0, 1],
        weight: face.weight,
        italic: face.isItalic,
      },
    },
  ];
}

describe('font-format metrics and MCP measurement parity', () => {
  let shaper: Shaper;
  beforeAll(async () => {
    shaper = await loadShaper();
  });

  for (const { name, face, collectionIndex } of FACES) {
    for (const format of ['ttf', 'cff', 'cff2', 'ttc', 'woff', 'woff2']) {
      if (format === 'ttc' && collectionIndex === undefined) continue;

      it(`${name} ${format} matches its TTF metrics and measurements`, async () => {
        const ttfBytes = fileBytes(`${name}.ttf`);
        const bytes = await formatBytes(name, format, collectionIndex);
        const expected = createFontMetrics(face, parseFont(ttfBytes));
        const actual = createFontMetrics(face, parseFont(bytes));
        expect(actual).toEqual(expected);

        const runs = runsFor(face);
        for (const wrapWidth of WRAP_WIDTHS) {
          expect(measureText(SAMPLE, runs, wrapWidth, [actual])).toEqual(
            measureText(SAMPLE, runs, wrapWidth, [expected]),
          );
        }

        const sourceFor = (fontBytes: Uint8Array): SyncFontBytesSource => ({
          bytesOf: (requested) =>
            requested.family === face.family &&
            requested.weight === face.weight &&
            requested.isItalic === face.isItalic
              ? fontBytes
              : undefined,
        });
        const actualMeasurer = createTextShaping(shaper, sourceFor(bytes)).measurerFor([actual]);
        const expectedMeasurer = createTextShaping(shaper, sourceFor(ttfBytes)).measurerFor([
          expected,
        ]);
        for (const wrapWidth of WRAP_WIDTHS) {
          expect(measureText(SAMPLE, runs, wrapWidth, [actual], actualMeasurer)).toEqual(
            measureText(SAMPLE, runs, wrapWidth, [expected], expectedMeasurer),
          );
        }
      });
    }
  }
});
