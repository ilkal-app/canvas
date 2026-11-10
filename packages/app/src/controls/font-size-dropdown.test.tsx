// @vitest-environment jsdom
// The font size menu's keyboard (review): Tab from its choices reaches the Custom field,
// Shift+Tab goes back to the choices, and Tab on from the field leaves the menu.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FontSizeDropdown } from './font-size-dropdown.js';

afterEach(cleanup);

/**
 * Opens the dropdown at 16 px.
 *
 * @returns The handler.
 */
function openAt16(): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<FontSizeDropdown value={16} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
  return onChange;
}

describe('FontSizeDropdown keyboard', () => {
  it('Tab from a choice moves to the Custom field and keeps the menu open', () => {
    openAt16();
    const medium = screen.getByRole('menuitemradio', { name: /^Medium/ });
    medium.focus();
    fireEvent.keyDown(medium, { key: 'Tab' });
    const custom = screen.getByRole('spinbutton', { name: 'Custom font size' });
    expect(document.activeElement).toBe(custom);
    expect(screen.getByRole('menu', { name: 'Font size' })).toBeTruthy();
  });

  it('Shift+Tab from the field goes back to the checked choice; Tab on closes the menu', () => {
    const onChange = openAt16();
    const custom = screen.getByRole('spinbutton', { name: 'Custom font size' });
    custom.focus();
    fireEvent.keyDown(custom, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^Medium/ }));
    custom.focus();
    fireEvent.keyDown(custom, { key: 'Tab' });
    expect(screen.queryByRole('menu', { name: 'Font size' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter in the field applies a whole size and closes the menu', () => {
    const onChange = openAt16();
    const custom = screen.getByRole('spinbutton', { name: 'Custom font size' });
    fireEvent.change(custom, { target: { value: '40' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(40);
    expect(screen.queryByRole('menu', { name: 'Font size' })).toBeNull();
  });
});
