import { describe, expect, it } from 'vitest';

import { FRAME_TITLE_ATLAS_SHARE, glyphAtlasSizing, TEXT_ATLAS_SHARE } from '../../index.js';

const MIB = 1024 * 1024;

describe('glyph atlas device budget sizing', () => {
  it('exports shares that partition the atlas category exactly', () => {
    expect(TEXT_ATLAS_SHARE).toBe(7 / 8);
    expect(FRAME_TITLE_ATLAS_SHARE).toBe(1 / 8);
    expect(TEXT_ATLAS_SHARE + FRAME_TITLE_ATLAS_SHARE).toBe(1);
  });

  it('sizes the desktop and mobile shares with room for two RGBA pages', () => {
    expect(glyphAtlasSizing(64 * MIB, TEXT_ATLAS_SHARE)).toEqual({
      budgetBytes: 56 * MIB,
      pageSize: 2048,
    });
    expect(glyphAtlasSizing(64 * MIB, FRAME_TITLE_ATLAS_SHARE)).toEqual({
      budgetBytes: 8 * MIB,
      pageSize: 1024,
    });
    expect(glyphAtlasSizing(16 * MIB, TEXT_ATLAS_SHARE)).toEqual({
      budgetBytes: 14 * MIB,
      pageSize: 1024,
    });
    expect(glyphAtlasSizing(16 * MIB, FRAME_TITLE_ATLAS_SHARE)).toEqual({
      budgetBytes: 2 * MIB,
      pageSize: 512,
    });
  });

  it('uses the largest fitting page size at exact thresholds and floors fractional bytes', () => {
    expect(glyphAtlasSizing(32 * MIB - 1, 1).pageSize).toBe(1024);
    expect(glyphAtlasSizing(32 * MIB, 1).pageSize).toBe(2048);
    expect(glyphAtlasSizing(8 * MIB - 1, 1).pageSize).toBe(512);
    expect(glyphAtlasSizing(8 * MIB, 1).pageSize).toBe(1024);
    expect(glyphAtlasSizing(2 * MIB - 1, 1).pageSize).toBe(512);
    expect(glyphAtlasSizing(7, 0.5)).toEqual({ budgetBytes: 3, pageSize: 512 });
  });
});
