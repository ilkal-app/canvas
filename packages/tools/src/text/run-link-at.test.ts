import { describe, expect, it } from 'vitest';

import type { StyleRun } from '@canvas/schema';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { TEN } from './__fixtures__/text-mode-context.js';
import { linkAtLayoutPoint, linkHitAtLayoutPoint } from './run-link-at.js';
import { linkSpansOf } from './runs/link-spans.js';

const A = 'https://example.com/a';
const B = 'https://example.com/b';

/** Ten-point text, 6 units a character: `Go ab cd`, `ab` linked to A, `cd` to B. */
const TEXT = 'Go ab cd';
const RUNS: StyleRun[] = [
  { length: 3, style: TEN },
  { length: 2, style: { ...TEN, link: A } },
  { length: 1, style: TEN },
  { length: 2, style: { ...TEN, link: B } },
];

describe('linkSpansOf', () => {
  it('lists each link once, in reading order', () => {
    expect(linkSpansOf(RUNS)).toEqual([
      { link: A, start: 3, end: 5 },
      { link: B, start: 6, end: 8 },
    ]);
  });

  it('joins one link split over runs of different styles', () => {
    const runs: StyleRun[] = [
      { length: 2, style: { ...TEN, link: A } },
      { length: 3, style: { ...TEN, link: A, weight: 700 } },
      { length: 0, style: TEN },
    ];
    expect(linkSpansOf(runs)).toEqual([{ link: A, start: 0, end: 5 }]);
  });

  it('keeps the same link twice when text without it comes between', () => {
    const runs: StyleRun[] = [
      { length: 1, style: { ...TEN, link: A } },
      { length: 1, style: TEN },
      { length: 1, style: { ...TEN, link: A } },
    ];
    expect(linkSpansOf(runs)).toEqual([
      { link: A, start: 0, end: 1 },
      { link: A, start: 2, end: 3 },
    ]);
  });

  it('finds none in text without links', () => {
    expect(linkSpansOf([{ length: 4, style: TEN }])).toEqual([]);
  });
});

describe('linkHitAtLayoutPoint', () => {
  const layout = monoLayout(TEXT, RUNS);
  const line = layout.lines[0];
  const middle = (line?.y ?? 0) + (line?.height ?? 0) / 2;

  it('finds the link under a point with its span and its box on the line', () => {
    expect(linkHitAtLayoutPoint(layout, { x: 19, y: middle }, RUNS)).toEqual({
      link: A,
      start: 3,
      end: 5,
      box: { x: 18, y: line?.y, width: 12, height: line?.height },
    });
  });

  it('tells two links in one box apart by the glyph under the point', () => {
    expect(linkHitAtLayoutPoint(layout, { x: 37, y: middle }, RUNS)).toMatchObject({
      link: B,
      start: 6,
      end: 8,
      box: { x: 36, width: 12 },
    });
  });

  it.each([
    ['on an unlinked character', 1, middle],
    ['on the space between links', 31, middle],
    ['past the text', 60, middle],
    ['above the line', 19, -1],
  ])('finds nothing %s', (ignored, x, y) => {
    expect(linkHitAtLayoutPoint(layout, { x, y }, RUNS)).toBeUndefined();
    expect(linkAtLayoutPoint(layout, { x, y }, RUNS)).toBeUndefined();
  });

  it('boxes only the part of a wrapped link on the line under the point', () => {
    const text = 'abcdef';
    const runs: StyleRun[] = [{ length: 6, style: { ...TEN, link: A } }];
    // 18 units wide: three characters a line, the link wraps after `abc`.
    const wrapped = monoLayout(text, runs, 18);
    const second = wrapped.lines[1];
    expect(second).toBeDefined();
    const y = (second?.y ?? 0) + 1;
    expect(linkHitAtLayoutPoint(wrapped, { x: 7, y }, runs)).toEqual({
      link: A,
      start: 0,
      end: 6,
      box: { x: 0, y: second?.y, width: 18, height: second?.height },
    });
  });
});
