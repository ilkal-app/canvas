// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MIXED } from '../panels/controls/mixed-value.js';

import { FontFamilyDropdown } from './font-family-dropdown.js';

const FAMILIES = ['Liberation Sans', 'Lora', 'Inter'] as const;
afterEach(cleanup);

describe('font family dropdown acceptance', () => {
  it('shows each supplied family in its own face and checks the current family', () => {
    render(<FontFamilyDropdown value="Lora" families={FAMILIES} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
    const menu = screen.getByRole('menu', { name: 'Font' });
    const choices = within(menu).getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    for (const family of FAMILIES) {
      const item = within(menu).getByRole('menuitemradio', { name: family });
      expect(item.querySelector('[style*="font-family"]')?.getAttribute('style')).toContain(family);
    }
  });

  it('shows Mixed with no checked item and emits one changed choice', () => {
    const onChange = vi.fn();
    render(<FontFamilyDropdown value={MIXED} families={FAMILIES} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font: Mixed' }));
    expect(
      screen
        .getAllByRole('menuitemradio')
        .every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Inter' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Inter');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ignores the current choice and keeps a disabled trigger closed', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FontFamilyDropdown value="Lora" families={FAMILIES} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Lora' }));
    expect(onChange).not.toHaveBeenCalled();
    rerender(
      <FontFamilyDropdown value="Lora" families={FAMILIES} onChange={onChange} isDisabled />,
    );
    const trigger = screen.getByRole('button', { name: 'Font: Lora' });
    expect(trigger).toHaveProperty('disabled', true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
