import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import { JobCancelledError, JobFailedError } from '../../workers/job-errors.js';
import type { JobHandlers } from '../../workers/job-handlers.js';
import type { JobRequest, JobResponse } from '../../workers/job-kinds.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER, HIGH_TIER } from '../atlas/glyph-tiers.js';
import { FontLibrary } from '../font/font-library.js';

import { FakeMsdfgenModule } from './__fixtures__/fake-msdfgen-module.js';
import { GlyphSource } from './glyph-source.js';
import { createMsdfJobHandler } from './msdf-job.js';

const REGULAR = `400|n|${BUNDLED_FAMILY}`;
const BOLD = `700|n|${BUNDLED_FAMILY}`;

function library(): FontLibrary {
  const fonts = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
  return fonts;
}

/** A pool that records `msdf` submissions and answers them when told to. */
class RecordingPool {
  readonly submitted: { request: JobRequest<'msdf'>; options: SubmitOptions; settle: Settle }[] =
    [];
  private nextId = 1;

  submit(kind: 'msdf', request: JobRequest<'msdf'>, options: SubmitOptions): JobTicket<'msdf'> {
    let settle: Settle = () => undefined;
    const response = new Promise<JobResponse<'msdf'>>((resolve, reject) => {
      settle = (outcome) => {
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      };
    });
    const id = this.nextId;
    this.nextId += 1;
    expect(kind).toBe('msdf');
    this.submitted.push({ request, options, settle });
    return { id, response };
  }
}
type Settle = (outcome: JobResponse<'msdf'> | Error) => void;

/**
 * Makes a pool without workers, running jobs on the main thread when drained.
 *
 * @param handlers - The handlers it runs; an msdfgen-backed `msdf` handler by default.
 * @returns The pool.
 */
function mainThreadPool(
  handlers: JobHandlers = {
    msdf: createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(new FakeMsdfgenModule()) }),
  },
): WorkerPool {
  return new WorkerPool({ workerCount: 0, fallbackHandlers: handlers });
}

async function runPool(pool: WorkerPool, source: GlyphSource): Promise<void> {
  for (let round = 0; round < 10 && !source.isIdle; round += 1) {
    await flushMicrotasks();
    pool.drainMainThread(Infinity, () => 0);
    await flushMicrotasks();
  }
}

