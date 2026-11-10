import { describe, expect, it } from 'vitest';

import { timingsFromTimestamps } from './timestamp-timings.js';

describe('timingsFromTimestamps', () => {
  it('turns begin/end nanosecond pairs into millisecond durations per labelled pass', () => {
    const timestamps = BigUint64Array.from([1_000_000n, 3_500_000n, 4_000_000n, 4_250_000n]);
    expect(timingsFromTimestamps(['fills', 'text'], timestamps)).toEqual([
      { label: 'fills', durationMs: 2.5 },
      { label: 'text', durationMs: 0.25 },
    ]);
  });

  it('reports 0 ms when the end precedes the begin, as a timestamp reset can make it', () => {
    const timestamps = BigUint64Array.from([9_000_000n, 1_000_000n]);
    expect(timingsFromTimestamps(['fills'], timestamps)).toEqual([
      { label: 'fills', durationMs: 0 },
    ]);
  });
});
