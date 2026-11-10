import { expect, it, vi } from 'vitest';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { shapeObject } from './__fixtures__/scene-objects.js';
import { enableRecordBatches, getRecordBatch, registerRecordBatch } from './record-batches.js';
import { worldTransformOf } from './world-transform.js';

it('keeps custom renderers generic and refuses replaced pass callbacks', () => {
  const pass = { ...FILLED_RECT_PASS };
  const object = shapeObject('a');
  const target = { object, transform: worldTransformOf(object, { get: () => undefined }) };
  const writer = vi.fn(() => 0);
  const factory = vi.fn(() => writer);
  registerRecordBatch(pass, factory);
  expect(getRecordBatch(pass, target)).toBeUndefined();
  expect(factory).not.toHaveBeenCalled();
  enableRecordBatches([pass]);
  expect(getRecordBatch(pass, target)).toBe(writer);
  pass.prepare = vi.fn();
  expect(getRecordBatch(pass, target)).toBeUndefined();
  expect(factory).toHaveBeenCalledOnce();
});
