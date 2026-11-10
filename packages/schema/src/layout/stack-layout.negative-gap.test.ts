import { describe, expect, it } from 'vitest';

import { autoLayoutSchema } from '../fields/auto-layout.js';
import { BOARD_BOUND } from '../fields/board-bound.js';

import { layOutStack, type StackLayout, type StackNode } from './stack-layout.js';

// A negative gap overlaps neighbouring children (the MX benchmark's avatar stacks, -4 and
// -6), the later child drawn on top by its z order; the content never measures below nothing; a
// spread (space-between in a container of its own size) ignores the gap, as Figma's auto gap does.

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * A row layout.
 *
 * @param fields - Fields that differ.
 * @returns The layout.
 */
function row(fields: Partial<StackLayout> = {}): StackLayout {
  return {
    direction: 'row',
    gap: 0,
    padding: NO_PADDING,
    align: 'start',
    isHuggingWidth: true,
    isHuggingHeight: true,
    ...fields,
  };
}

/**
 * A box.
 *
 * @param key - Its key.
 * @param width - Its width.
 * @param height - Its height.
 * @param fields - Fields to add.
 * @returns The node.
 */
function box(key: string, width: number, height: number, fields: Partial<StackNode> = {}) {
  return { key, width, height, ...fields };
}

/**
 * Lays a root out and lists placements by key.
 *
 * @param root - The root.
 * @returns Each placement without its key.
 */
function byKey(root: StackNode) {
  return Object.fromEntries(layOutStack(root).map(({ key, ...rest }) => [key, rest]));
}

const AVATARS = [box('a', 28, 28), box('b', 28, 28), box('c', 28, 28)];

describe('a negative gap', () => {
  it('overlaps an avatar stack and hugs it: 3 × 28 − 2 × 4 = 76', () => {
    const laid = byKey(box('stack', 0, 0, { layout: row({ gap: -4 }), children: AVATARS }));
    expect(laid.stack).toEqual({ x: 0, y: 0, width: 76, height: 28 });
    expect([laid.a?.x, laid.b?.x, laid.c?.x]).toEqual([0, 24, 48]);
  });

  it('never hugs below its padding, however far the children overlap', () => {
    const padding = { top: 2, right: 3, bottom: 2, left: 5 };
    const laid = byKey(
      box('stack', 0, 0, { layout: row({ gap: -100, padding }), children: AVATARS }),
    );
    expect(laid.stack).toMatchObject({ width: 5 + 3, height: 2 + 28 + 2 });
    expect(Object.values(laid).every(({ width, height }) => width >= 0 && height >= 0)).toBe(true);
  });

  it('gives fillers the space the overlap frees in a fixed row', () => {
    const laid = byKey(
      box('stack', 100, 28, {
        layout: row({ gap: -4, isHuggingWidth: false }),
        children: [box('a', 28, 28), box('b', 0, 28, { isFilling: true })],
      }),
    );
    // 100 − 28 + 4: the filler starts 4 inside the first child and reaches the far edge.
    expect(laid.b).toEqual({ x: 24, y: 0, width: 76, height: 28 });
  });

  it('is ignored by a spread, which meets edge to edge when the children do not fit', () => {
    const spread = (gap: number, width: number) =>
      byKey(
        box('stack', width, 28, {
          layout: row({ gap, justify: 'space-between', isHuggingWidth: false }),
          children: AVATARS,
        }),
      );
    // They fit: spread evenly whatever the gap.
    for (const gap of [-6, 0, 10]) {
      expect([spread(gap, 100).b?.x, spread(gap, 100).c?.x]).toEqual([36, 72]);
    }
    // They do not fit: edge to edge, neither overlapping by a negative gap nor parted by a positive.
    for (const gap of [-6, 10]) {
      expect([spread(gap, 60).b?.x, spread(gap, 60).c?.x]).toEqual([28, 56]);
    }
  });

  it('keeps the gap when a spread hugs, having no space to share', () => {
    const laid = byKey(
      box('stack', 0, 0, { layout: row({ gap: -4, justify: 'space-between' }), children: AVATARS }),
    );
    expect(laid.stack?.width).toBe(76);
  });

  it('is a valid stored gap down to minus the board bound, while padding stays at 0 or more', () => {
    const stored = {
      direction: 'row',
      gap: -6,
      padding: NO_PADDING,
      align: 'start',
      justify: 'start',
      width: 'hug',
      height: 'hug',
    } as const;
    expect(autoLayoutSchema.safeParse(stored).success).toBe(true);
    expect(autoLayoutSchema.safeParse({ ...stored, gap: -BOARD_BOUND }).success).toBe(true);
    expect(autoLayoutSchema.safeParse({ ...stored, gap: -BOARD_BOUND - 1 }).success).toBe(false);
    const padded = { ...stored, padding: { ...NO_PADDING, left: -1 } };
    expect(autoLayoutSchema.safeParse(padded).success).toBe(false);
  });
});
