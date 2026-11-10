// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { useNotice } from './use-notice.js';

afterEach(() => {
  cleanup();
});

describe('useNotice', () => {
  it('shows a notice with a rising sequence, the same message again being new, and dismisses it', () => {
    const { result } = renderHook(() => useNotice(3));
    expect(result.current.notice).toBeUndefined();
    act(() => {
      result.current.show('Only objects in the same frame or group can be grouped.');
    });
    expect(result.current.notice).toEqual({
      message: 'Only objects in the same frame or group can be grouped.',
      sequence: 1,
    });
    act(() => {
      result.current.show('Only objects in the same frame or group can be grouped.');
    });
    expect(result.current.notice?.sequence).toBe(2);
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.notice).toBeUndefined();
  });

  it('clears the notice at the next canvas action', () => {
    const { result, rerender } = renderHook(({ sequence }) => useNotice(sequence), {
      initialProps: { sequence: 1 },
    });
    act(() => {
      result.current.show('Nothing to ungroup: select a group.');
    });
    rerender({ sequence: 1 });
    expect(result.current.notice?.message).toBe('Nothing to ungroup: select a group.');
    rerender({ sequence: 2 });
    expect(result.current.notice).toBeUndefined();
  });

  it('keeps the button a notice is shown with', () => {
    const { result } = renderHook(() => useNotice(1));
    const action = { label: 'Go to Page 2', run: () => undefined };
    act(() => {
      result.current.show('Moved to Page 2.', action);
    });
    expect(result.current.notice).toEqual({ message: 'Moved to Page 2.', sequence: 1, action });
  });

  it('keeps the outline a notice is shown with, and drops it with the notice', () => {
    const { result } = renderHook(() => useNotice(1));
    const outline = { objectIds: ['shape-1' as ObjectId] };
    act(() => {
      result.current.show('Nothing to undo here: this has changed since.', undefined, outline);
    });
    expect(result.current.notice).toEqual({
      message: 'Nothing to undo here: this has changed since.',
      sequence: 1,
      outline,
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.notice?.outline).toBeUndefined();
  });
});
