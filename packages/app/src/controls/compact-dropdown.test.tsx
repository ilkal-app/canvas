// @vitest-environment jsdom
// The compact dropdown: its trigger, its compact menu with a check by the current
// choice, and its keys. Geometry in a real browser is the scenario's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactDropdown, type CompactDropdownOption } from './compact-dropdown.js';
import dropdownCss from './compact-dropdown.module.css?raw';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(184);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
  return () => {
    vi.restoreAllMocks();
  };
});

const SIZES: readonly CompactDropdownOption<'s' | 'm' | 'l'>[] = [
  { value: 's', label: 'Small', meta: '12', triggerLabel: '12' },
  { value: 'm', label: 'Medium', meta: '16', triggerLabel: '16' },
  { value: 'l', label: 'Large', meta: '24', triggerLabel: '24' },
];

/**
 * Presses a key on the focused element.
 *
 * @param key - The key.
 */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/**
 * A size dropdown holding its own value, reporting changes.
 *
 * @param props - The change recorder.
 * @param props.onChange - Receives each change.
 * @returns The dropdown.
 */
function Sizes(props: { readonly onChange: (value: string) => void }): ReactElement {
  const [value, setValue] = useState<'s' | 'm' | 'l'>('m');
  return (
    <CompactDropdown
      label="Font size"
      value={value}
      options={SIZES}
      onChange={(next) => {
        props.onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('CompactDropdown', () => {
  it('is a menu button named with its value, showing the short value and a chevron', () => {
    render(<Sizes onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toBe('16');
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(trigger.dataset.variant).toBe('quiet');
  });

  it('opens on the checked choice, each with its value at the end', () => {
    render(<Sizes onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Font size' });
    const choices = within(menu).getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual(['Small12', 'Medium16', 'Large24']);
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(choices[1]?.querySelector('svg')).not.toBeNull();
    expect(choices[0]?.querySelector('svg')).toBeNull();
    expect(document.activeElement).toBe(choices[1]);
  });

  it('chooses by keyboard: focus back on the trigger, the new value shown, one change', () => {
    const onChange = vi.fn();
    render(<Sizes onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Medium16');
    press('ArrowDown');
    act(() => {
      (document.activeElement as HTMLElement).click();
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('l');
    expect(screen.queryByRole('menu')).toBeNull();
    const shown = screen.getByRole('button', { name: 'Font size: 24' });
    expect(document.activeElement).toBe(shown);
  });

  it('opens on the last choice from Arrow Up, and Escape returns without a change', () => {
    const onChange = vi.fn();
    render(<Sizes onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('Large24');
    press('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports no change for the current choice', () => {
    const onChange = vi.fn();
    render(<Sizes onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Medium16' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is disabled at 38% and takes the field look and a width when asked', () => {
    render(
      <>
        <CompactDropdown label="Size" value="m" options={SIZES} isDisabled onChange={vi.fn()} />
        <CompactDropdown
          label="Kind"
          value="s"
          options={SIZES}
          variant="field"
          width={168}
          onChange={vi.fn()}
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Size: 16' })).toHaveProperty('disabled', true);
    const field = screen.getByRole('button', { name: 'Kind: 12' });
    expect(field.dataset.variant).toBe('field');
    expect(field.style.width).toBe('168px');
    expect(dropdownCss).toMatch(/\.trigger:disabled \{[^}]*opacity: 0\.38;/);
    expect(dropdownCss).toMatch(/\.trigger \{[^}]*height: 28px;/);
    expect(dropdownCss).toMatch(/@media \(pointer: coarse\) \{\s*\.trigger \{\s*height: 48px;/);
  });

  it('grows with its value between a least and a most width', () => {
    render(
      <CompactDropdown
        label="Font"
        value="m"
        options={SIZES}
        width={80}
        maxWidth={160}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Font: 16' });
    expect(trigger.style.width).toBe('');
    expect(trigger.style.minWidth).toBe('80px');
    expect(trigger.style.maxWidth).toBe('160px');
  });
});
