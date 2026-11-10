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

it('does not accept a stale layout completion or an older built layout as current evidence', async () => {
  const { fonts, pool, renderer } = createTextSetUp();
  const object = textObject('text', 'Hi');
  const first = textPlacementOf(object);
  const second = { ...first, wrapWidth: 20 };
  const layout = (maxWidth: number | null): TextLayout =>
    layoutJobs.layoutTextNow(
      createLayoutJobRequest(
        {
          objectId: object.id,
          text: object.text,
          runs: object.runs,
          align: object.align,
          maxWidth,
        },
        fonts,
      ),
    );
  const oldLayout = layout(null);
  const currentLayout = layout(20);
  let landOld: ((value: TextLayout) => void) | undefined;
  let landCurrent: ((value: TextLayout) => void) | undefined;
  const old = new Promise<TextLayout>((resolve) => {
    landOld = resolve;
  });
  const current = new Promise<TextLayout>((resolve) => {
    landCurrent = resolve;
  });
  vi.spyOn(layoutJobs, 'requestLayout')
    .mockReturnValueOnce({ id: 1, layout: old })
    .mockReturnValueOnce({ id: 2, layout: current });
  const landed = vi.fn();
  const cache = new TextLayoutCache({ fonts, jobs: pool }, landed, () => undefined);
  const key = fontsKeyOf(fonts);
  cache.layoutOf(object.id, first, key);
  cache.layoutOf(object.id, second, key);
  landOld?.(oldLayout);
  await Promise.resolve();
  expect(landed).not.toHaveBeenCalled();
  expect(cache.isCurrent(object.id, second, key, oldLayout)).toBe(false);
  landCurrent?.(currentLayout);
  await Promise.resolve();
  expect(landed).toHaveBeenCalledOnce();
  expect(cache.isCurrent(object.id, second, key, oldLayout)).toBe(false);
  expect(cache.isCurrent(object.id, second, key, currentLayout)).toBe(true);
  expect(cache.isCurrent(object.id, first, key, currentLayout)).toBe(false);
  renderer.destroy();
});
