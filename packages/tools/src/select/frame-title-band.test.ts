import { describe, expect, it } from 'vitest';

import { FRAME_TITLE_BAND_PX as ENGINE_FRAME_TITLE_BAND_PX } from '@canvas/engine';

import { FRAME_TITLE_BAND_PX } from './frame-title.js';

describe('the frame title band', () => {
  it('picks the frame where the engine draws its name: the same height', () => {
    expect(FRAME_TITLE_BAND_PX).toBe(ENGINE_FRAME_TITLE_BAND_PX);
  });
});
