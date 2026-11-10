import { describe, expect, it } from 'vitest';

import type { AutoLayout } from '../fields/auto-layout.js';

import { layOutStack, stackLayoutOf, type StackLayout, type StackNode } from './stack-layout.js';

const PADDING = { top: 0, right: 10, bottom: 0, left: 10 };

/**
 * Builds a row layout with optional test changes.
 *
 * @param fields - Layout overrides.
 * @returns The row layout.
 */
function layout(fields: Partial<StackLayout> = {}): StackLayout {
  return {
    direction: 'row',
    gap: 10,
    padding: PADDING,
    align: 'start',
    isHuggingWidth: false,
    isHuggingHeight: false,
    ...fields,
  };
}

/**
 * Indexes exact placements by key.
 *
 * @param root - Layout tree.
 * @returns Each placement without its redundant key.
 */
function placements(
  root: StackNode,
): Record<string, Omit<ReturnType<typeof layOutStack>[number], 'key'>> {
  return Object.fromEntries(layOutStack(root).map(({ key, ...place }) => [key, place]));
}

/**
 * Makes a 200 by 30 row of two 40 by 20 children.
 *
 * @param justify - Main-axis justification.
 * @returns The row tree.
 */
function fixedRow(justify?: StackLayout['justify']): StackNode {
  return {
    key: 'row',
    width: 200,
    height: 30,
    layout: layout({ justify }),
    children: [
      { key: 'first', width: 40, height: 20 },
      { key: 'second', width: 40, height: 20 },
    ],
  };
}

describe('pure schema stack layout', () => {
  it.each([
    ['start', 10, 60],
    ['center', 55, 105],
    ['end', 100, 150],
    ['space-between', 10, 150],
  ] as const)(
    'places a fixed row with %s justification at exact x positions',
    (justify, firstX, secondX) => {
      const placed = placements(fixedRow(justify));
      expect(placed.row).toEqual({ x: 0, y: 0, width: 200, height: 30 });
      expect(placed.first).toEqual({ x: firstX, y: 0, width: 40, height: 20 });
      expect(placed.second).toEqual({ x: secondX, y: 0, width: 40, height: 20 });
    },
  );

  it('defaults justification to start and treats one space-between child as start', () => {
    expect(placements(fixedRow()).first?.x).toBe(10);
    const one = {
      ...fixedRow('space-between'),
      children: [{ key: 'only', width: 40, height: 20 }],
    };
    expect(placements(one).only?.x).toBe(10);
  });

  it('overflows from padding start when free main-axis space is negative', () => {
    const row = { ...fixedRow('end'), width: 80 };
    expect(placements(row).first?.x).toBe(10);
    expect(placements(row).second?.x).toBe(60);
  });

  it('omits hidden children from placements, gaps, and hugging size', () => {
    const hidden: StackNode = { key: 'first', width: 40, height: 20, isHidden: true };
    const row = { ...fixedRow(), children: [hidden, { key: 'second', width: 40, height: 20 }] };
    expect(placements(row).first).toBeUndefined();
    expect(placements(row).second?.x).toBe(10);
    const hugging = { ...row, width: 0, layout: layout({ isHuggingWidth: true }) };
    expect(placements(hugging).row?.width).toBe(60);
    expect(placements(hugging).second?.x).toBe(10);
  });

  it('preserves fill, cross alignment, wrapping, and input purity', () => {
    const row: StackNode = {
      key: 'row',
      width: 200,
      height: 40,
      layout: layout({ align: 'center' }),
      children: [
        { key: 'label', width: 30, height: 20 },
        { key: 'fill', width: 0, height: 20, isFilling: true },
      ],
    };
    const before = structuredClone(row);
    expect(placements(row)).toEqual({
      row: { x: 0, y: 0, width: 200, height: 40 },
      label: { x: 10, y: 10, width: 30, height: 20 },
      fill: { x: 50, y: 10, width: 140, height: 20 },
    });
    expect(row).toEqual(before);
    const column: StackNode = {
      key: 'column',
      width: 100,
      height: 0,
      layout: layout({
        direction: 'column',
        align: 'stretch',
        isHuggingHeight: true,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      children: [
        {
          key: 'text',
          width: 300,
          height: 20,
          heightForWidth: (width) => Math.ceil(300 / width) * 20,
        },
      ],
    };
    expect(placements(column).text).toEqual({ x: 0, y: 0, width: 100, height: 60 });
  });

  it('maps stored sizing, justification, gap, padding and alignment', () => {
    const stored: AutoLayout = {
      direction: 'column',
      gap: 8,
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
      align: 'stretch',
      justify: 'end',
      width: 'hug',
      height: 'fixed',
    };
    expect(stackLayoutOf(stored)).toEqual({
      direction: 'column',
      gap: 8,
      padding: stored.padding,
      align: 'stretch',
      justify: 'end',
      isHuggingWidth: true,
      isHuggingHeight: false,
    });
  });
});
