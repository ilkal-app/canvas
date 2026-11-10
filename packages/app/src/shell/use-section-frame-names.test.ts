// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { SECTION_NAME_PREFIX } from '../state/floating-dock.js';

import { useSectionFrameNames } from './use-section-frame-names.js';

it('gives the frame tool the Section prefix under the floating dock, for an editor', () => {
  const dispatch = vi.fn();
  renderHook(() => {
    useSectionFrameNames(dispatch, true, true);
  });
  expect(SECTION_NAME_PREFIX).toBe('Section');
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({
    type: 'setToolStyle',
    tool: 'frame',
    style: { framePrefix: 'Section' },
  });
});

it('gives nothing in the classic chrome or to a person who cannot edit', () => {
  const dispatch = vi.fn();
  renderHook(() => {
    useSectionFrameNames(dispatch, false, true);
    useSectionFrameNames(dispatch, true, false);
  });
  expect(dispatch).not.toHaveBeenCalled();
});

it('gives Frame back once the floating dock no longer shows, as when the mode changes', () => {
  const dispatch = vi.fn();
  const { rerender } = renderHook(
    ({ isFloatingDock }: { isFloatingDock: boolean }) => {
      useSectionFrameNames(dispatch, isFloatingDock, true);
    },
    { initialProps: { isFloatingDock: true } },
  );
  rerender({ isFloatingDock: false });
  rerender({ isFloatingDock: false });
  expect(dispatch.mock.calls).toEqual([
    [{ type: 'setToolStyle', tool: 'frame', style: { framePrefix: 'Section' } }],
    [{ type: 'setToolStyle', tool: 'frame', style: { framePrefix: 'Frame' } }],
  ]);
});
