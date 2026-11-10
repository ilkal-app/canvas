// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColourButton, type ColourGroup } from './colour-button.js';

const GROUPS: readonly ColourGroup[] = [
  { label: 'Colours', choices: [{ value: 'red', label: 'Red', swatch: '#ff0000' }] },
];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Picker({
  initial = '#ff0000',
  swatch = '#ff0000',
  onChange = vi.fn(),
}: {
  readonly initial?: string;
  readonly swatch?: string;
  readonly onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColourButton
      label="Fill"
      value={value}
      valueLabel={value}
      swatch={swatch}
      groups={GROUPS}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function open(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /^Fill:/ }));
  return screen.getByRole('dialog', { name: 'Fill colours' });
}

function hex(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByRole('textbox', { name: 'Hex' });
}

describe('custom colour picker acceptance', () => {
  it('shows an accessible saturation and brightness area, hue range, and Hex field', () => {
    render(<Picker />);
    const dialog = open();
    expect(within(dialog).getByText('Custom')).toBeTruthy();
    const area = within(dialog).getByRole('slider', { name: 'Saturation and brightness' });
    expect(area.getAttribute('aria-valuetext')).toMatch(/^Saturation \d+%, brightness \d+%$/);
    const hue = within(dialog).getByRole<HTMLInputElement>('slider', { name: 'Hue' });
    expect(hue.type).toBe('range');
    expect(hue.min).toBe('0');
    expect(hue.max).toBe('360');
    expect(hex(dialog).value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each([
    {
      value: '#ff0000',
      swatch: '#00ff00',
      expected: '#ff0000',
      hue: '0',
      text: 'Saturation 100%, brightness 100%',
    },
    {
      value: 'token',
      swatch: '#0000ff',
      expected: '#0000ff',
      hue: '240',
      text: 'Saturation 100%, brightness 100%',
    },
    {
      value: 'token',
      swatch: 'transparent',
      expected: '#000000',
      hue: '0',
      text: 'Saturation 0%, brightness 0%',
    },
  ])(
    'initializes from value then hex swatch then black for $value / $swatch',
    ({ value, swatch, expected, hue, text }) => {
      render(<Picker initial={value} swatch={swatch} />);
      const dialog = open();
      expect(hex(dialog).value).toBe(expected);
      expect(within(dialog).getByRole<HTMLInputElement>('slider', { name: 'Hue' }).value).toBe(hue);
      expect(
        within(dialog)
          .getByRole('slider', { name: 'Saturation and brightness' })
          .getAttribute('aria-valuetext'),
      ).toBe(text);
    },
  );

  it('changes hue to green once and leaves the palette open', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const dialog = open();
    fireEvent.change(within(dialog).getByRole<HTMLInputElement>('slider', { name: 'Hue' }), {
      target: { value: '120' },
    });
    expect(hex(dialog).value).toBe('#00ff00');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#00ff00');
    expect(screen.getByRole('dialog', { name: 'Fill colours' })).toBe(dialog);
  });

  it('uses arrow keys to lower saturation and brightness, with Shift stepping ten percent', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const dialog = open();
    const area = within(dialog).getByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    expect(hex(dialog).value).toBe('#ff0303');
    expect(onChange).toHaveBeenLastCalledWith('#ff0303');
    for (let index = 0; index < 5; index += 1)
      fireEvent.keyDown(area, { key: 'ArrowDown', shiftKey: true });
    expect(area.getAttribute('aria-valuetext')).toBe('Saturation 99%, brightness 50%');
    expect(hex(dialog).value).toBe('#800101');
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('rounds half-up when five Shift+ArrowDown presses halve red brightness', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const dialog = open();
    const area = within(dialog).getByRole('slider', { name: 'Saturation and brightness' });
    for (let index = 0; index < 5; index += 1)
      fireEvent.keyDown(area, { key: 'ArrowDown', shiftKey: true });
    expect(area.getAttribute('aria-valuetext')).toBe('Saturation 100%, brightness 50%');
    expect(hex(dialog).value).toBe('#800000');
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(onChange).toHaveBeenLastCalledWith('#800000');
  });

  it('commits one pointer selection at pointerup at 25% saturation and brightness', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const dialog = open();
    const area = within(dialog).getByRole('slider', { name: 'Saturation and brightness' });
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(area, { clientX: 25, clientY: 75, pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 25, clientY: 75, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(area, { clientX: 25, clientY: 75, pointerId: 1 });
    expect(hex(dialog).value).toBe('#403030');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#403030');
  });

  it('applies valid Hex on Enter, rejects invalid text, and restores picker state on reopening', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    let dialog = open();
    fireEvent.change(hex(dialog), { target: { value: 'bad' } });
    fireEvent.keyDown(hex(dialog), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(hex(dialog), { target: { value: '#3366cc' } });
    fireEvent.keyDown(hex(dialog), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#3366cc');
    expect(screen.queryByRole('dialog', { name: 'Fill colours' })).toBeNull();
    dialog = open();
    expect(hex(dialog).value).toBe('#3366cc');
    expect(within(dialog).getByRole<HTMLInputElement>('slider', { name: 'Hue' }).value).toBe('220');
    expect(
      within(dialog)
        .getByRole('slider', { name: 'Saturation and brightness' })
        .getAttribute('aria-valuetext'),
    ).toBe('Saturation 75%, brightness 80%');
  });
});
