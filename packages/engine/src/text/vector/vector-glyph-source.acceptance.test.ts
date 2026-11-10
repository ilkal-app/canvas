/// <reference types="node" />
// Acceptance: per-face batching, cache landing, retry policy, and idle state.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import { JobCancelledError, JobFailedError } from '../../workers/job-errors.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import { glyphFaceOf } from '../atlas/glyph-key.js';
import { FontLibrary } from '../font/font-library.js';

import type {
  GlyphGeometryJobRequest,
  GlyphGeometryJobResponse,
} from './glyph-geometry-job-payload.js';
import { GlyphGeometryCache, type GlyphGeometry } from './glyph-geometry.js';
import {
  DEFAULT_GLYPH_GEOMETRY_BUDGET_BYTES,
  MAX_GLYPH_GEOMETRY_BATCH,
  VectorGlyphSource,
} from './vector-glyph-source.js';
import { glyphGeometryKey } from './vector-run-mesh.js';

const FACE_ID = '400|n|Corpus Sans Variable';
const BOLD_FACE = `${FACE_ID}@wght=700`;
const A = 0x41;
const GEOMETRY: GlyphGeometry = {
  vertices: new Float32Array([0, 0, 0, 1, 1, 0, 0.5, 0, 0, 1, 1, 1]),
  vertexCount: 3,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
};

type Settle = (value: GlyphGeometryJobResponse | Error) => void;

class RecordingPool {
  readonly submitted: {
    request: GlyphGeometryJobRequest;
    options: SubmitOptions;
    settle: Settle;
  }[] = [];

