// @vitest-environment jsdom
// The zoom control's preset menu ("click it for presets": 50, 100, 200 %, Fit, Fit
// selection).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';
import type { ShellAction } from '../state/shell-action.js';

import { ZoomPresets, zoomPresetAction, zoomPresetEntries } from './zoom-presets.js';

afterEach(cleanup);

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 0.8,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

describe('zoomPresetAction', () => {
  it('zooms about the view’s centre to 50 % and 200 %, and to actual size at 100 %', () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    expect(zoomPresetAction(0.5, camera)).toEqual({
      type: 'zoomCamera',
      centerXPx: 400,
      centerYPx: 300,
      scale: 0.625,
    });
    expect(zoomPresetAction(2, camera)).toMatchObject({ scale: 2.5 });
    expect(zoomPresetAction(1, undefined)).toEqual({
      type: 'navigate',
      command: 'zoomToActualSize',
    });
    expect(zoomPresetAction(2, createCameraSource())).toBeUndefined();
  });
});

describe('zoomPresetEntries', () => {
  it('lists the levels, the zoom now checked, then Fit and Fit selection', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const camera = createCameraSource();
    camera.write({ ...CAMERA, zoom: 2 });
    const entries = zoomPresetEntries(2, camera, dispatch);
    expect(entries.map((entry) => (entry.kind === 'separator' ? '—' : entry.label))).toEqual([
      '50%',
      '100%',
      '200%',
      '—',
      'Fit',
      'Fit selection',
    ]);
    expect(entries.map((entry) => entry.kind !== 'separator' && entry.isChecked === true)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    for (const entry of entries) if (entry.kind !== 'separator') entry.onSelect?.();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'zoomCamera', centerXPx: 400, centerYPx: 300, scale: 0.25 },
      { type: 'navigate', command: 'zoomToActualSize' },
      { type: 'zoomCamera', centerXPx: 400, centerYPx: 300, scale: 1 },
      { type: 'navigate', command: 'zoomToFit' },
      { type: 'navigate', command: 'zoomToSelection' },
    ]);
  });

  it('disables the levels it cannot reach without a camera', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const entries = zoomPresetEntries(undefined, undefined, dispatch);
    const half = entries[0];
    expect(half?.kind !== 'separator' && half?.isDisabled).toBe(true);
    if (half?.kind !== 'separator') half?.onSelect?.();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('ZoomPresets', () => {
  it('opens its menu from the zoom, and closes it, the button taking focus as a menu button does', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(
      <ZoomPresets zoom={1} camera={undefined} dispatch={dispatch}>
        <output aria-label="Zoom level">100%</output>
      </ZoomPresets>,
    );
    const button = screen.getByRole('button', { name: 'Zoom presets' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fit' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'navigate', command: 'zoomToFit' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
