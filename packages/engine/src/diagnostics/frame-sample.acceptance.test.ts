import { describe, expect, it } from 'vitest';

import { FrameHistory } from './frame-history.js';
import { createFrameSample, FRAME_COUNTER_NAMES } from './frame-sample.js';

describe('per-frame atlas counters', () => {
  it('lists both counters and starts an empty frame at zero', () => {
    expect(FRAME_COUNTER_NAMES).toContain('atlasLookups');
    expect(FRAME_COUNTER_NAMES).toContain('atlasMisses');
    expect(createFrameSample()).toMatchObject({ atlasLookups: 0, atlasMisses: 0 });
  });

  it('resets both counters when a history slot is reused', () => {
    const history = new FrameHistory(1);
    const first = history.beginSample(0, 0);
    Object.assign(first, { atlasLookups: 7, atlasMisses: 2 });
    history.commitSample();
    const second = history.beginSample(1, 16);
    expect(second).toMatchObject({ atlasLookups: 0, atlasMisses: 0 });
    history.commitSample();
    expect(history.newest).toMatchObject({ atlasLookups: 0, atlasMisses: 0 });
  });
});
