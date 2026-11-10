import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextGraphemeIndex, previousGraphemeIndex, snapToGrapheme } from './grapheme-steps.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('grapheme boundary snapping', () => {
  it('preserves boundaries, clamps ends and chooses either side of an interior position', () => {
    const text = 'ae\u0301b';
    expect(snapToGrapheme(text, -1)).toBe(0);
    expect(snapToGrapheme(text, 100)).toBe(4);
    expect(snapToGrapheme(text, 1)).toBe(1);
    expect(snapToGrapheme(text, 2)).toBe(1);
    expect(snapToGrapheme(text, 2, 1)).toBe(3);
  });

  it('keeps regional-indicator pairing anchored to the full run', () => {
    const indicator = '\u{1f1eb}';
    const text = `${indicator.repeat(35)}x`;
    expect(previousGraphemeIndex(text, 68)).toBe(64);
    expect(nextGraphemeIndex(text, 64)).toBe(68);
    expect(snapToGrapheme(text, 66)).toBe(64);
  });

  it('uses code-point boundaries when the runtime lacks grapheme segmentation', async () => {
    vi.stubGlobal('Intl', {});
    vi.resetModules();
    const steps = await import('./grapheme-steps.js');
    const text = 'a\u{1f468}b';
    expect(steps.snapToGrapheme(text, 2)).toBe(1);
    expect(steps.snapToGrapheme(text, 2, 1)).toBe(3);
    expect(steps.snapToGrapheme(text, 1, 1)).toBe(1);
  });

  it('falls back for out-of-range step probes not covered by a segment', () => {
    expect(previousGraphemeIndex('abc', 5)).toBe(4);
    expect(nextGraphemeIndex('abc', -1)).toBe(0);
  });
});
