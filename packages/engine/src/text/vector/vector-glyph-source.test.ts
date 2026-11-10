/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import type { JobTicket } from '../../workers/job-submission.js';
import { FontLibrary } from '../font/font-library.js';

import type { GlyphGeometryJobRequest } from './glyph-geometry-job-payload.js';
import { VectorGlyphSource } from './vector-glyph-source.js';

const A = 0x41;
const CORPUS_FONT = '../../../../text/src/__fixtures__/format-corpus/corpus-sans-regular.ttf';

describe('VectorGlyphSource', () => {
  it('does not ask again for a glyph whose geometry is cached', async () => {
    const fonts = new FontLibrary();
    const bytes = readFileSync(new URL(CORPUS_FONT, import.meta.url));
    const { faceId } = fonts.addFace(
      { family: 'Corpus Sans', weight: 400, isItalic: false },
      Uint8Array.from(bytes).buffer,
    );
    const requests: GlyphGeometryJobRequest[] = [];
    const pool = {
      submit: (kind: 'glyphGeometry', request: GlyphGeometryJobRequest) => {
        expect(kind).toBe('glyphGeometry');
        requests.push(request);
        const glyphs = request.keys.map((key) => ({
          key,
          vertices: new Float32Array(12),
          vertexCount: 3,
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        }));
        return {
          id: requests.length,
          response: Promise.resolve({ faceId: request.faceId, glyphs }),
        } satisfies JobTicket<'glyphGeometry'>;
      },
    };
    const source = new VectorGlyphSource({ pool, fonts });
    source.request({ faceId }, A);
    await source.whenIdle();
    expect(source.lookup(faceId, A)?.vertexCount).toBe(3);
    source.request({ faceId }, A);
    await flushMicrotasks();
    expect(requests).toHaveLength(1);
    expect(source.isIdle).toBe(true);
  });
});
