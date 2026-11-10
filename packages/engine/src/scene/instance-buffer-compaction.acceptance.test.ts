import { expect, it } from 'vitest';

import { InstanceBuffer } from './instance-buffer.js';
import { resolveInstanceLayout } from './instance-layout.js';

it('reuses free slots from lowest to highest after reuseLowestFirst', () => {
  const buffer = new InstanceBuffer(resolveInstanceLayout([{ location: 1, format: 'float32x2' }]));
  for (let index = 0; index < 5; index += 1) buffer.allocate();
  buffer.release(1);
  buffer.release(4);
  buffer.release(2);
  (buffer as InstanceBuffer & { reuseLowestFirst(): void }).reuseLowestFirst();
  expect([buffer.allocate(), buffer.allocate(), buffer.allocate()]).toEqual([1, 2, 4]);
});
