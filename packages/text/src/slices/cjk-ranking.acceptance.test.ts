import { describe, expect, it } from 'vitest';

import { scriptOf } from '@canvas/text';

import { FAMILIES, slices } from './__fixtures__/cjk-slice-contract.js';

function rankedSc(): number[] {
  const decoder = new TextDecoder('gb2312');
  const ranked: number[] = [];
  const seen = new Set<number>();
  for (let lead = 0xb0; lead <= 0xf7; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      const decoded = decoder.decode(Uint8Array.of(lead, trail));
      const codepoint = decoded.codePointAt(0);
      if (
        codepoint !== undefined &&
        decoded === String.fromCodePoint(codepoint) &&
        scriptOf(codepoint) === 'Hani' &&
        !seen.has(codepoint)
      ) {
        seen.add(codepoint);
        ranked.push(codepoint);
      }
    }
  }
  return ranked;
}

function rankedHan(
  encoding: string,
  leads: readonly number[],
  trails: readonly number[],
): number[] {
  const decoder = new TextDecoder(encoding);
  const seen = new Set<number>();
  const ranked: number[] = [];
  for (const lead of leads) {
    for (const trail of trails) {
      const decoded = decoder.decode(Uint8Array.of(lead, trail));
      const codepoint = decoded.codePointAt(0);
      if (
        codepoint !== undefined &&
        decoded === String.fromCodePoint(codepoint) &&
        scriptOf(codepoint) === 'Hani' &&
        !seen.has(codepoint)
      ) {
        seen.add(codepoint);
        ranked.push(codepoint);
      }
    }
  }
  return ranked;
}

