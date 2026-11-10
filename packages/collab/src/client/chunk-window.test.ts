import { expect, it } from 'vitest';

import { ChunkWindow, MAX_UNACKNOWLEDGED_BYTES } from './chunk-window.js';

it('keeps at most the byte budget unacknowledged, in order, a larger frame alone', () => {
  const sent: number[] = [];
  const window = new ChunkWindow((frame) => sent.push(frame.byteLength), 10);
  window.acknowledge();
  for (const size of [4, 4, 4, 12, 3]) window.push(new Uint8Array(size));
  expect(sent).toEqual([4, 4]);
  window.acknowledge();
  expect(sent).toEqual([4, 4, 4]);
  window.acknowledge();
  window.acknowledge();
  // Nothing in flight: the 12-byte frame goes alone, past the budget.
  expect(sent).toEqual([4, 4, 4, 12]);
  window.acknowledge();
  expect(sent).toEqual([4, 4, 4, 12, 3]);
  expect(MAX_UNACKNOWLEDGED_BYTES).toBe(4 * 1024 * 1024);
});
