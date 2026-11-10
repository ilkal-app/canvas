// @vitest-environment jsdom
// The four mixed-value controls: how each shows a mixed selection and
// that choosing a value applies that value alone.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Rgba } from '@canvas/schema';

import { ColourControl } from './colour-control.js';
import { hexToRgba, rgbaToHex } from './colour-hex.js';
import { commonValue, isSameColour, MIXED } from './mixed-value.js';
import { NumberControl } from './number-control.js';
import { SelectControl } from './select-control.js';
import { ToggleControl } from './toggle-control.js';

const RED: Rgba = [1, 0, 0, 0.5];

afterEach(cleanup);

/**
 * Commits a value the way the browser does: the input's value, then its `change` event.
 *
 * @param input - The input.
 * @param value - The value.
 */
function commit(input: HTMLElement, value: string): void {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('commonValue and isSameColour', () => {
  it('gives the shared value, MIXED when two differ, undefined for nothing', () => {
    expect(commonValue([2, 2], (value) => value)).toBe(2);
    expect(commonValue([2, 3], (value) => value)).toBe(MIXED);
    expect(commonValue([], (value) => value)).toBeUndefined();
    expect(commonValue([[1], [1]], (value) => value, isSameColour)).toEqual([1]);
  });

  it('compares colours by channel and treats two nones as the same', () => {
    expect(isSameColour([1, 0, 0, 1], [1, 0, 0, 1])).toBe(true);
    expect(isSameColour([1, 0, 0, 1], [1, 0, 0, 0.5])).toBe(false);
    expect(isSameColour([1, 0, 0], [1, 0, 0, 1])).toBe(false);
    expect(isSameColour(null, null)).toBe(true);
    expect(isSameColour(null, [1, 0, 0, 1])).toBe(false);
    expect(isSameColour('ink', 'ink')).toBe(true);
    expect(isSameColour('ink', [0, 0, 0, 1])).toBe(false);
    expect(isSameColour([0, 0, 0, 1], 'ink')).toBe(false);
  });

  it('turns colours into hex and back, keeping an alpha', () => {
    expect(rgbaToHex([1, 0.5, 0, 1])).toBe('#ff8000');
    expect(rgbaToHex([2, -1, 0, 1])).toBe('#ff0000');
    expect(hexToRgba('#ff0000', 0.5)).toEqual(RED);
    expect(hexToRgba('red', 1)).toBeUndefined();
  });
});

describe('ColourControl', () => {
  it('keeps Enter from opening the picker, so the keyboard returns to the board', () => {
    render(<ColourControl label="Fill" value={RED} onChange={vi.fn()} />);
    const input = screen.getByLabelText('Fill');
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(input, { key: 'a' })).toBe(true);
  });

  it('shows the colour and applies a committed choice with the alpha kept', () => {
    const onChange = vi.fn();
    render(<ColourControl label="Fill" value={RED} onChange={onChange} />);
    const input = screen.getByLabelText('Fill');
    expect((input as HTMLInputElement).value).toBe('#ff0000');
    commit(input, '#00ff00');
    expect(onChange).toHaveBeenCalledWith([0, 1, 0, 0.5]);
  });

  it('stripes a mixed value and applies one colour, opaque, to all', () => {
    const onChange = vi.fn();
    const { container } = render(<ColourControl label="Fill" value={MIXED} onChange={onChange} />);
    expect(container.querySelector('[data-state="mixed"]')).not.toBeNull();
    expect(screen.getByLabelText('Fill (mixed)')).toBeInstanceOf(HTMLInputElement);
    commit(screen.getByLabelText('Fill (mixed)'), '#0000ff');
    expect(onChange).toHaveBeenCalledWith([0, 0, 1, 1]);
  });

  it('ignores a value that is not a colour', () => {
    const onChange = vi.fn();
    render(<ColourControl label="Fill" value={RED} onChange={onChange} />);
    const input = screen.getByLabelText('Fill');
    Object.defineProperty(input, 'value', { value: 'nonsense', configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('turns the field off with None, and back on with the picker colour, keeping focus', () => {
    const onChange = vi.fn();
    const view = render(<ColourControl label="Fill" value={RED} canBeNone onChange={onChange} />);
    const none = screen.getByRole('button', { name: 'No fill' });
    expect(none.getAttribute('aria-pressed')).toBe('false');
    expect(fireEvent.mouseDown(none)).toBe(false);
    fireEvent.click(none);
    expect(onChange).toHaveBeenLastCalledWith(null);
    view.rerender(<ColourControl label="Fill" value={null} canBeNone onChange={onChange} />);
    expect(view.container.querySelector('[data-state="none"]')).not.toBeNull();
    expect(none.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(none);
    expect(onChange).toHaveBeenLastCalledWith([1, 0, 0, 1]);
  });

  it('applies a choice to what it showed when it took focus, whatever is selected by then', () => {
    // A click on another object selects it before the picker's `change` arrives.
    const chosenFor = vi.fn();
    const selectedSince = vi.fn();
    const view = render(<ColourControl label="Fill" value={RED} onChange={chosenFor} />);
    const input = screen.getByLabelText('Fill');
    input.focus();
    view.rerender(<ColourControl label="Fill" value={RED} onChange={selectedSince} />);
    input.blur();
    commit(input, '#00ff00');
    expect(chosenFor).toHaveBeenCalledExactlyOnceWith([0, 1, 0, 0.5]);
    expect(selectedSince).not.toHaveBeenCalled();
    commit(input, '#0000ff');
    expect(selectedSince).toHaveBeenCalledExactlyOnceWith([0, 0, 1, 0.5]);
  });

  it('follows a new value from the document', () => {
    const view = render(<ColourControl label="Fill" value={RED} onChange={vi.fn()} />);
    view.rerender(<ColourControl label="Fill" value={[0, 0, 1, 1]} onChange={vi.fn()} />);
    expect(screen.getByLabelText<HTMLInputElement>('Fill').value).toBe('#0000ff');
  });
});

describe('ColourControl with Ink', () => {
  it('offers Ink first only when asked, pressed for ink, keeping focus on a press', () => {
    const onInk = vi.fn();
    const view = render(<ColourControl label="Stroke" value={RED} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Ink' })).toBeNull();
    view.rerender(<ColourControl label="Stroke" value="ink" onChange={vi.fn()} onInk={onInk} />);
    const ink = screen.getByRole('button', { name: 'Ink' });
    expect(view.container.querySelector('button')).toBe(ink);
    expect(ink.getAttribute('aria-pressed')).toBe('true');
    expect(fireEvent.mouseDown(ink)).toBe(false);
    fireEvent.click(ink);
    expect(onInk).toHaveBeenCalledOnce();
  });

  it('names an ink field by its label alone and picks an opaque colour from it', () => {
    const onChange = vi.fn();
    const view = render(<ColourControl label="Stroke" value="ink" onChange={onChange} />);
    expect(view.container.querySelector('[data-state="ink"]')).not.toBeNull();
    const input = screen.getByLabelText<HTMLInputElement>('Stroke');
    expect(input.value).toBe('#1e1f1c');
    commit(input, '#000000');
    expect(onChange).toHaveBeenCalledWith([0, 0, 0, 1]);
  });

  it('can hide its label from sight, keeping its name', () => {
    render(<ColourControl label="Stop colour" isLabelHidden value={RED} onChange={vi.fn()} />);
    const label = screen.getByText('Stop colour');
    expect(label.className).not.toBe('');
    expect(screen.getByLabelText('Stop colour')).toBeInstanceOf(HTMLInputElement);
  });
});

describe('NumberControl', () => {
  function renderNumber(value: number | typeof MIXED) {
    const onChange = vi.fn();
    const view = render(
      <NumberControl label="Width" value={value} min={1} max={64} step={1} onChange={onChange} />,
    );
    return { onChange, view, input: screen.getByLabelText<HTMLInputElement>(/Width/) };
  }

  it('shows the value, and blank with a dash when mixed', () => {
    expect(renderNumber(4).input.value).toBe('4');
    cleanup();
    const { input } = renderNumber(MIXED);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('–');
    expect(screen.getByLabelText('Width (mixed)')).toBe(input);
  });

  it('applies a committed number in range, once', () => {
    const { input, onChange } = renderNumber(MIXED);
    commit(input, '12');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('drops a value out of range, blank or unchanged and shows the value again', () => {
    const { input, onChange } = renderNumber(4);
    for (const typed of ['0', '65', '', '4']) {
      commit(input, typed);
      expect(input.value).toBe('4');
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hands the keyboard back on Enter, and drops the edit on Escape', () => {
    const { input } = renderNumber(4);
    input.focus();
    input.value = '9';
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('4');
    expect(document.activeElement).not.toBe(input);
    input.focus();
    // Handled here, so the key never becomes a line break in the text editor it hands back to.
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(document.activeElement).not.toBe(input);
    expect(fireEvent.keyDown(input, { key: 'a' })).toBe(true);
  });

  it('takes a new value from the document unless it is being edited', () => {
    const { input, view, onChange } = renderNumber(4);
    const rerender = (value: number) => {
      view.rerender(
        <NumberControl label="Width" value={value} min={1} max={64} onChange={onChange} />,
      );
    };
    rerender(5);
    expect(input.value).toBe('5');
    input.focus();
    input.value = '7';
    rerender(6);
    expect(input.value).toBe('7');
  });
});

describe('SelectControl', () => {
  const options = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Centre' },
    { value: 'right', label: 'Right' },
  ];

  it('shows the value and applies a choice', () => {
    const onChange = vi.fn();
    render(<SelectControl label="Align" value="left" options={options} onChange={onChange} />);
    const select = screen.getByLabelText<HTMLSelectElement>('Align');
    expect(select.value).toBe('left');
    expect(screen.queryByRole('option', { name: 'Mixed' })).toBeNull();
    fireEvent.change(select, { target: { value: 'center' } });
    expect(onChange).toHaveBeenCalledWith('center');
  });

  it('lets go after a pointer choice when it releases focus, and keeps it otherwise', () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <SelectControl
        label="Align"
        value="left"
        options={options}
        onChange={onChange}
        shouldReleaseFocus
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Align');
    select.focus();
    fireEvent.pointerDown(select);
    fireEvent.change(select, { target: { value: 'center' } });
    expect(onChange).toHaveBeenCalledWith('center');
    expect(document.activeElement).not.toBe(select);
    unmount();
    render(<SelectControl label="Align" value="left" options={options} onChange={onChange} />);
    const kept = screen.getByLabelText<HTMLSelectElement>('Align');
    kept.focus();
    fireEvent.change(kept, { target: { value: 'center' } });
    expect(document.activeElement).toBe(kept);
    expect(fireEvent.keyDown(kept, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(kept, { key: 'Escape' })).toBe(true);
    expect(document.activeElement).toBe(kept);
  });

  it('keeps focus while the keyboard walks three choices', () => {
    const onChange = vi.fn();
    render(
      <SelectControl
        label="Align"
        value="left"
        options={options}
        onChange={onChange}
        shouldReleaseFocus
      />,
    );
    const select = screen.getByLabelText('Align');
    select.focus();
    for (const value of ['center', 'right', 'left']) {
      fireEvent.keyDown(select, { key: 'ArrowDown' });
      fireEvent.change(select, { target: { value } });
      expect(onChange).toHaveBeenLastCalledWith(value);
      expect(document.activeElement).toBe(select);
    }
  });

  it.each(['Enter', 'Escape'])('releases focus on %s without forwarding the key', (key) => {
    const onChange = vi.fn();
    render(
      <SelectControl
        label="Align"
        value="left"
        options={options}
        onChange={onChange}
        shouldReleaseFocus
      />,
    );
    const select = screen.getByLabelText('Align');
    select.focus();
    expect(fireEvent.keyDown(select, { key })).toBe(false);
    expect(document.activeElement).not.toBe(select);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('left');
  });

  it.each(['keyboard', 'cancel', 'blur'])('clears stale pointer intent on %s', (end) => {
    render(
      <SelectControl
        label="Align"
        value="left"
        options={options}
        onChange={vi.fn()}
        shouldReleaseFocus
      />,
    );
    const select = screen.getByLabelText('Align');
    select.focus();
    fireEvent.pointerDown(select);
    if (end === 'keyboard') fireEvent.keyDown(select, { key: 'ArrowDown' });
    else if (end === 'cancel') fireEvent.pointerCancel(select);
    else {
      select.blur();
      select.focus();
    }
    fireEvent.change(select, { target: { value: 'center' } });
    expect(document.activeElement).toBe(select);
  });

  it.each(['Enter', 'Escape'])('does not apply the Mixed placeholder on %s', (key) => {
    const onChange = vi.fn();
    render(
      <SelectControl
        label="Align"
        value={MIXED}
        options={options}
        onChange={onChange}
        shouldReleaseFocus
      />,
    );
    const select = screen.getByLabelText('Align');
    select.focus();
    fireEvent.keyDown(select, { key });
    expect(document.activeElement).not.toBe(select);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a disabled Mixed option when the selection disagrees', () => {
    render(<SelectControl label="Align" value={MIXED} options={options} onChange={vi.fn()} />);
    const mixed = screen.getByRole<HTMLOptionElement>('option', { name: 'Mixed' });
    expect(mixed.disabled).toBe(true);
    expect(mixed.selected).toBe(true);
  });
});

describe('ToggleControl', () => {
  it.each([
    [true, 'true', false],
    [false, 'false', true],
    [MIXED, 'mixed', true],
  ] as const)('shows %s as aria-pressed=%s and a press sets %s', (value, pressed, isOnAfter) => {
    const onChange = vi.fn();
    render(
      <ToggleControl label="Bold" value={value} onChange={onChange}>
        B
      </ToggleControl>,
    );
    const button = screen.getByRole('button', { name: 'Bold' });
    expect(button.getAttribute('aria-pressed')).toBe(pressed);
    expect(button.textContent).toBe('B');
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(isOnAfter);
  });

  it('shows its label when given no content', () => {
    render(<ToggleControl label="Italic" value={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Italic' }).textContent).toBe('Italic');
  });
});