function row(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

describe('CJK slice ids', () => {
  // Each standard orders its common level by reading or strokes, not frequency, so common text
  // needs it whole: it is one slice, `han-0`; the rest go 500 a slice (the slicing's first design,
  // revised when this test found 的 at GB 2312 rank 870).
  it('puts GB 2312 level 1 in han-0, level 2 in 500s, and other ideographs in windows', () => {
    const common = rankedHan('gb2312', row(0xb0, 0xd7), row(0xa1, 0xfe));
    const rest = rankedHan('gb2312', row(0xd8, 0xf7), row(0xa1, 0xfe));
    expect(common).toHaveLength(3755);
    expect(slices.cjkSliceOf('Noto Sans SC', 0x7684)).toBe('han-0');
    for (const codepoint of common)
      expect(slices.cjkSliceOf('Noto Sans SC', codepoint)).toBe('han-0');
    expect(slices.cjkSliceOf('Noto Sans SC', rest[0] ?? 0)).toBe('han-1');
    expect(slices.cjkSliceOf('Noto Sans SC', rest[499] ?? 0)).toBe('han-1');
    expect(slices.cjkSliceOf('Noto Sans SC', rest[500] ?? 0)).toBe('han-2');
    expect(rankedSc()).not.toContain(0x3400);
    expect(slices.cjkSliceOf('Noto Sans SC', 0x3400)).toBe('han-x-0');
    // Ideographs before U+3400 ride with base: 〇 and 々.
    expect(slices.cjkSliceOf('Noto Sans SC', 0x3007)).toBe('base');
    expect(slices.cjkSliceOf('Noto Sans JP', 0x3005)).toBe('base');
  });

  it.each([
    [
      'Noto Sans TC',
      'big5',
      row(0xa4, 0xc6),
      row(0xc9, 0xf9),
      [...row(0x40, 0x7e), ...row(0xa1, 0xfe)],
    ],
    [
      'Noto Sans HK',
      'big5',
      row(0xa4, 0xc6),
      row(0xc9, 0xf9),
      [...row(0x40, 0x7e), ...row(0xa1, 0xfe)],
    ],
    ['Noto Sans JP', 'euc-jp', row(0xb0, 0xcf), row(0xd0, 0xf4), row(0xa1, 0xfe)],
  ] as const)(
    'puts %s legacy level 1 in han-0 and the rest in 500s',
    (family, encoding, common, rest, trails) => {
      const commonRanked = rankedHan(encoding, common, trails);
      const restRanked = rankedHan(encoding, rest, trails).filter(
        (point) => !commonRanked.includes(point),
      );
      expect(commonRanked.length).toBeGreaterThan(2000);
      for (const codepoint of commonRanked) {
        expect(slices.cjkSliceOf(family, codepoint)).toBe('han-0');
      }
      expect(slices.cjkSliceOf(family, restRanked[0] ?? 0)).toBe('han-1');
      expect(slices.cjkSliceOf(family, restRanked[500] ?? 0)).toBe('han-2');
    },
  );

  it('puts KS X 1001 Hanja, which Korean text seldom uses, 500 a slice from han-0', () => {
    const ranked = rankedHan('euc-kr', row(0xca, 0xfd), row(0xa1, 0xfe));
    expect(ranked).toHaveLength(4888);
    expect(slices.cjkSliceOf('Noto Sans KR', ranked[0] ?? 0)).toBe('han-0');
    expect(slices.cjkSliceOf('Noto Sans KR', ranked[499] ?? 0)).toBe('han-0');
    expect(slices.cjkSliceOf('Noto Sans KR', ranked[500] ?? 0)).toBe('han-1');
  });

  it.each(FAMILIES)('keeps common non-Han characters in %s base', (family) => {
    for (const codepoint of [0x41, 0x3042, 0x30a2, 0x3001, 0xff21]) {
      expect(slices.cjkSliceOf(family, codepoint)).toBe('base');
    }
  });

  it('ranks Korean syllables separately, and leaves syllables in other families in base', () => {
    expect(slices.cjkSliceOf('Noto Sans KR', 0xac00)).toBe('hangul-0');
    const decoder = new TextDecoder('euc-kr');
    const ranked = new Set<number>();
    const order: number[] = [];
    for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
      for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
        const decoded = decoder.decode(Uint8Array.of(lead, trail));
        const codepoint = decoded.codePointAt(0);
        if (codepoint !== undefined && decoded === String.fromCodePoint(codepoint)) {
          if (!ranked.has(codepoint)) order.push(codepoint);
          ranked.add(codepoint);
        }
      }
    }
    expect(order).toHaveLength(2350);
    const lastFirstSlice = order[1174];
    const firstSecondSlice = order[1175];
    if (lastFirstSlice === undefined || firstSecondSlice === undefined)
      throw new Error('KS X 1001 Hangul ranking too short');
    expect(slices.cjkSliceOf('Noto Sans KR', lastFirstSlice)).toBe('hangul-0');
    expect(slices.cjkSliceOf('Noto Sans KR', firstSecondSlice)).toBe('hangul-1');
    let absent: number | undefined;
    for (let codepoint = 0xac00; codepoint <= 0xd7a3; codepoint += 1) {
      if (!ranked.has(codepoint)) {
        absent = codepoint;
        break;
      }
    }
    if (absent === undefined) throw new Error('KS X 1001 has no unranked syllable');
    expect(slices.cjkSliceOf('Noto Sans KR', absent)).toBe(
      `hangul-x-${String(Math.floor((absent - 0xac00) / 2048))}`,
    );
    expect(slices.cjkSliceOf('Noto Sans SC', 0xac00)).toBe('base');
  });

  it('groups ascending codepoints in the specified slice order', () => {
    const points = [0xac00, 0x3400, 0x4e00, 0x41, 0x7684, 0x30a2];
    const groups = slices.cjkSlices('Noto Sans KR', points.reverse());
    const ids = [...groups.keys()];
    expect(ids[0]).toBe('base');
    expect(ids).toEqual(
      [...ids].sort((left, right) => {
        const category = (id: string): number =>
          id === 'base'
            ? 0
            : id.startsWith('han-x-')
              ? 2
              : id.startsWith('han-')
                ? 1
                : id.startsWith('hangul-x-')
                  ? 4
                  : 3;
        return (
          category(left) - category(right) ||
          Number(left.split('-').at(-1)) - Number(right.split('-').at(-1))
        );
      }),
    );
    for (const values of groups.values()) expect(values).toEqual([...values].sort((a, b) => a - b));
    expect([...groups.values()].flat().sort((a, b) => a - b)).toEqual(
      [...points].sort((a, b) => a - b),
    );
  });

  it('rejects unknown families', () => {
    expect(() => slices.cjkSliceOf('Noto Sans', 0x4e00)).toThrow(RangeError);
    expect(() => slices.cjkSlices('Noto Sans', [0x4e00])).toThrow(RangeError);
  });
});