  submit(
    kind: 'glyphGeometry',
    request: GlyphGeometryJobRequest,
    options: SubmitOptions,
  ): JobTicket<'glyphGeometry'> {
    expect(kind).toBe('glyphGeometry');
    let settle: Settle = () => undefined;
    const response = new Promise<GlyphGeometryJobResponse>((resolve, reject) => {
      settle = (value) => {
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
    });
    this.submitted.push({ request, options, settle });
    return { id: this.submitted.length, response };
  }
}

function setup(
  options: {
    cache?: GlyphGeometryCache;
    onGeometryReady?: () => void;
    priority?: 'visible' | 'near';
  } = {},
) {
  const bytes = readFileSync(
    new URL(
      '../../../../text/src/__fixtures__/format-corpus/corpus-sans-variable.ttf',
      import.meta.url,
    ),
  );
  const fonts = new FontLibrary();
  fonts.addFace(
    { family: 'Corpus Sans Variable', weight: 400, isItalic: false },
    Uint8Array.from(bytes).buffer,
  );
  const pool = new RecordingPool();
  return { fonts, pool, source: new VectorGlyphSource({ pool, fonts, ...options }) };
}

function land(pool: RecordingPool, index: number): void {
  const entry = pool.submitted[index];
  if (entry === undefined) throw new Error('missing submitted batch');
  entry.settle({
    faceId: entry.request.faceId,
    glyphs: entry.request.keys.map((key) => ({ key, ...GEOMETRY })),
  });
}

describe('VectorGlyphSource acceptance', () => {
  it('coalesces and deduplicates one tick by face, with font bytes and instance coordinates', async () => {
    const { fonts, pool, source } = setup();
    source.request({ faceId: FACE_ID }, A);
    source.request({ faceId: FACE_ID }, 0x42);
    source.request({ faceId: FACE_ID }, A);
    source.request({ faceId: FACE_ID, variations: {} }, A);
    source.request({ faceId: FACE_ID, variations: { wght: 700 } }, A);
    source.request({ faceId: FACE_ID, variations: { wght: 700 } }, 0x43);
    expect(pool.submitted).toHaveLength(0);
    expect(source.isIdle).toBe(false);
    await flushMicrotasks();
    expect(pool.submitted.map(({ request }) => [request.faceId, request.keys])).toEqual([
      [FACE_ID, [A, 0x42]],
      [BOLD_FACE, [A, 0x43]],
    ]);
    expect(glyphFaceOf({ faceId: FACE_ID, variations: { wght: 700 } })).toBe(BOLD_FACE);
    expect(pool.submitted[0]?.request.variations).toBeUndefined();
    expect(pool.submitted[1]?.request.variations).toEqual({ wght: 700 });
    const loaded = fonts.get(FACE_ID);
    if (loaded === undefined) throw new Error('missing font');
    for (const { request, options } of pool.submitted) {
      expect(request.fontKey).toBe(loaded.fontKey);
      expect(new Uint8Array(request.fontBytes)).toEqual(new Uint8Array(loaded.bytes));
      expect(options).toEqual({ priority: 'visible', transfer: [request.fontBytes] });
    }
  });

  it('splits a face into at most 64 keys per job without changing their order', async () => {
    const { pool, source } = setup();
    expect(MAX_GLYPH_GEOMETRY_BATCH).toBe(64);
    for (let index = 0; index < 130; index += 1) source.request({ faceId: FACE_ID }, index);
    await flushMicrotasks();
    expect(pool.submitted.map(({ request }) => request.keys.length)).toEqual([64, 64, 2]);
    expect(pool.submitted.flatMap(({ request }) => request.keys)).toEqual([
      ...new Uint8Array(130).keys(),
    ]);
  });

  it('lands each batch in the face-keyed cache and wakes idle waiters once all finish', async () => {
    let ready = 0;
    const { pool, source } = setup({
      onGeometryReady: () => {
        ready += 1;
      },
    });
    expect(DEFAULT_GLYPH_GEOMETRY_BUDGET_BYTES).toBe(16 * 1024 * 1024);
    await expect(source.whenIdle()).resolves.toBeUndefined();
    source.request({ faceId: FACE_ID }, A);
    source.request({ faceId: FACE_ID, variations: { wght: 700 } }, A);
    const idle = source.whenIdle();
    let didResolve = false;
    void idle.then(() => {
      didResolve = true;
    });
    await flushMicrotasks();
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(2);
    land(pool, 1);
    await flushMicrotasks();
    expect(source.lookup(BOLD_FACE, A)).toEqual(GEOMETRY);
    expect(source.lookup(FACE_ID, A)).toBeUndefined();
    expect(source.cache.get(glyphGeometryKey(BOLD_FACE, A))).toEqual(GEOMETRY);
    expect(ready).toBe(1);
    expect(source.isIdle).toBe(false);
    expect(didResolve).toBe(false);
    land(pool, 0);
    await idle;
    expect(source.lookup(FACE_ID, A)).toEqual(GEOMETRY);
    expect(ready).toBe(2);
    expect(source.isIdle).toBe(true);
  });

  it('gives up after a failed batch without redraw or another submit', async () => {
    let ready = 0;
    const { pool, source } = setup({
      onGeometryReady: () => {
        ready += 1;
      },
    });
    source.request({ faceId: FACE_ID }, A);
    source.request({ faceId: FACE_ID }, 0x42);
    await flushMicrotasks();
    pool.submitted[0]?.settle(
      new JobFailedError(1, 'glyphGeometry', {
        code: 'handler-failed',
        name: 'Error',
        message: 'failed',
      }),
    );
    await source.whenIdle();
    source.request({ faceId: FACE_ID }, A);
    source.request({ faceId: FACE_ID }, 0x42);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(1);
    expect(ready).toBe(0);
    expect(source.isIdle).toBe(true);
  });

  it('forgets cancelled keys so a later request submits again', async () => {
    const { pool, source } = setup();
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    pool.submitted[0]?.settle(new JobCancelledError(1));
    await source.whenIdle();
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(2);
  });

  it('can submit a face after it is loaded into the library', async () => {
    const fonts = new FontLibrary();
    const pool = new RecordingPool();
    const source = new VectorGlyphSource({ pool, fonts });
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(0);
    expect(source.isIdle).toBe(true);
    const bytes = readFileSync(
      new URL(
        '../../../../text/src/__fixtures__/format-corpus/corpus-sans-variable.ttf',
        import.meta.url,
      ),
    );
    fonts.addFace(
      { family: 'Corpus Sans Variable', weight: 400, isItalic: false },
      Uint8Array.from(bytes).buffer,
    );
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(1);
  });

  it('requests an evicted glyph again and honors the requested priority', async () => {
    const cache = new GlyphGeometryCache(GEOMETRY.vertices.byteLength);
    const { pool, source } = setup({ cache, priority: 'near' });
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    land(pool, 0);
    await source.whenIdle();
    source.request({ faceId: FACE_ID }, 0x42);
    await flushMicrotasks();
    land(pool, 1);
    await source.whenIdle();
    expect(source.lookup(FACE_ID, A)).toBeUndefined();
    expect(source.lookup(FACE_ID, 0x42)).toEqual(GEOMETRY);
    source.request({ faceId: FACE_ID }, A);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(3);
    expect(pool.submitted[2]?.options.priority).toBe('near');
  });
});