describe('GlyphSource', () => {
  it('coalesces requests made in one tick per face and tier into one job', async () => {
    const pool = new RecordingPool();
    const fonts = library();
    const source = new GlyphSource({ pool, fonts, atlas: new GlyphAtlas() });
    source.request({ faceId: REGULAR }, 0x61, BASE_TIER);
    source.request({ faceId: REGULAR }, 0x62, BASE_TIER);
    source.request({ faceId: REGULAR }, 0x61, BASE_TIER);
    source.request({ faceId: REGULAR }, 0x61, HIGH_TIER);
    source.request({ faceId: BOLD }, 0x61, BASE_TIER);
    expect(pool.submitted).toHaveLength(0);
    await flushMicrotasks();
    expect(
      pool.submitted.map(({ request }) => [request.faceId, request.tier, request.keys]),
    ).toEqual([
      [REGULAR, BASE_TIER, [0x61, 0x62]],
      [REGULAR, HIGH_TIER, [0x61]],
      [BOLD, BASE_TIER, [0x61]],
    ]);
    expect(pool.submitted[0]?.request).toMatchObject({
      field: 'msdf',
      fontKey: fonts.get(REGULAR)?.fontKey,
    });
    expect(pool.submitted[0]?.options).toMatchObject({ priority: 'visible' });
    // The font goes once per worker as the job's resource, never copied into a batch.
    expect(pool.submitted[0]?.options.resources).toEqual([fonts.get(REGULAR)?.jobResource]);
    expect(pool.submitted[0]?.options.transfer).toBeUndefined();
    expect(pool.submitted[0]?.request.fontBytes).toBeUndefined();
  });

  it('does not re-request characters in flight', async () => {
    const pool = new RecordingPool();
    const source = new GlyphSource({ pool, fonts: library(), atlas: new GlyphAtlas() });
    source.request({ faceId: REGULAR }, 0x61, BASE_TIER);
    await flushMicrotasks();
    source.request({ faceId: REGULAR }, 0x61, BASE_TIER);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(1);
    expect(source.isIdle).toBe(false);
  });

  it('puts generated glyphs in the atlas and says so', async () => {
    const pool = mainThreadPool();
    const atlas = new GlyphAtlas();
    let readyCount = 0;
    const source = new GlyphSource({
      pool,
      fonts: library(),
      atlas,
      onGlyphsReady: () => (readyCount += 1),
    });
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    source.request({ faceId: REGULAR }, 0x42, BASE_TIER);
    await runPool(pool, source);
    expect(atlas.lookup(REGULAR, 0x41, BASE_TIER)?.field).toBe('msdf');
    expect(atlas.lookup(REGULAR, 0x42, BASE_TIER)?.field).toBe('msdf');
    expect(readyCount).toBe(1);
    expect(source.isIdle).toBe(true);
  });

  it('resolves whenIdle once every requested glyph has landed', async () => {
    const pool = mainThreadPool();
    const atlas = new GlyphAtlas();
    const source = new GlyphSource({ pool, fonts: library(), atlas });
    await expect(source.whenIdle()).resolves.toBeUndefined();
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    const idle = source.whenIdle();
    await runPool(pool, source);
    await idle;
    expect(atlas.lookup(REGULAR, 0x41, BASE_TIER)).toBeDefined();
  });

  it('retries a failed batch with the raster fallback', async () => {
    const pool = new RecordingPool();
    const atlas = new GlyphAtlas();
    const source = new GlyphSource({ pool, fonts: library(), atlas });
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    await flushMicrotasks();
    const failure = { code: 'worker-failed', name: 'Error', message: 'crashed' } as const;
    pool.submitted[0]?.settle(new JobFailedError(1, 'msdf', failure));
    await flushMicrotasks();
    expect(pool.submitted.map(({ request }) => request.field)).toEqual(['msdf', 'sdf']);
    const fallback = createMsdfJobHandler();
    const retry = pool.submitted[1];
    if (retry === undefined) throw new Error('no retry was submitted');
    const outcome = await fallback(retry.request);
    retry.settle(outcome.response);
    await source.whenIdle();
    expect(atlas.lookup(REGULAR, 0x41, BASE_TIER)?.field).toBe('sdf');
  });

  it('gives up on glyphs whose fallback also fails, and does not request them again', async () => {
    const pool = new RecordingPool();
    const source = new GlyphSource({ pool, fonts: library(), atlas: new GlyphAtlas() });
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    await flushMicrotasks();
    const failure = { code: 'handler-failed', name: 'Error', message: 'bad font' } as const;
    pool.submitted[0]?.settle(new JobFailedError(1, 'msdf', failure));
    await flushMicrotasks();
    pool.submitted[1]?.settle(new JobFailedError(2, 'msdf', failure));
    await source.whenIdle();
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(2);
    expect(source.isIdle).toBe(true);
  });

  it('forgets a cancelled batch, so its glyphs can be requested again', async () => {
    const pool = new RecordingPool();
    const source = new GlyphSource({ pool, fonts: library(), atlas: new GlyphAtlas() });
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    await flushMicrotasks();
    pool.submitted[0]?.settle(new JobCancelledError(1));
    await source.whenIdle();
    source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(2);
  });

  it('backs off, doubling each time, from glyphs the atlas rejects for lack of budget', async () => {
    const pool = mainThreadPool();
    // A budget too small for any page: every glyph is rejected.
    const atlas = new GlyphAtlas({ pageSize: 64, budgetBytes: 16 });
    const source = new GlyphSource({ pool, fonts: library(), atlas });
    const requestAndRun = async (): Promise<number> => {
      const before = atlas.memory().rejectedGlyphCount;
      source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
      await runPool(pool, source);
      return atlas.memory().rejectedGlyphCount - before;
    };
    // Rejected once, then 2 requests skipped; rejected again, then 4 skipped.
    const rejections = [];
    for (let frame = 0; frame < 9; frame += 1) rejections.push(await requestAndRun());
    expect(rejections).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('counts the backoff in ticks, however often a frame requests the rejected glyph', async () => {
    const pool = mainThreadPool();
    const atlas = new GlyphAtlas({ pageSize: 64, budgetBytes: 16 });
    const source = new GlyphSource({ pool, fonts: library(), atlas });
    const frame = async (): Promise<number> => {
      const before = atlas.memory().rejectedGlyphCount;
      // "AAAAA": buildGlyphQuads requests a glyph once per occurrence.
      for (let occurrence = 0; occurrence < 5; occurrence += 1) {
        source.request({ faceId: REGULAR }, 0x41, BASE_TIER);
      }
      await runPool(pool, source);
      return atlas.memory().rejectedGlyphCount - before;
    };
    const rejections = [];
    for (let index = 0; index < 9; index += 1) rejections.push(await frame());
    expect(rejections).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('ignores faces the library does not hold', async () => {
    const pool = new RecordingPool();
    const source = new GlyphSource({ pool, fonts: library(), atlas: new GlyphAtlas() });
    source.request({ faceId: '400|n|Missing' }, 0x41, BASE_TIER);
    await flushMicrotasks();
    expect(pool.submitted).toHaveLength(0);
    expect(source.isIdle).toBe(true);
  });
});
