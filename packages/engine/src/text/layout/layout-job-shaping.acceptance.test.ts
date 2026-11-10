/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { loadShaper } from '@canvas/text';

import { resourceContext } from '../../workers/job-handlers.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';

import { layoutJob, layoutTextNow, requestLayout } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';
import { libraryShaping } from './layout-shaping.js';
import { unpackTextLayout } from './packed-layout.js';

const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

function fixture() {
  const library = new FontLibrary();
  const bytes = readFileSync(
    new URL('../../../../app/assets/fonts/library/ebgaramond/400.ttf', import.meta.url),
  );
  library.addFace(
    { family: 'EB Garamond', weight: 400, isItalic: false },
    Uint8Array.from(bytes).buffer,
  );
  for (const { face, bytes: bundled } of loadBundledFaces()) library.addFace(face, bundled);
  const request = createLayoutJobRequest(
    {
      objectId: 'office',
      text: 'office',
      runs: [{ length: 6, style: STYLE }],
      maxWidth: null,
      align: 'left',
    },
    library,
  );
  const resources = new Map(
    request.faces.map(({ faceId, fontKey }) => {
      const resource = library.jobResource(faceId);
      if (resource === undefined) throw new Error('Missing face resource.');
      return [fontKey, resource.bytes] as const;
    }),
  );
  return { library, request, resources };
}

describe('layout job shaping', () => {
  it('shapes when its context serves every face and packs the shaped layout', async () => {
    const { library, request, resources } = fixture();
    const outcome = await layoutJob(request, resourceContext(resources));
    expect(unpackTextLayout(outcome.response.layout)).toEqual(
      layoutTextNow(request, libraryShaping(library, await loadShaper())),
    );
    expect(outcome.transfer).toEqual([
      outcome.response.layout.glyphs,
      outcome.response.layout.lines,
    ]);
  });

  it('uses metrics with an empty resource context', async () => {
    const { request } = fixture();
    const outcome = await layoutJob(request, resourceContext(new Map()));
    expect(unpackTextLayout(outcome.response.layout)).toEqual(layoutTextNow(request));
  });

  it('shapes through the pool main-thread fallback when requestLayout supplies the library', async () => {
    const { library, request } = fixture();
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { layout: layoutJob } });
    try {
      const ticket = requestLayout(pool, request, 'visible', library);
      pool.drainMainThread(Infinity, () => 0);
      expect(await ticket.layout).toEqual(
        layoutTextNow(request, libraryShaping(library, await loadShaper())),
      );
    } finally {
      pool.terminate();
    }
  });
});
