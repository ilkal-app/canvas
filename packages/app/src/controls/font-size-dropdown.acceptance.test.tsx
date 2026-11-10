// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MIXED } from '../panels/controls/mixed-value.js';

import {
  CUSTOM_FONT_SIZE_MAX,
  CUSTOM_FONT_SIZE_MIN,
  FONT_SIZE_PRESETS,
  FontSizeDropdown,
} from './font-size-dropdown.js';

afterEach(cleanup);

describe('font size dropdown acceptance', () => {
  it('offers the four named sizes, a separator and the current custom value', () => {
    expect(FONT_SIZE_PRESETS).toEqual([
      { label: 'Small', size: 12 },
      { label: 'Medium', size: 16 },
      { label: 'Large', size: 24 },
      { label: 'Extra large', size: 32 },
    ]);
    expect([CUSTOM_FONT_SIZE_MIN, CUSTOM_FONT_SIZE_MAX]).toEqual([8, 400]);
    render(<FontSizeDropdown value={19} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 19' });
    // A dialog round the sizes' menu and the Custom field, which a menu may not hold.
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(trigger);
    const popup = screen.getByRole('dialog', { name: 'Font size' });
    const menu = within(popup).getByRole('menu', { name: 'Font size' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/^Small/),
      expect.stringMatching(/^Medium/),
      expect.stringMatching(/^Large/),
      expect.stringMatching(/^Extra large/),
    ]);
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    expect(within(popup).getByRole('separator')).not.toBeNull();
    expect(within(menu).queryByRole('spinbutton')).toBeNull();
    const custom = within(popup).getByRole('spinbutton', { name: 'Custom font size' });
    expect(custom.getAttribute('min')).toBe('8');
    expect(custom.getAttribute('max')).toBe('400');
    expect((custom as HTMLInputElement).value).toBe('19');
  });

  it('shows Mixed without a checked preset and applies a preset once', () => {
    const onChange = vi.fn();
    render(<FontSizeDropdown value={MIXED} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Font size: Mixed' });
    expect(trigger.textContent).toContain('Mixed');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Font size' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Large/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(24);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not apply the selected preset again', () => {
    const onChange = vi.fn();
    render(<FontSizeDropdown value={16} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
    const choice = screen.getByRole('menuitemradio', { name: /^Medium/ });
    expect(choice.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(choice);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([8, 400])('accepts custom boundary %i on Enter', (size) => {
    const onChange = vi.fn();
    render(<FontSizeDropdown value={MIXED} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font size: Mixed' }));
    const input = screen.getByRole('spinbutton', { name: 'Custom font size' });
    fireEvent.change(input, { target: { value: String(size) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(size);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['7', '401', '12.5', ''])('rejects invalid custom size %s', (value) => {
    const onChange = vi.fn();
    render(<FontSizeDropdown value={16} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
    const input = screen.getByRole('spinbutton', { name: 'Custom font size' });
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Escape without changing and respects disabled state', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FontSizeDropdown value={16} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Custom font size' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    rerender(<FontSizeDropdown value={16} onChange={onChange} isDisabled />);
    expect(screen.getByRole('button', { name: 'Font size: 16' })).toHaveProperty('disabled', true);
  });
});
