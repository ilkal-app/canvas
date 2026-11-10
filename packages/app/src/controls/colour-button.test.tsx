// @vitest-environment jsdom
// The colour button: its trigger, its palette's groups and keys, and the custom
// colour. Geometry in a real browser is the scenario's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColourButton, parseCustomColour, type ColourGroup } from './colour-button.js';
import paletteCss from './colour-button.module.css?raw';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
  return () => {
    vi.restoreAllMocks();
  };
});

const GROUPS: readonly ColourGroup[] = [
  {
    label: 'Sticky',
    choices: [
      { value: 'yellow', label: 'Yellow', swatch: '#f6e39a' },
      { value: 'pink', label: 'Pink', swatch: '#f3c3cf' },
      { value: 'blue', label: 'Blue', swatch: '#bcd6ee' },
    ],
  },
  { label: 'Board colours', choices: [{ value: 'brand', label: 'Brand', swatch: '#3c6fb0' }] },
  { label: 'Recent', choices: [] },
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
 * A colour button holding its own value, reporting changes.
 *
 * @param props - The change recorder.
 * @param props.onChange - Receives each change.
 * @returns The button.
 */
function Fill(props: { readonly onChange: (value: string) => void }): ReactElement {
  const [value, setValue] = useState('pink');
  const label = GROUPS.flatMap((group) => group.choices).find((c) => c.value === value)?.label;
  return (
    <ColourButton
      label="Fill"
      value={value}
      valueLabel={label ?? value}
      swatch="#f3c3cf"
      groups={GROUPS}
      onChange={(next) => {
        props.onChange(next);
        setValue(next);
      }}
    />
  );
}

/**
 * Opens the palette from the focused trigger.
 *
 * @returns The palette.
 */
function openPalette(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Fill: Pink' });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('dialog', { name: 'Fill colours' });
}

describe('parseCustomColour', () => {
  it('reads #rrggbb or six hex digits, lower-cased, and nothing else', () => {
    expect(parseCustomColour('#3C6FB0')).toBe('#3c6fb0');
    expect(parseCustomColour(' 3c6fb0 ')).toBe('#3c6fb0');
    expect(parseCustomColour('#3c6fb')).toBeUndefined();
    expect(parseCustomColour('#3c6fb0aa')).toBeUndefined();
    expect(parseCustomColour('red')).toBeUndefined();
    expect(parseCustomColour('')).toBeUndefined();
  });
});

describe('ColourButton', () => {
  it('is named with its colour and shows its swatch and a chevron', () => {
    render(<Fill onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Fill: Pink' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('span')?.style.background).toBe('rgb(243, 195, 207)');
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('opens a palette of named groups, empty ones left out, the current colour focused', () => {
    render(<Fill onChange={vi.fn()} />);
    const palette = openPalette();
    expect(
      within(palette)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Sticky', 'Board colours']);
    const pink = within(palette).getByRole('button', { name: 'Pink' });
    expect(pink.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(pink);
    // One Tab stop for the swatches: the current one.
    const tabbable = within(palette)
      .getAllByRole('button')
      .filter((swatch) => swatch.tabIndex === 0);
    expect(tabbable).toEqual([pink]);
  });

  it('moves through every swatch with the arrows, across groups, and chooses with Enter', () => {
    const onChange = vi.fn();
    render(<Fill onChange={onChange} />);
    openPalette();
    press('ArrowRight');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Blue');
    press('ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Brand');
    press('ArrowRight');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Yellow');
    press('ArrowLeft');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Brand');
    press('Home');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Yellow');
    act(() => {
      (document.activeElement as HTMLElement).click();
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('yellow');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fill: Yellow' }));
  });

  it('moves its one Tab stop with the arrows, so Shift+Tab leaves the swatches', () => {
    render(<Fill onChange={vi.fn()} />);
    const palette = openPalette();
    press('ArrowRight');
    const blue = within(palette).getByRole('button', { name: 'Blue' });
    expect(document.activeElement).toBe(blue);
    const tabbable = within(palette)
      .getAllByRole('button')
      .filter((swatch) => swatch.tabIndex === 0);
    expect(tabbable).toEqual([blue]);
  });

  it('reports nothing for the current colour, and Escape returns without a change', () => {
    const onChange = vi.fn();
    render(<Fill onChange={onChange} />);
    const palette = openPalette();
    fireEvent.click(within(palette).getByRole('button', { name: 'Pink' }));
    expect(onChange).not.toHaveBeenCalled();
    openPalette();
    press('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fill: Pink' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes a custom hex colour with Enter, and marks a wrong one', () => {
    const onChange = vi.fn();
    render(<Fill onChange={onChange} />);
    const palette = openPalette();
    const field = within(palette).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(field, { target: { value: '#12' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '#12AB34' } });
    expect(field.getAttribute('aria-invalid')).toBe('false');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#12ab34');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from Arrow Down, leaves out the custom field when asked, and can be disabled', () => {
    render(
      <>
        <ColourButton
          label="Stroke"
          value="yellow"
          valueLabel="Yellow"
          swatch="#f6e39a"
          groups={GROUPS}
          canTakeCustom={false}
          onChange={vi.fn()}
        />
        <ColourButton
          label="Text"
          value="yellow"
          valueLabel="Yellow"
          swatch="#f6e39a"
          groups={GROUPS}
          isDisabled
          onChange={vi.fn()}
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Text: Yellow' })).toHaveProperty('disabled', true);
    screen.getByRole('button', { name: 'Stroke: Yellow' }).focus();
    press('ArrowDown');
    const palette = screen.getByRole('dialog', { name: 'Stroke colours' });
    expect(within(palette).queryByRole('textbox')).toBeNull();
  });

  it('gives each swatch a 48 px touch target: 32 px drawn, 8 px around, 16 px apart', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*)\}\s*$/.exec(paletteCss)?.[1] ?? '';
    expect(coarse).toMatch(/\.swatches \{[^}]*repeat\(6, 32px\);[^}]*gap: var\(--space-4\);/);
    expect(coarse).toMatch(/\.swatch \{[^}]*width: 32px;[^}]*height: 32px;/);
    expect(coarse).toMatch(/\.swatch::before \{[^}]*inset: -8px;/);
    expect(paletteCss).toMatch(/\.swatch \{\s*position: relative;/);
  });
});
