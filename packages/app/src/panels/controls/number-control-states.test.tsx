// @vitest-environment jsdom
// The number field's states (the control states sheet and the scrubbing frame): "Mixed" in the
// field, the error state with what the field accepts, the disabled field, and scrubbing by
// dragging the label, Shift stepping by ten, committed once.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MIXED } from './mixed-value.js';
import { NumberControl } from './number-control.js';
import { SCRUB_PIXELS_PER_STEP } from './scrub.js';

afterEach(cleanup);

beforeEach(() => {
  // jsdom has no pointer capture; the field only needs the calls to exist.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});

/**
 * Commits a value the way the browser does: the input's value, then its `change` event, with
 * React's updates applied.
 *
 * @param input - The input.
 * @param value - The value.
 */
function commit(input: HTMLInputElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function renderWidth(value: number | typeof MIXED, isDisabled = false) {
  const onChange = vi.fn();
  render(
    <NumberControl
      label="Width"
      value={value}
      min={1}
      max={64}
      isDisabled={isDisabled}
      onChange={onChange}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>(/Width/);
  const label = input.labels?.[0];
  if (label === undefined) throw new Error('no label');
  return { onChange, input, label };
}

describe('NumberControl states', () => {
  it('reads "Mixed" when the selection disagrees, and a value entered applies once', () => {
    const { input, onChange } = renderWidth(MIXED);
    expect(screen.getByText('Mixed').getAttribute('aria-hidden')).toBe('true');
    expect(input.dataset.mixed).toBe('');
    commit(input, '12');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('shows the error state and what it accepts for an invalid value, keeping the last good one', () => {
    const { input, onChange } = renderWidth(4);
    commit(input, '65');
    expect(input.value).toBe('4');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(message?.textContent).toBe('Enter a number from 1 to 64');
    expect(onChange).not.toHaveBeenCalled();
    commit(input, '9');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(9);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('clears the error when the edit is dropped with Escape', () => {
    const { input } = renderWidth(4);
    commit(input, '0');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('is disabled: no edit and no scrub', () => {
    const { input, label, onChange } = renderWidth(4, true);
    expect(input.disabled).toBe(true);
    expect(input.closest('[data-disabled]')).not.toBeNull();
    expect(label.dataset.scrub).toBeUndefined();
    fireEvent.pointerDown(label, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(label, { pointerId: 1, clientX: 40 });
    fireEvent.pointerUp(label, { pointerId: 1, clientX: 40 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('scrubs by dragging the label, Shift by ten, committing once when let go', () => {
    const { input, label, onChange } = renderWidth(10);
    expect(label.dataset.scrub).toBe('');
    fireEvent.pointerDown(label, { button: 0, pointerId: 1, clientX: 100 });
    expect(document.activeElement).toBe(input);
    fireEvent.pointerMove(label, { pointerId: 1, clientX: 100 + SCRUB_PIXELS_PER_STEP * 3 });
    expect(input.value).toBe('13');
    expect(screen.getByText('10 → 13')).toBeTruthy();
    expect(screen.getByText('drag to scrub · ⇧ ×10')).toBeTruthy();
    fireEvent.pointerMove(label, {
      pointerId: 1,
      clientX: 100 + SCRUB_PIXELS_PER_STEP * 2,
      shiftKey: true,
    });
    expect(input.value).toBe('30');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(label, { pointerId: 1, clientX: 100 + SCRUB_PIXELS_PER_STEP * 2 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(30);
  });

  it('puts the value back when the scrub is cancelled, and does not scrub a mixed value', () => {
    const { input, label, onChange } = renderWidth(10);
    fireEvent.pointerDown(label, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(label, { pointerId: 1, clientX: SCRUB_PIXELS_PER_STEP * 4 });
    expect(input.value).toBe('14');
    fireEvent.pointerCancel(label, { pointerId: 1 });
    expect(input.value).toBe('10');
    expect(onChange).not.toHaveBeenCalled();
    cleanup();
    const mixed = renderWidth(MIXED);
    expect(mixed.label.dataset.scrub).toBeUndefined();
  });
});

describe('NumberControl with its label for assistive technology only', () => {
  it('neither scrubs nor shows the scrub read-out, and still shows its error', () => {
    const onChange = vi.fn();
    render(
      <NumberControl
        label="Stop offset"
        isLabelHidden
        value={0.5}
        min={0}
        max={1}
        step={0.01}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Stop offset');
    const label = input.labels?.[0];
    expect(label?.dataset.scrub).toBeUndefined();
    expect(screen.queryByText('drag to scrub · ⇧ ×10')).toBeNull();
    commit(input, '2');
    expect(input.value).toBe('0.5');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    // Enter still hands the keyboard back and goes no further.
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });
});
