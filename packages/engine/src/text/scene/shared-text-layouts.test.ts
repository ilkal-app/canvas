import { expect, it, vi } from 'vitest';

import type { TextLayout } from '@canvas/text';

import { SharedTextLayouts } from './shared-text-layouts.js';

const layout: TextLayout = { text: '', runs: [], glyphs: [], lines: [], width: 0, height: 0 };

it('invalidates sharing on font replacement and retries rejected work', async () => {
  const cache = new SharedTextLayouts();
  const create = vi.fn(() => Promise.resolve(layout));
  const old = cache.get('same inputs', 3, 1, create);
  expect(cache.get('same inputs', 3, 1, create)).toBe(old);
  const newer = cache.get('same inputs', 3, 2, create);
  expect(newer).not.toBe(old);
  const failed = cache.get('failure', 3, 2, () => Promise.reject(new Error('cancelled')));
  await expect(failed).rejects.toThrow('cancelled');
  expect(await cache.get('failure', 3, 2, create)).toBe(layout);
  expect(create).toHaveBeenCalledTimes(3);
});

it('bounds retained distinct labels while keeping a recently reused label', () => {
  const cache = new SharedTextLayouts();
  const create = vi.fn(() => Promise.resolve(layout));
  const first = cache.get('first', 3, 1, create);
  const cold = cache.get('cold', 3, 1, create);
  for (let index = 0; index < 600; index += 1) {
    expect(cache.get('first', 3, 1, create)).toBe(first);
    void cache.get(String(index), 3, 1, create);
  }
  expect(cache.get('cold', 3, 1, create)).not.toBe(cold);
});

it('bounds retained text and keys, bypassing oversized entries without evicting useful work', () => {
  const cache = new SharedTextLayouts();
  const create = vi.fn(() => Promise.resolve(layout));
  const first = cache.get('small', 3, 1, create);
  const huge = cache.get('huge', 1_000_000, 1, create);
  expect(cache.get('huge', 1_000_000, 1, create)).not.toBe(huge);
  expect(cache.get('small', 3, 1, create)).toBe(first);
  void cache.get('large-one', 140_000, 1, create);
  void cache.get('large-two', 140_000, 1, create);
  expect(cache.get('small', 3, 1, create)).not.toBe(first);
});

it('does not let rejection of an evicted job erase its replacement', async () => {
  const cache = new SharedTextLayouts();
  let reject: (error: Error) => void = () => undefined;
  const pending = new Promise<TextLayout>((unused, fail) => {
    reject = fail;
  });
  const old = cache.get('key', 3, 1, () => pending);
  const replacement = cache.get('key', 3, 2, () => Promise.resolve(layout));
  reject(new Error('obsolete'));
  await expect(old).rejects.toThrow('obsolete');
  expect(cache.get('key', 3, 2, () => Promise.resolve(layout))).toBe(replacement);
});
