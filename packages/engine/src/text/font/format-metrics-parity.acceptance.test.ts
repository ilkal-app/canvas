/// <reference types="node" />
// The engine loads the same metrics as MCP and lays out the same line widths
// from each format, both with per-codepoint metrics and with HarfBuzz shaping.
import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import type { StyleRun } from '@canvas/schema';
import {
  createFontMetrics,
  createMetricsMeasurer,
  createTextShaping,
  decodeWebFont,
  extractFace,
  layoutText,
  loadShaper,
  measureText,
  parseFont,
  type FontFaceKey,
  type Shaper,
  type SyncFontBytesSource,
} from '@canvas/text';

import { layoutTextNow } from '../layout/layout-job.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';
import { libraryShaping } from '../layout/layout-shaping.js';

import { FontLibrary } from './font-library.js';

const CORPUS = new URL('../../../../text/src/__fixtures__/format-corpus/', import.meta.url);
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

describe('font-format engine and MCP metrics parity', () => {
  let shaper: Shaper;
  beforeAll(async () => {
    shaper = await loadShaper();
  });

  for (const { name, face, collectionIndex } of FACES) {
    for (const format of ['ttf', 'cff', 'cff2', 'ttc', 'woff', 'woff2']) {
      if (format === 'ttc' && collectionIndex === undefined) continue;

      it(`${name} ${format} matches MCP metrics and line widths`, async () => {
        const ttfBytes = fileBytes(`${name}.ttf`);
        const bytes = await formatBytes(name, format, collectionIndex);
        const ttfMetrics = createFontMetrics(face, parseFont(ttfBytes));
        const library = new FontLibrary();
        const loaded = library.addFace(face, Uint8Array.from(bytes).buffer);
        expect(loaded.metrics).toEqual(ttfMetrics);

        const runs = runsFor(face);
        const source: SyncFontBytesSource = {
          bytesOf: (requested) =>
            requested.family === face.family &&
            requested.weight === face.weight &&
            requested.isItalic === face.isItalic
              ? ttfBytes
              : undefined,
        };
        const ttfShaping = createTextShaping(shaper, source).measurerFor([ttfMetrics]);
        for (const wrapWidth of WRAP_WIDTHS) {
          const request = createLayoutJobRequest(
            { objectId: name, text: SAMPLE, runs, maxWidth: wrapWidth, align: 'left' },
            library,
          );
          const unshaped = layoutTextNow(request);
          const expectedUnshaped = layoutText(
            SAMPLE,
            runs,
            wrapWidth,
            createMetricsMeasurer([ttfMetrics]),
          );
          expect(unshaped.lines.map(({ width }) => width)).toEqual(
            expectedUnshaped.lines.map(({ width }) => width),
          );
          expect({
            width: unshaped.width,
            height: unshaped.height,
            lineCount: unshaped.lines.length,
          }).toEqual(measureText(SAMPLE, runs, wrapWidth, [ttfMetrics]));

          const shaped = layoutTextNow(request, libraryShaping(library, shaper));
          const expectedShaped = layoutText(SAMPLE, runs, wrapWidth, ttfShaping);
          expect(shaped.lines.map(({ width }) => width)).toEqual(
            expectedShaped.lines.map(({ width }) => width),
          );
          expect({
            width: shaped.width,
            height: shaped.height,
            lineCount: shaped.lines.length,
          }).toEqual(measureText(SAMPLE, runs, wrapWidth, [ttfMetrics], ttfShaping));
        }
      });
    }
  }
});
