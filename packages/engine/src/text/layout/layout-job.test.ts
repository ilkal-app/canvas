import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { createMetricsMeasurer } from '@canvas/text';
import { layoutText } from '@canvas/text';

import {
  createFakeTransports,
  flushMicrotasks,
} from '../../workers/__fixtures__/fake-worker-transport.js';
import { createDefaultJobHandlers } from '../../workers/default-job-handlers.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';

import type { LayoutJobRequest } from './layout-job-payload.js';
import { layoutJob, layoutTextNow, requestLayout } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';

const style = (overrides: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: BUNDLED_FAMILY,
  fontSize: 18,
  color: [0.2, 0.4, 0.6, 1],
  weight: 400,
  italic: false,
  ...overrides,
});
const runs: StyleRun[] = [
  { length: 10, style: style() },
  { length: 13, style: style({ weight: 700, fontSize: 30, color: [1, 0, 0, 1] }) },
];
const TEXT = 'Typography matters AVAV';

function request(): LayoutJobRequest {
  const fonts = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
  return createLayoutJobRequest(
    { objectId: 'text-7', text: TEXT, runs, maxWidth: 160, align: 'center' },
    fonts,
  );
}

describe('layoutTextNow', () => {
  it('lays out a request on the calling thread, as the job does', () => {
    const job = request();
    const expected = layoutText(TEXT, runs, 160, createMetricsMeasurer(job.fonts), 'center');
    expect(layoutTextNow(job)).toEqual(expected);
    expect(expected.lines.length).toBeGreaterThan(1);
  });
});

describe('layoutJob', () => {
  it('answers with the packed layout and transfers its buffers', async () => {
    const job = request();
    const { response, transfer } = await layoutJob(job);
    expect(response.objectId).toBe('text-7');
    expect(transfer).toEqual([response.layout.glyphs, response.layout.lines]);
  });

  it('is registered with the default job handlers', () => {
    expect(createDefaultJobHandlers().layout).toBe(layoutJob);
  });
});

describe('requestLayout', () => {
  it('lays text out in a worker and unpacks the reply', async () => {
    const { transports, createTransport } = createFakeTransports(1);
    const pool = new WorkerPool({
      workerCount: 1,
      createTransport,
      fallbackHandlers: { layout: layoutJob },
    });
    const job = request();
    const ticket = requestLayout(pool, job, 'visible');
    await flushMicrotasks();
    await transports[0]?.answer(ticket.id);
    expect(await ticket.layout).toEqual(layoutTextNow(job));
    pool.terminate();
  });

  it('lays text out on the main thread when the pool has no workers', async () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { layout: layoutJob } });
    const job = request();
    const ticket = requestLayout(pool, job, 'near');
    await flushMicrotasks();
    pool.drainMainThread(Infinity, () => 0);
    expect(await ticket.layout).toEqual(layoutTextNow(job));
  });
});
