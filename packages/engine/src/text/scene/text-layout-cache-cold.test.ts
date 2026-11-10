// Before this thread's shaper has loaded, the text cache queues no
// layout job: one queued then would wait on the load and shape outside a budgeted drain. Its own
// file, so the shaper starts cold.
import { expect, it, vi } from 'vitest';

import { isLayoutShaperLoaded, preloadLayoutShaper } from '../layout/layout-job.js';

import { createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { fontsKeyOf, TextLayoutCache } from './text-layout-cache.js';
import { textPlacementOf } from './text-placement.js';

it('queues no layout until the shaper has loaded, then asks for a frame and lays out', async () => {
  expect(isLayoutShaperLoaded()).toBe(false);
  const { fonts, pool } = createTextSetUp();
  const submit = vi.spyOn(pool, 'submit');
  const requested = vi.fn();
  const landed = vi.fn();
  const cache = new TextLayoutCache({ fonts, jobs: pool }, landed, requested);
  const object = textObject('text', 'Hi');
  const placement = textPlacementOf(object);
  const key = fontsKeyOf(fonts);
  expect(cache.layoutOf(object.id, placement, key)).toBeUndefined();
  expect(submit).not.toHaveBeenCalled();
  expect(pool.pendingCount).toBe(0);
  await preloadLayoutShaper();
  await Promise.resolve();
  // Queued once the shaper is there, and a frame asked for so the loop drains it.
  expect(submit).toHaveBeenCalledTimes(1);
  expect(requested).toHaveBeenCalled();
  pool.drainMainThread(Infinity, () => 0);
  await vi.waitFor(() => {
    expect(landed).toHaveBeenCalledWith(object.id);
  });
  expect(cache.layoutOf(object.id, placement, key)?.glyphs.length).toBeGreaterThan(0);
});
