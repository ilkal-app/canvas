// CONTRACT: percentage presets use the current camera zoom as the denominator;
// unavailable camera-dependent presets cannot dispatch, while Fit commands remain available.
import { describe, expect, it, vi } from 'vitest';

import { createCameraSource } from '../editing/camera-source.js';

import { zoomPresetAction, zoomPresetEntries } from './zoom-presets.js';

describe('zoom preset acceptance', () => {
  it('zooms from an odd 37% reading to 200% about the viewport centre', () => {
    const camera = createCameraSource();
    camera.write({ x: 19, y: -7, zoom: 0.37, viewportWidthPx: 853, viewportHeightPx: 517, dpr: 2 });
    expect(zoomPresetAction(2, camera)).toEqual({
      type: 'zoomCamera',
      centerXPx: 426.5,
      centerYPx: 258.5,
      scale: 2 / 0.37,
    });
  });

  it('disables 50% and 200% without a reported camera and dispatches none of them', () => {
    const dispatch = vi.fn();
    const entries = zoomPresetEntries(undefined, createCameraSource(), dispatch);
    for (const entry of [entries[0], entries[2]]) {
      expect(entry?.kind).toBe('radio');
      if (entry?.kind !== 'radio') throw new Error('Expected percentage preset');
      expect(entry.isDisabled).toBe(true);
      entry.onSelect?.();
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(entries[1]).toMatchObject({ kind: 'radio', isDisabled: false });
    expect(entries[4]).toMatchObject({ kind: 'item', label: 'Fit' });
    expect(entries[5]).toMatchObject({ kind: 'item', label: 'Fit selection' });
  });
});
