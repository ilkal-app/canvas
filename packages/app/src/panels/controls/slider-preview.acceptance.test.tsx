// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SliderControl } from './slider-control.js';

afterEach(cleanup);

describe('slider drag preview', () => {
  it('previews each input, ends preview before one commit', () => {
    const calls: string[] = [];
    const onPreview = vi.fn((value: number) => calls.push(`preview:${String(value)}`));
    const onPreviewEnd = vi.fn(() => calls.push('end'));
    const onChange = vi.fn((value: number) => calls.push(`commit:${String(value)}`));
    render(
      <SliderControl
        label="Axis"
        value={400}
        min={100}
        max={900}
        onPreview={onPreview}
        onPreviewEnd={onPreviewEnd}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Axis' });
    fireEvent.input(slider, { target: { value: '500' } });
    fireEvent.input(slider, { target: { value: '650' } });
    expect(onPreview.mock.calls).toEqual([[500], [650]]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '650' } });
    expect(calls).toEqual(['preview:500', 'preview:650', 'end', 'commit:650']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ends preview when a drag returns to its original value', () => {
    const onPreviewEnd = vi.fn();
    const onChange = vi.fn();
    render(
      <SliderControl
        label="Axis"
        value={400}
        min={100}
        max={900}
        onPreview={vi.fn()}
        onPreviewEnd={onPreviewEnd}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Axis' });
    fireEvent.input(slider, { target: { value: '500' } });
    fireEvent.input(slider, { target: { value: '400' } });
    fireEvent.change(slider, { target: { value: '400' } });
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
