import type { MouseEvent } from 'react';
import { describe, expect, it } from 'vitest';

import { isPlainClick } from './plain-click.js';

/**
 * A click with the given button and modifiers.
 *
 * @param init - The button and the modifiers held.
 * @returns The click, as React passes it.
 */
function click(
  init: Partial<Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>,
): MouseEvent {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  } as MouseEvent;
}

describe('isPlainClick', () => {
  it('handles the primary button with no modifier', () => {
    expect(isPlainClick(click({}))).toBe(true);
  });

  it('leaves other buttons and modified clicks to the browser', () => {
    expect(isPlainClick(click({ button: 1 }))).toBe(false);
    expect(isPlainClick(click({ metaKey: true }))).toBe(false);
    expect(isPlainClick(click({ ctrlKey: true }))).toBe(false);
    expect(isPlainClick(click({ shiftKey: true }))).toBe(false);
    expect(isPlainClick(click({ altKey: true }))).toBe(false);
  });
});
