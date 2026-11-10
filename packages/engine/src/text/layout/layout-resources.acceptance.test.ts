import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import {
  createFakeTransports,
  flushMicrotasks,
} from '../../workers/__fixtures__/fake-worker-transport.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';

import { layoutJob, layoutTextNow, requestLayout } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';

const TEXT = 'Hello AV';
const regular: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 18,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const runs: StyleRun[] = [
  { length: 6, style: regular },
  { length: 2, style: { ...regular, weight: 700 } },
];

function libraryWithBundledFaces(): FontLibrary {
  const library = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) library.addFace(face, bytes);
  return library;
}

function request(library: FontLibrary, objectId: string) {
  return createLayoutJobRequest(
    { objectId, text: TEXT, runs, maxWidth: 120, align: 'center' },
    library,
  );
}

describe('layout job font resources', () => {
  it('lists face ids and font keys in the same order as the metrics', () => {
    const library = libraryWithBundledFaces();
    const job = request(library, 'text-1');
    const regularFace = library.resolve({ family: BUNDLED_FAMILY, weight: 400, isItalic: false });
    const boldFace = library.resolve({ family: BUNDLED_FAMILY, weight: 700, isItalic: false });

    expect(job.faces).toEqual([
      { faceId: regularFace?.faceId, fontKey: regularFace?.fontKey },
      { faceId: boldFace?.faceId, fontKey: boldFace?.fontKey },
    ]);
    expect(job.faces).toHaveLength(job.fonts.length);
    expect(job.fonts.map(({ face }) => face)).toEqual([regularFace?.face, boldFace?.face]);
  });

  it('sends each face file once per worker across many layouts and preserves the layout', async () => {
    const library = libraryWithBundledFaces();
    const { transports, createTransport } = createFakeTransports(2);
    const pool = new WorkerPool({
      workerCount: 2,
      maxInFlightPerWorker: 1,
      createTransport,
      fallbackHandlers: { layout: layoutJob },
    });
    const jobs = Array.from({ length: 6 }, (slot, index) =>
      request(library, `text-${String(index)}`),
    );
    const tickets = jobs.map((job) => requestLayout(pool, job, 'visible', library));

    await flushMicrotasks();
    for (let round = 0; round < 3; round += 1) {
      await transports[0]?.answer();
      await transports[1]?.answer();
      await flushMicrotasks();
    }

    const expectedFaces = jobs[0]?.faces ?? [];
    expect(expectedFaces).toHaveLength(2);
    expect(transports.map((transport) => transport.posted.length)).toEqual([3, 3]);
    for (const transport of transports) {
      const firstResources = transport.posted[0]?.message.resources;
      expect(firstResources?.map(({ key }) => key)).toEqual(
        expectedFaces.map(({ fontKey }) => fontKey),
      );
      for (const [index, resource] of (firstResources ?? []).entries()) {
        const face = expectedFaces[index];
        const loaded = face === undefined ? undefined : library.get(face.faceId);
        if (loaded === undefined) throw new Error('A requested face must be loaded.');
        expect(resource.bytes.byteLength).toBe(loaded.bytes.byteLength);
        expect(new Uint8Array(resource.bytes)).toEqual(new Uint8Array(loaded.bytes));
        expect(transport.posted[0]?.transfer).not.toContain(resource.bytes);
      }
      expect(transport.posted.slice(1).map(({ message }) => message.resources)).toEqual([
        undefined,
        undefined,
      ]);
    }
    for (const [index, ticket] of tickets.entries()) {
      const job = jobs[index];
      if (job === undefined) throw new Error('Expected a job per ticket.');
      expect(await ticket.layout).toEqual(layoutTextNow(job));
    }
    pool.terminate();
  });
});
