// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { SliderControl } from './slider-control.js';

afterEach(cleanup);

it('ends an uncommitted drag on blur once, including a later unmount', () => {
  const onPreviewEnd = vi.fn();
  const onChange = vi.fn();
  const { unmount } = render(
    <SliderControl
      label="Weight"
      value={400}
      min={100}
      max={900}
      onChange={onChange}
      onPreviewEnd={onPreviewEnd}
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Weight' });
  fireEvent.input(slider, { target: { value: '650' } });
  fireEvent.blur(slider);
  expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  unmount();
  expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});

it('ends an uncommitted drag on unmount exactly once', () => {
  const onPreviewEnd = vi.fn();
  const { unmount } = render(
    <SliderControl
      label="Weight"
      value={400}
      min={100}
      max={900}
      onChange={() => undefined}
      onPreviewEnd={onPreviewEnd}
    />,
  );
  fireEvent.input(screen.getByRole('slider', { name: 'Weight' }), {
    target: { value: '650' },
  });
  unmount();
  expect(onPreviewEnd).toHaveBeenCalledTimes(1);
});

it('ends a native committed drag once, even if blur and unmount follow', () => {
  const onPreviewEnd = vi.fn();
  const onChange = vi.fn();
  const { unmount } = render(
    <SliderControl
      label="Weight"
      value={400}
      min={100}
      max={900}
      onChange={onChange}
      onPreviewEnd={onPreviewEnd}
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Weight' });
  fireEvent.input(slider, { target: { value: '650' } });
  fireEvent.change(slider, { target: { value: '650' } });
  fireEvent.blur(slider);
  unmount();
  expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(650);
});
