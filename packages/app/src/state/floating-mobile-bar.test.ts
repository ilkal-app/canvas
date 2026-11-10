import { describe, expect, it } from 'vitest';

import {
  FLOATING_MOBILE_BAR_WIDTHS,
  floatingMobileBarOf,
  floatingMobileBarSlotsFor,
} from './floating-mobile-bar.js';

describe('floatingMobileBarSlotsFor', () => {
  it('holds seven targets from 378 px, six from 330 px and five below', () => {
    expect(floatingMobileBarSlotsFor(767)).toBe(7);
    expect(floatingMobileBarSlotsFor(FLOATING_MOBILE_BAR_WIDTHS.seven)).toBe(7);
    expect(floatingMobileBarSlotsFor(FLOATING_MOBILE_BAR_WIDTHS.seven - 1)).toBe(6);
    expect(floatingMobileBarSlotsFor(360)).toBe(6);
    expect(floatingMobileBarSlotsFor(FLOATING_MOBILE_BAR_WIDTHS.six)).toBe(6);
    expect(floatingMobileBarSlotsFor(FLOATING_MOBILE_BAR_WIDTHS.six - 1)).toBe(5);
    expect(floatingMobileBarSlotsFor(320)).toBe(5);
  });

  it('keeps every target at 48 px within the bar at each threshold', () => {
    // The bar: the viewport less 16 px (374 at most), less 14 px of border and padding; its six
    // parts (three sections, two 1 px dividers, More) 2 px apart.
    for (const width of [FLOATING_MOBILE_BAR_WIDTHS.six, FLOATING_MOBILE_BAR_WIDTHS.seven, 282]) {
      const inside = Math.min(374, width - 16) - 14;
      const slots = floatingMobileBarSlotsFor(width);
      expect(slots * 48 + 2 + 5 * 2).toBeLessThanOrEqual(inside);
    }
  });
});

describe('floatingMobileBarOf on a narrower screen', () => {
  it('moves Draw, then Text, behind More, which keeps the dock order', () => {
    expect(floatingMobileBarOf('editor', 6)).toEqual({
      sections: [
        { id: 'navigate', label: 'Navigate', tools: ['select'] },
        { id: 'stage', label: 'Set the stage', tools: ['shapes', 'text'] },
        { id: 'collaborate', label: 'Collaborate', tools: ['sticky', 'comment'] },
      ],
      more: ['section', 'image', 'connector', 'draw', 'reactions'],
    });
    expect(floatingMobileBarOf('editor', 5)).toEqual({
      sections: [
        { id: 'navigate', label: 'Navigate', tools: ['select'] },
        { id: 'stage', label: 'Set the stage', tools: ['shapes'] },
        { id: 'collaborate', label: 'Collaborate', tools: ['sticky', 'comment'] },
      ],
      more: ['section', 'image', 'text', 'connector', 'draw', 'reactions'],
    });
  });

  it('leaves a commenter and a viewer as they are', () => {
    expect(floatingMobileBarOf('commenter', 5)).toEqual(floatingMobileBarOf('commenter'));
    expect(floatingMobileBarOf('viewer', 5)).toEqual(floatingMobileBarOf('viewer'));
  });
});
