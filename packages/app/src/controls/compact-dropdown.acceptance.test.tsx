// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactDropdown, type CompactDropdownOption } from './compact-dropdown.js';

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(150);
  return () => {
    vi.restoreAllMocks();
  };
});

const OPTIONS: readonly CompactDropdownOption<'small' | 'medium' | 'large'>[] = [
  { value: 'small', label: 'Small', meta: '12' },
  { value: 'medium', label: 'Medium', meta: '16', triggerLabel: '16' },
  { value: 'large', label: 'Large', meta: '24' },
];

/**
 * Holds the selected value so changed choices are reflected in the trigger.
 *
 * @param props - Change observer and disabled state.
 * @param props.onChange - Receives a different selected value.
 * @param props.isDisabled - Whether the trigger cannot open.
 * @returns The dropdown.
 */
function DropdownHarness(props: {
  readonly onChange: (value: string) => void;
  readonly isDisabled?: boolean;
}): ReactElement {
  const [value, setValue] = useState<'small' | 'medium' | 'large'>('medium');
  return (
    <CompactDropdown
      label="Font size"
      value={value}
      options={OPTIONS}
      isDisabled={props.isDisabled}
      onChange={(next) => {
        props.onChange(next);
        setValue(next);
      }}
    />
  );
}

/**
 * Sends a key to the focused control.
 *
 * @param key - Keyboard key to send.
 */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('CompactDropdown acceptance', () => {
  it('names its trigger with the shown value and exposes menu button state', () => {
    render(<DropdownHarness onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    expect(trigger.textContent).toBe('16');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Font size' });
    const choices = within(menu).getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(choices.map((choice) => choice.querySelectorAll('svg').length)).toEqual([0, 1, 0]);
    expect(choices.every((choice) => choice.tabIndex === -1)).toBe(true);
    expect(document.activeElement).toBe(choices[1]);
  });

  it.each(['Enter', ' '])('opens on the checked choice with %s', (key) => {
    render(<DropdownHarness onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Medium16' }));
  });

  it('opens on the checked choice with ArrowDown and the last with ArrowUp', () => {
    render(<DropdownHarness onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Medium16' }));
    press('Escape');
    expect(document.activeElement).toBe(trigger);
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Large24' }));
  });

  it('changes a different choice once and returns focus to the updated trigger', () => {
    const onChange = vi.fn();
    render(<DropdownHarness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Small12' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('small');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Font size: Small' }));
  });

  it('does not report a change when choosing the current value', () => {
    const onChange = vi.fn();
    render(<DropdownHarness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Medium16' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps a disabled trigger disabled and closed', () => {
    render(<DropdownHarness onChange={vi.fn()} isDisabled />);
    const trigger = screen.getByRole('button', { name: 'Font size: 16' });
    expect(trigger).toHaveProperty('disabled', true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
