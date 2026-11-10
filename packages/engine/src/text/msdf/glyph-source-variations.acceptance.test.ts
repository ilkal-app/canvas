/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import { JobFailedError } from '../../workers/job-errors.js';
import type { JobResponse } from '../../workers/job-kinds.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import { FontLibrary } from '../font/font-library.js';

import { GlyphSource } from './glyph-source.js';
import type { MsdfJobRequest } from './msdf-job-payload.js';

const faceId = '400|n|Corpus Sans Variable';
const boldFace = `${faceId}@wght=700`;
const glyph = 0x41;

type Settle = (response: JobResponse<'msdf'> | Error) => void;

class RecordingPool {
  readonly submitted: { request: MsdfJobRequest; options: SubmitOptions; settle: Settle }[] = [];

  submit(kind: 'msdf', request: MsdfJobRequest, options: SubmitOptions): JobTicket<'msdf'> {
    expect(kind).toBe('msdf');
    let settle: Settle = () => undefined;
    const response = new Promise<JobResponse<'msdf'>>((resolve, reject) => {
      settle = (value) => {
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
    });
    this.submitted.push({ request, options, settle });
    return { id: this.submitted.length, response };
  }
}

function setup() {
  const fonts = new FontLibrary();
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
  const pool = new RecordingPool();
  const atlas = new GlyphAtlas();
  return { fonts, pool, atlas, source: new GlyphSource({ pool, fonts, atlas }) };
}

function land(pool: RecordingPool, index: number): void {
  const submitted = pool.submitted[index];
  if (submitted === undefined) throw new Error('missing submitted batch');
  submitted.settle({
    faceId: submitted.request.faceId,
    tier: submitted.request.tier,
    glyphs: submitted.request.keys.map((key) => ({
      key,
      bitmap: {
        field: 'sdf',
        width: 2,
        height: 2,
        pixels: new Uint8Array(4),
        left: 0,
        top: 2,
        advance: 2,
      },
    })),
  });
}

describe('GlyphSource variable instances', () => {
  it('batches by instance and submits the base font resource with instance coordinates', async () => {
    const { fonts, pool, source } = setup();
    source.request({ faceId }, glyph, BASE_TIER);
    source.request({ faceId, variations: { wght: 700 } }, glyph, BASE_TIER);
    source.request({ faceId, variations: { wght: 700 } }, 0x42, BASE_TIER);
    await flushMicrotasks();

    expect(pool.submitted).toHaveLength(2);
    expect(pool.submitted.map(({ request }) => request.faceId)).toEqual([faceId, boldFace]);
    expect(pool.submitted.map(({ request }) => request.keys)).toEqual([[glyph], [glyph, 0x42]]);
    expect(pool.submitted[0]?.request.variations).toBeUndefined();
    expect(pool.submitted[1]?.request.variations).toEqual({ wght: 700 });
    const loaded = fonts.get(faceId);
    if (loaded === undefined) throw new Error('Expected the corpus face in the library');
    for (const { request, options } of pool.submitted) {
      expect(request.fontKey).toBe(loaded.fontKey);
      expect(request).not.toHaveProperty('fontBytes');
      expect(options).not.toHaveProperty('transfer');
      expect(options.resources).toHaveLength(1);
      expect(options.resources?.[0]).toBe(loaded.jobResource);
    }
  });

  it('lands the instance response under its face while the default remains missing', async () => {
    const { atlas, pool, source } = setup();
    source.request({ faceId, variations: { wght: 700 } }, glyph, BASE_TIER);
    await flushMicrotasks();
    land(pool, 0);
    await source.whenIdle();

    expect(atlas.lookup(boldFace, glyph, BASE_TIER)).toBeDefined();
    expect(atlas.lookup(faceId, glyph, BASE_TIER)).toBeUndefined();
  });

  it('tracks in-flight and failed glyphs per instance', async () => {
    const { pool, source } = setup();
    source.request({ faceId, variations: { wght: 700 } }, glyph, BASE_TIER);
    await flushMicrotasks();
    source.request({ faceId, variations: { wght: 700 } }, glyph, BASE_TIER);
    source.request({ faceId }, glyph, BASE_TIER);
    await flushMicrotasks();
    expect(pool.submitted.map(({ request }) => request.faceId)).toEqual([boldFace, faceId]);

    const failure = { code: 'handler-failed', name: 'Error', message: 'bad glyph' } as const;
    pool.submitted[0]?.settle(new JobFailedError(1, 'msdf', failure));
    await flushMicrotasks();
    expect(pool.submitted[2]?.request).toMatchObject({ faceId: boldFace, field: 'sdf' });
    pool.submitted[2]?.settle(new JobFailedError(3, 'msdf', failure));
    land(pool, 1);
    await source.whenIdle();

    source.request({ faceId, variations: { wght: 700 } }, glyph, BASE_TIER);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(3);
  });
});
