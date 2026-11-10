// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColourButton, parseCustomColour, type ColourGroup } from './colour-button.js';
import colourCss from './colour-button.module.css?raw';

const GROUPS: readonly ColourGroup[] = [
  {
    label: 'Sticky colours',
    choices: [
      { value: 'lemon', label: 'Lemon', swatch: '#ffdd66' },
      { value: 'coral', label: 'Coral', swatch: '#ee8877' },
    ],
  },
  { label: 'Unused', choices: [] },
  {
    label: 'Board tokens',
    choices: [{ value: 'brand', label: 'Brand blue', swatch: 'var(--brand-blue)' }],
  },
  {
    label: 'Recent colours',
    choices: [{ value: '#123456', label: 'Recent blue', swatch: '#123456' }],
  },
];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Mounts the colour control with a fixed selected colour.
 *
 * @param onChange - Receives chosen colours.
 * @param value - The selected value.
 * @param canTakeCustom - Whether to show the custom field.
 * @returns The trigger button.
 */
function mountColour(
  onChange = vi.fn<(value: string) => void>(),
  value = 'coral',
  canTakeCustom = true,
): HTMLElement {
  render(
    <ColourButton
      label="Fill"
      value={value}
      valueLabel="Coral"
      swatch="#ee8877"
      groups={GROUPS}
      canTakeCustom={canTakeCustom}
      onChange={onChange}
    />,
  );
  return screen.getByRole('button', { name: 'Fill: Coral' });
}

/**
 * Opens the palette from its focused trigger.
 *
 * @param trigger - The colour control's trigger.
 * @returns The named palette dialog.
 */
function openPalette(trigger: HTMLElement): HTMLElement {
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('dialog', { name: 'Fill colours' });
}

/**
 * Sends one keyboard event to the currently focused element.
 *
 * @param key - The key to send.
 */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('ColourButton acceptance', () => {
  it('names the trigger, shows its supplied swatch and chevron, and reports dialog state', () => {
    const trigger = mountColour();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('span')?.style.background).toBe('rgb(238, 136, 119)');
    expect(trigger.querySelector('svg')).not.toBeNull();
    openPalette(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['click', 'Enter', ' ', 'ArrowDown'])(
    'opens with %s and focuses the selected choice',
    (method) => {
      const trigger = mountColour();
      trigger.focus();
      if (method === 'click') fireEvent.click(trigger);
      else if (method === 'ArrowDown') press(method);
      else {
        press(method);
        // jsdom does not synthesize native button activation from keydown.
        fireEvent.click(trigger);
      }
      const dialog = screen.getByRole('dialog', { name: 'Fill colours' });
      const coral = within(dialog).getByRole('button', { name: 'Coral' });
      expect(document.activeElement).toBe(coral);
      expect(coral.getAttribute('aria-pressed')).toBe('true');
    },
  );

  it('includes each nonempty named group and one tab stop among all choice buttons', () => {
    const dialog = openPalette(mountColour());
    expect(
      within(dialog)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Sticky colours', 'Board tokens', 'Recent colours']);
    const choices = within(dialog).getAllByRole('button');
    expect(choices.map((choice) => choice.getAttribute('aria-label'))).toEqual([
      'Lemon',
      'Coral',
      'Brand blue',
      'Recent blue',
    ]);
    expect(choices.filter((choice) => choice.getAttribute('aria-pressed') === 'true')).toEqual([
      within(dialog).getByRole('button', { name: 'Coral' }),
    ]);
    expect(choices.filter((choice) => choice.tabIndex === 0)).toEqual([
      within(dialog).getByRole('button', { name: 'Coral' }),
    ]);
  });

  it('focuses the first choice when the selected value is absent', () => {
    const dialog = openPalette(mountColour(vi.fn(), 'missing'));
    const lemon = within(dialog).getByRole('button', { name: 'Lemon' });
    expect(document.activeElement).toBe(lemon);
    expect(
      within(dialog)
        .getAllByRole('button')
        .filter((choice) => choice.tabIndex === 0),
    ).toEqual([lemon]);
    expect(
      within(dialog)
        .getAllByRole('button')
        .every((choice) => choice.getAttribute('aria-pressed') === 'false'),
    ).toBe(true);
  });

  it('moves by arrows across groups with wrapping and jumps with Home and End', () => {
    openPalette(mountColour());
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Brand blue' }));
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recent blue' }));
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Lemon' }));
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recent blue' }));
    press('Home');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Lemon' }));
    press('ArrowLeft');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recent blue' }));
    press('End');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recent blue' }));
  });

  it('mirrors horizontal arrow navigation when the page is RTL', () => {
    const priorDir = document.documentElement.dir;
    document.documentElement.dir = 'rtl';
    try {
      openPalette(mountColour());
      press('ArrowLeft');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Brand blue' }));
      press('ArrowRight');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Coral' }));
      press('ArrowDown');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Brand blue' }));
    } finally {
      document.documentElement.dir = priorDir;
    }
  });

  it('chooses a different value once, closes, and returns focus to the trigger', () => {
    const onChange = vi.fn();
    const trigger = mountColour(onChange);
    const dialog = openPalette(trigger);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Brand blue' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('brand');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not report the current choice and Escape closes with trigger focus', () => {
    const onChange = vi.fn();
    const trigger = mountColour(onChange);
    const dialog = openPalette(trigger);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Coral' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    openPalette(trigger);
    press('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('validates custom text and applies a lower-case hex value on Enter', () => {
    const onChange = vi.fn();
    const trigger = mountColour(onChange);
    const dialog = openPalette(trigger);
    const input = within(dialog).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(input, { target: { value: 'oops' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'A1b2C3' } });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#a1b2c3');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('omits the custom textbox when custom values are disabled', () => {
    const dialog = openPalette(mountColour(vi.fn(), 'coral', false));
    expect(within(dialog).queryByRole('textbox', { name: 'Hex' })).toBeNull();
  });

  it('keeps a disabled trigger closed', () => {
    render(
      <ColourButton
        label="Stroke"
        value="lemon"
        valueLabel="Lemon"
        swatch="#ffdd66"
        groups={GROUPS}
        isDisabled
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Stroke: Lemon' });
    expect(trigger).toHaveProperty('disabled', true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses 20 px swatches, a 48 px coarse-pointer trigger, and tokens for chrome colours', () => {
    expect(colourCss).toMatch(/\.current\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/);
    expect(colourCss).toMatch(/\.swatch\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/);
    expect(colourCss).toMatch(
      /@media \(pointer: coarse\)\s*\{[\s\S]*?\.trigger\s*\{[^}]*height:\s*48px;/,
    );
    expect(colourCss).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});

describe('parseCustomColour acceptance', () => {
  it.each([
    ['#ABCDEF', '#abcdef'],
    ['aBc123', '#abc123'],
    [' 123ABC ', '#123abc'],
    ['#12345', undefined],
    ['#1234567', undefined],
    ['not-hex', undefined],
  ])('parses %s as %s without changing its input', (input, expected) => {
    const before = input;
    expect(parseCustomColour(input)).toBe(expected);
    expect(input).toBe(before);
  });
});
