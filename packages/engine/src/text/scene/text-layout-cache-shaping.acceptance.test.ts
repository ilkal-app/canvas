import { beforeAll, expect, it, vi } from 'vitest';

import type { LayoutJobRequest } from '../layout/layout-job-payload.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';

import { createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { fontsKeyOf, TextLayoutCache } from './text-layout-cache.js';
import { textPlacementOf } from './text-placement.js';

// Layouts are asked for once the shaper has loaded, as a warm engine has it.
beforeAll(async () => {
  await preloadLayoutShaper();
});

it('submits every requested face file with a text-pass layout job', () => {
  const { fonts, pool, renderer } = createTextSetUp();
  try {
    const submitted = vi.spyOn(pool, 'submit');
    const object = textObject('office', 'office');
    const cache = new TextLayoutCache(
      { fonts, jobs: pool },
      () => undefined,
      () => undefined,
    );
    cache.layoutOf(object.id, textPlacementOf(object), fontsKeyOf(fonts));

    expect(submitted).toHaveBeenCalledOnce();
    const [kind, payload, options] = submitted.mock.calls[0] ?? [];
    expect(kind).toBe('layout');
    if (kind !== 'layout' || payload === undefined) throw new Error('Missing layout job.');
    const request = payload as LayoutJobRequest;
    expect(options?.priority).toBe('visible');
    expect(options?.resources).toHaveLength(request.faces.length);
    for (const [index, face] of request.faces.entries()) {
      expect(options?.resources?.[index]).toBe(fonts.jobResource(face.faceId));
    }
    expect(options?.resources?.map(({ key }) => key)).toEqual(
      request.faces.map(({ fontKey }) => fontKey),
    );
  } finally {
    pool.terminate();
    renderer.destroy();
    vi.restoreAllMocks();
  }
});
