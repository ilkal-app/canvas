// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColourPicker } from './colour-picker.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ColourPicker', () => {
  it('applies nothing and leaves no window listener when it closes under a held press', () => {
    const onApply = vi.fn();
    const removed = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ColourPicker start="#ff0000" onApply={onApply} onPick={vi.fn()} />);
    const area = screen.getByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10 });
    unmount();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']),
    );
    fireEvent.pointerUp(window, { clientX: 20, clientY: 20 });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies nothing for a press the browser cancels', () => {
    const onApply = vi.fn();
    render(<ColourPicker start="#ff0000" onApply={onApply} onPick={vi.fn()} />);
    const area = screen.getByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window, { clientX: 20, clientY: 20 });
    expect(onApply).not.toHaveBeenCalled();
  });
});
