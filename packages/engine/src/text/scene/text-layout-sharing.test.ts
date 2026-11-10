import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { TextLayout } from '@canvas/text';

import * as layoutJobs from '../layout/layout-job.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';

import { createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { fontsKeyOf, TextLayoutCache } from './text-layout-cache.js';
import { textPlacementOf } from './text-placement.js';

// Layouts are asked for once the shaper has loaded, as a warm engine has it.
beforeAll(async () => {
  await preloadLayoutShaper();
});

afterEach(() => vi.restoreAllMocks());

it('shares pending and completed identical layouts without sharing object lifecycle', async () => {
  const { fonts, pool, renderer } = createTextSetUp();
  const first = textObject('first', 'Repeated label');
  const second = textObject('second', first.text);
  const third = textObject('third', first.text);
  const geometry = textPlacementOf(first);
  const layout = layoutJobs.layoutTextNow(
    createLayoutJobRequest(
      {
        objectId: first.id,
        text: first.text,
        runs: first.runs,
        maxWidth: geometry.wrapWidth,
        align: geometry.align,
      },
      fonts,
    ),
  );
  let resolve: (value: TextLayout) => void = () => undefined;
  const pending = new Promise<TextLayout>((done) => {
    resolve = done;
  });
  const requested = vi
    .spyOn(layoutJobs, 'requestLayout')
    .mockReturnValue({ id: 1, layout: pending });
  const landed = vi.fn();
  const cache = new TextLayoutCache({ fonts, jobs: pool }, landed, () => undefined);
  const key = fontsKeyOf(fonts);
  cache.layoutOf(first.id, geometry, key);
  cache.layoutOf(second.id, textPlacementOf(second), key);
  expect(requested).toHaveBeenCalledTimes(1);
  cache.forget(first.id);
  resolve(layout);
  await new Promise((done) => setTimeout(done, 0));
  expect(landed.mock.calls).toEqual([[second.id]]);
  expect(cache.layoutOf(second.id, geometry, key)).toBe(layout);
  cache.layoutOf(third.id, textPlacementOf(third), key);
  await new Promise((done) => setTimeout(done, 0));
  expect(requested).toHaveBeenCalledTimes(1);
  expect(cache.layoutOf(third.id, geometry, key)).toBe(layout);
  expect(cache.isCurrent(third.id, geometry, key, layout)).toBe(true);
  cache.layoutOf(second.id, { ...geometry, wrapWidth: 12 }, key);
  expect(requested).toHaveBeenCalledTimes(2);
  renderer.destroy();
});
