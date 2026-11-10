// CONTRACT: viewport presence starts only after a camera report, follows movement,
// and is explicitly cleared on unmount so stale collaborator boxes disappear.
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createCameraSource } from '../editing/camera-source.js';

import { usePublishViewport } from './use-publish-viewport.js';

describe('viewport publisher acceptance', () => {
  it('publishes nothing before the first camera report, then clears the published view on unmount', () => {
    const camera = createCameraSource();
    const showViewport = vi.fn();
    const hook = renderHook(() => {
      usePublishViewport({ showViewport }, camera);
    });
    expect(showViewport).not.toHaveBeenCalled();
    act(() => {
      camera.write({
        x: 17,
        y: -2,
        zoom: 0.5,
        viewportWidthPx: 701,
        viewportHeightPx: 301,
        dpr: 1,
      });
    });
    expect(showViewport).toHaveBeenCalledWith({ x: 17, y: -2, w: 1402, h: 602, zoom: 0.5 });
    hook.unmount();
    expect(showViewport.mock.calls.at(-1)).toEqual([null]);
    expect(showViewport).toHaveBeenCalledTimes(2);
  });
});
