// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import colourStyles from '../controls/colour-button.module.css';
import type { ShellAction } from '../state/shell-action.js';

import { mount, preparePopover, propsOf, rowOf } from './popover-shape-connector-fixtures.js';
import { IMAGE, IMAGE_2 } from './popover-viv-629-fixtures.js';

function bordered(image: typeof IMAGE, width: number): typeof IMAGE {
  return { ...image, border: { color: 'ink', width } } as unknown as typeof IMAGE;
}

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function choose(choice: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^Border:/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: choice }));
}

describe('image border popover', () => {
  it('shows a 46 px colour trigger with None, shared colour and Mixed', () => {
    const toolbar = mount(propsOf([IMAGE]));
    expect(rowOf(toolbar)).toContain('Border: None');
    const button = screen.getByRole('button', { name: 'Border: None' });
    expect(button.classList.contains(colourStyles.trigger ?? '')).toBe(true);
    cleanup();
    mount(propsOf([bordered(IMAGE, 2), bordered(IMAGE_2, 5)]));
    screen.getByRole('button', { name: /^Border: Ink$/ });
    cleanup();
    mount(propsOf([bordered(IMAGE, 2), IMAGE_2]));
    screen.getByRole('button', { name: 'Border: Mixed' });
  });

  it('sets each unlocked image border in one action, preserving each width or using 2', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([bordered(IMAGE, 5), IMAGE_2], { dispatch }));
    choose('accent');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: IMAGE.id, style: { border: { color: { token: 'accent' }, width: 5 } } },
        { id: IMAGE_2.id, style: { border: { color: { token: 'accent' }, width: 2 } } },
      ],
    });
  });

  it('sets border to null for None in one action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([bordered(IMAGE, 2), bordered(IMAGE_2, 5)], { dispatch }));
    choose('None');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: IMAGE.id, style: { border: null } },
        { id: IMAGE_2.id, style: { border: null } },
      ],
    });
  });

  it('disables the border trigger for locked images', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([{ ...IMAGE, locked: true }], { dispatch }));
    const button = screen.getByRole('button', { name: /^Border:/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('skips locked images when an unlocked image is also selected', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([IMAGE, { ...IMAGE_2, locked: true }], { dispatch }));
    choose('accent');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: IMAGE.id, style: { border: { color: { token: 'accent' }, width: 2 } } }],
    });
  });
});
