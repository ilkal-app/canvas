// @vitest-environment jsdom
// Item 13: sections and images of one type get arrange and
// Group too, and a section's row (which ends in a rule) gets no second rule before them.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, preparePopover, propsOf } from './popover-shape-connector-fixtures.js';
import { FRAME, FRAME_2, IMAGE, IMAGE_2 } from './popover-viv-629-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The popover's buttons and rules in order, a rule as "|".
 *
 * @param toolbar - The Selection toolbar.
 * @returns The names, with a pipe for each rule.
 */
function rowOf(toolbar: HTMLElement): (string | null)[] {
  return [...toolbar.querySelectorAll('button, [data-popover-divider]')].map((element) =>
    element.hasAttribute('data-popover-divider') ? '|' : element.getAttribute('aria-label'),
  );
}

describe('same-type arrange: sections and images', () => {
  it.each([
    ['sections', [FRAME, FRAME_2]],
    ['images', [IMAGE, IMAGE_2]],
  ] as const)('two %s get arrange and Group, never two rules side by side', (type, objects) => {
    const toolbar = mount(propsOf(objects));
    expect(objects, type).toHaveLength(2);
    const row = rowOf(toolbar);
    for (const name of [
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(row.some((item, index) => item === '|' && row[index + 1] === '|')).toBe(false);
    expect(row[row.indexOf('Align horizontally') - 1]).toBe('|');
  });
});
