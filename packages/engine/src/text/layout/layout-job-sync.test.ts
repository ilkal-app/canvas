// Once the shaper has loaded, a shaped layout job runs synchronously, so the main-thread
// fallback's drain counts its work against the frame budget.
import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { resourceContext } from '../../workers/job-handlers.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';

import { layoutJob, preloadLayoutShaper } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';

const STYLE: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

describe('layoutJob once the shaper has loaded', () => {
  it('returns a shaped outcome synchronously, not a promise', async () => {
    const library = new FontLibrary();
    for (const { face, bytes } of loadBundledFaces()) library.addFace(face, bytes);
    const runs: StyleRun[] = [{ length: 5, style: STYLE }];
    const request = createLayoutJobRequest(
      { objectId: 'sync', text: 'Hello', runs, maxWidth: null, align: 'left' },
      library,
    );
    const files = new Map(
      request.faces.flatMap(({ faceId }) => {
        const resource = library.jobResource(faceId);
        return resource === undefined ? [] : [[resource.key, resource.bytes] as const];
      }),
    );
    await preloadLayoutShaper();
    const outcome = layoutJob(request, resourceContext(files));
    expect(outcome).not.toBeInstanceOf(Promise);
    if (outcome instanceof Promise) throw new Error('Expected a synchronous outcome.');
    expect(outcome.response.objectId).toBe('sync');
    expect(outcome.response.layout.glyphs.byteLength).toBeGreaterThan(0);
  });
});
