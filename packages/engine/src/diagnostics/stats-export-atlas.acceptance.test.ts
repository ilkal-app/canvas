import { describe, expect, it } from 'vitest';

import { FrameHistory } from './frame-history.js';
import { createBenchmarkSample } from './stats-export.js';

describe('benchmark atlas hit rate', () => {
  it('uses lookup-weighted totals over only the frames the history holds', () => {
    const history = new FrameHistory(2);
    for (const [index, lookups, misses] of [
      [0, 100, 100],
      [1, 2, 1],
      [2, 8, 1],
    ] as const) {
      const frame = history.beginSample(index, index * 16);
      Object.assign(frame, { atlasLookups: lookups, atlasMisses: misses });
      history.commitSample();
    }
    expect(createBenchmarkSample(history)).toHaveProperty('atlasHitRate', 0.8);
  });

  it('omits the rate when no held frame looks up a glyph', () => {
    const history = new FrameHistory();
    history.beginSample(0, 0);
    history.commitSample();
    expect(createBenchmarkSample(history)).not.toHaveProperty('atlasHitRate');
  });

  it('reports zero when every lookup misses', () => {
    const history = new FrameHistory();
    const frame = history.beginSample(0, 0);
    Object.assign(frame, { atlasLookups: 3, atlasMisses: 3 });
    history.commitSample();
    expect(createBenchmarkSample(history)).toHaveProperty('atlasHitRate', 0);
  });
});
