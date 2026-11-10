import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REAL_SEGMENTER = Intl.Segmenter;

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
const FLAG = '\u{1F1EB}\u{1F1F7}';
const SECOND_FLAG = '\u{1F1E9}\u{1F1EA}';

/**
 * Safari's grapheme `containing` (seen in Playwright's WebKit): at the start of a
 * cluster that begins with a surrogate pair, the cluster joined to the one before it. Iterating
 * is right, so this reproduces the answer from the real segments.
 */
class SafariLikeSegmenter extends REAL_SEGMENTER {
  override segment(input: string): Intl.Segments {
    const segments = super.segment(input);
    if (this.resolvedOptions().granularity !== 'grapheme') return segments;
    const all = [...segments];
    return {
      containing: (index = 0) => {
        const at = all.findIndex(
          (segment) => index >= segment.index && index < segment.index + segment.segment.length,
        );
        const found = all[at];
        const before = all[at - 1];
        const isSurrogateStart = (found?.segment.codePointAt(0) ?? 0) > 0xffff;
        if (found === undefined || before === undefined || found.index !== index) return found;
        if (!isSurrogateStart) return found;
        return { ...before, segment: before.segment + found.segment };
      },
      [Symbol.iterator]: () => all[Symbol.iterator](),
    };
  }
}

afterEach(() => vi.unstubAllGlobals());

describe.each([
  { name: 'Safari-like segmenter', isSafariLike: true },
  { name: 'real segmenter', isSafariLike: false },
])('$name', ({ isSafariLike }) => {
  beforeEach(() => {
    if (isSafariLike) {
      vi.stubGlobal(
        'Intl',
        Object.assign(Object.create(Intl) as typeof Intl, { Segmenter: SafariLikeSegmenter }),
      );
    }
    // grapheme-steps caches its segmenter, so each test must create its own module instance.
    vi.resetModules();
  });

  it('steps right onto and over a joined emoji and a flag', async () => {
    const { nextGraphemeIndex } = await import('./grapheme-steps.js');
    expect(nextGraphemeIndex(`a${FAMILY}b`, 1)).toBe(1 + FAMILY.length);
    expect(nextGraphemeIndex(`a${FLAG}b`, 1)).toBe(1 + FLAG.length);
    expect(nextGraphemeIndex(`${FLAG}${SECOND_FLAG}`, FLAG.length)).toBe(2 * FLAG.length);
  });

  it('steps left over a joined emoji and a flag', async () => {
    const { previousGraphemeIndex } = await import('./grapheme-steps.js');
    expect(previousGraphemeIndex(`a${FAMILY}b`, 1 + FAMILY.length)).toBe(1);
    expect(previousGraphemeIndex(`${FLAG}${SECOND_FLAG}`, 2 * FLAG.length)).toBe(FLAG.length);
  });

  it('keeps a boundary before an emoji or a flag', async () => {
    const { snapToGrapheme } = await import('./grapheme-steps.js');
    expect(snapToGrapheme(`a${FAMILY}b`, 1)).toBe(1);
    expect(snapToGrapheme(`a${FAMILY}b`, 1, 1)).toBe(1);
    expect(snapToGrapheme(`${FLAG}${SECOND_FLAG}`, FLAG.length)).toBe(FLAG.length);
  });

  it('still snaps a position inside a cluster to its edges', async () => {
    const { snapToGrapheme } = await import('./grapheme-steps.js');
    expect(snapToGrapheme(`a${FAMILY}b`, 3)).toBe(1);
    expect(snapToGrapheme(`a${FAMILY}b`, 3, 1)).toBe(1 + FAMILY.length);
    expect(snapToGrapheme(`a${FLAG}b`, 3)).toBe(1);
  });
});
