import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { lodPreviewKey } from './lod-preview-key.js';
import type { LodForm } from './lod-rule.js';

it('binds actual non-full hysteresis forms while omitting default full forms', () => {
  const ids = ['b', 'a'] as ObjectId[];
  let form: LodForm = 'greek';
  const state = {
    visibleIds: ids,
    formOf: (pass: string, id: ObjectId): LodForm =>
      pass === 'text' && id === 'a' ? form : 'full',
  };
  const key = lodPreviewKey(state, ['shape', 'text']);
  expect(key).toBe(JSON.stringify([['text', 'a', 'greek']]));
  state.visibleIds = [...ids].reverse();
  expect(lodPreviewKey(state, ['text', 'shape'])).toBe(key);
  form = 'hidden';
  expect(lodPreviewKey(state, ['text', 'shape'])).not.toBe(key);
  form = 'full';
  expect(lodPreviewKey(state, ['shape', 'text'])).toBe('[]');
});

it('refuses unavailable visibility and oversized persisted LOD plans', () => {
  const unavailable = { visibleIds: undefined, formOf: (): LodForm => 'greek' };
  expect(lodPreviewKey(unavailable, ['text'])).toBeUndefined();
  expect(lodPreviewKey(unavailable, [])).toBe('[]');
  const visibleIds = Array.from(
    { length: 1100 },
    (ignored, index) => `${String(index)}${'x'.repeat(4080)}` as ObjectId,
  );
  expect(lodPreviewKey({ visibleIds, formOf: (): LodForm => 'greek' }, ['text'])).toBeUndefined();
});

it("keys only the scope's visible objects: what a preview holds", () => {
  const state = {
    visibleIds: ['a', 'band', 'b'] as ObjectId[],
    formOf: (): LodForm => 'hidden',
  };
  const key = lodPreviewKey(state, ['text'], ['b', 'a', 'gone'] as ObjectId[]);
  expect(key).toBe(
    JSON.stringify([
      ['text', 'a', 'hidden'],
      ['text', 'b', 'hidden'],
    ]),
  );
  expect(lodPreviewKey({ ...state, visibleIds: ['b', 'a'] as ObjectId[] }, ['text'])).toBe(key);
  expect(lodPreviewKey({ ...state, visibleIds: undefined }, ['text'], [])).toBeUndefined();
});
