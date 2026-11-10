/// <reference types="node" />
// Acceptance: worker geometry, transfer, instance outlines, and job registration.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadShaper, parseFont } from '@canvas/text';

import { EngineJobs } from '../../host/engine-jobs.js';
import { createDefaultJobHandlers } from '../../workers/default-job-handlers.js';
import { isJobKind } from '../../workers/job-kinds.js';
import { createProductionJobHandlers } from '../../workers/production-job-handlers.js';
import { glyphKeyOf } from '../atlas/glyph-key.js';

import type { GlyphGeometryJobRequest } from './glyph-geometry-job-payload.js';
import { createGlyphGeometryJobHandler } from './glyph-geometry-job.js';
import { DEFAULT_CUBIC_TOLERANCE_EM, tessellateGlyph } from './glyph-geometry.js';

const CORPUS = new URL('../../../../text/src/__fixtures__/format-corpus/', import.meta.url);
const FACE_ID = '400|n|Corpus Sans';
const A = 0x41;

function fontBytes(file: string): ArrayBuffer {
  return Uint8Array.from(readFileSync(new URL(file, CORPUS))).buffer;
}

function request(
  file: string,
  keys: readonly number[],
  font = fontBytes(file),
): GlyphGeometryJobRequest {
  return { faceId: FACE_ID, fontKey: file, fontBytes: font, keys };
}

// Shared by the real-outline tests so the HarfBuzz module loads once in this file.
const shaperPromise = loadShaper();

describe('glyphGeometry job acceptance', () => {
  it.each(['corpus-sans-regular.ttf', 'corpus-sans-regular.cff.otf'])(
    'returns exact HarfBuzz triangles in request order for %s',
    async (file) => {
      const bytes = fontBytes(file);
      const parsed = parseFont(bytes);
      const glyphId = parsed.glyphIdOf(A);
      const keys = [A, glyphKeyOf({ codepoint: A, glyphId }), 0x67];
      const input = request(file, keys, bytes);
      const outcome = await createGlyphGeometryJobHandler()(input);
      const shaper = await shaperPromise;
      const face = shaper.face(file, new Uint8Array(bytes));

      expect(outcome.response.faceId).toBe(FACE_ID);
      expect(outcome.response.glyphs.map(({ key }) => key)).toEqual(keys);
      for (const [index, glyph] of outcome.response.glyphs.entries()) {
        const key = keys[index];
        if (key === undefined) throw new Error('missing key');
        const id = key < 0 ? -1 - key : parsed.glyphIdOf(key);
        const expected = tessellateGlyph(shaper.outline(face, id));
        expect(glyph.vertices).toEqual(expected.vertices);
        expect(glyph.vertexCount).toBe(expected.vertexCount);
        expect(glyph.bounds).toEqual(expected.bounds);
      }
      expect(outcome.response.glyphs[0]?.vertexCount).toBeGreaterThan(0);
      // Each glyph's edge hulls travel with its triangles.
      expect(outcome.transfer).toEqual(
        outcome.response.glyphs.flatMap(({ vertices, edges }) => [
          vertices.buffer,
          ...(edges ? [edges.vertices.buffer] : []),
        ]),
      );
    },
  );

  it('uses the requested cubic tolerance for CFF outlines', async () => {
    const file = 'corpus-sans-regular.cff.otf';
    const bytes = fontBytes(file);
    const toleranceEm = 1 / 32;
    const shaper = await shaperPromise;
    const face = shaper.face(file, new Uint8Array(bytes));
    const expected = tessellateGlyph(
      shaper.outline(face, parseFont(bytes).glyphIdOf(0x67)),
      toleranceEm,
    );
    const outcome = await createGlyphGeometryJobHandler()({
      ...request(file, [0x67], bytes),
      toleranceEm,
    });
    expect(outcome.response.glyphs[0]?.vertices).toEqual(expected.vertices);
    expect(DEFAULT_CUBIC_TOLERANCE_EM).toBe(1 / 4096);
  });

  it('returns empty geometry for missing glyphs and all glyphs of an unreadable font', async () => {
    const handler = createGlyphGeometryJobHandler();
    const absent = await handler(request('corpus-sans-regular.ttf', [0x10ffff, -1]));
    for (const glyph of absent.response.glyphs) {
      expect(glyph.vertexCount).toBe(0);
      expect(glyph.vertices).toEqual(new Float32Array());
      expect(glyph.bounds).toBeUndefined();
    }
    const broken = await handler(request('broken.ttf', [A, 0x67], new ArrayBuffer(12)));
    expect(broken.response.glyphs.map(({ key }) => key)).toEqual([A, 0x67]);
    for (const glyph of broken.response.glyphs) {
      expect(glyph.vertexCount).toBe(0);
      expect(glyph.bounds).toBeUndefined();
    }
    expect(broken.transfer).toEqual(
      broken.response.glyphs.flatMap(({ vertices, edges }) => [
        vertices.buffer,
        ...(edges ? [edges.vertices.buffer] : []),
      ]),
    );
  });

  it('uses the requested variable-font instance instead of the default outline', async () => {
    const file = 'corpus-sans-variable.ttf';
    const bytes = fontBytes(file);
    const font = parseFont(bytes);
    const shaper = await shaperPromise;
    const glyphId = font.glyphIdOf(A);
    const regularFace = shaper.face(file, new Uint8Array(bytes));
    const boldFace = shaper.face(file, new Uint8Array(bytes), { wght: 700 });
    const regular = tessellateGlyph(shaper.outline(regularFace, glyphId));
    const expected = tessellateGlyph(shaper.outline(boldFace, glyphId));
    const input = {
      ...request(file, [A], bytes),
      faceId: `${FACE_ID}@wght=700`,
      variations: { wght: 700 },
    };
    const actual = await createGlyphGeometryJobHandler()(input);
    expect(actual.response.faceId).toBe(input.faceId);
    expect(actual.response.glyphs[0]?.vertices).toEqual(expected.vertices);
    expect(expected.vertices).not.toEqual(regular.vertices);
  });

  it('registers the kind in both worker handler sets', async () => {
    expect(isJobKind('glyphGeometry')).toBe(true);
    const input = request('corpus-sans-regular.ttf', [A]);
    for (const handlers of [createProductionJobHandlers(), createDefaultJobHandlers()]) {
      const handler = handlers.glyphGeometry;
      expect(handler).toBeTypeOf('function');
      if (handler === undefined) throw new Error('missing glyphGeometry handler');
      const outcome = await handler(input, { resource: () => undefined });
      expect(outcome.response.glyphs[0]?.vertexCount).toBeGreaterThan(0);
    }
  });

  it('runs the lazy rendering-thread fallback without workers', async () => {
    const jobs = new EngineJobs(undefined);
    try {
      const ticket = jobs.pool.submit('glyphGeometry', request('corpus-sans-regular.ttf', [A]), {
        priority: 'visible',
      });
      expect(jobs.runQueued(() => 0)).toBe(0);
      const response = await ticket.response;
      expect(response.glyphs[0]?.vertexCount).toBeGreaterThan(0);
    } finally {
      jobs.terminate();
    }
  });
});
