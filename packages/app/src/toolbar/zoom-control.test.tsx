// @vitest-environment jsdom
// The zoom control. In Chrome, with the engine: tooling/scenario/specs/app/dock-zoom.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';

import { ZoomControl, zoomPercentOf } from './zoom-control.js';
import { createZoomSource } from './zoom-source.js';

afterEach(cleanup);

describe('ZoomControl', () => {
  it('shows the zoom as a whole percentage, following the engine’s camera', () => {
    const zoom = createZoomSource();
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(
      <ZoomControl
        zoom={zoom}
        registry={createDefaultShortcutRegistry('mac')}
        dispatch={dispatch}
      />,
    );
    const group = screen.getByRole('group', { name: 'Zoom' });
    const level = within(group).getByRole('status', { name: 'Zoom level' });
    expect(level.textContent).toBe('—');
    act(() => {
      zoom.write(0.64);
    });
    expect(level.textContent).toBe('64%');
  });

  it('zooms out, in and to fit with the same actions as the shortcuts, keeping focus', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(
      <ZoomControl
        zoom={createZoomSource()}
        registry={createDefaultShortcutRegistry('other')}
        dispatch={dispatch}
      />,
    );
    const names = within(screen.getByRole('group', { name: 'Zoom' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Zoom out', 'Zoom in', 'Zoom to fit']);
    for (const name of names) {
      const button = screen.getByRole('button', { name: name ?? '' });
      expect(fireEvent.mouseDown(button)).toBe(false);
      fireEvent.click(button);
    }
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'navigate', command: 'zoomOut' },
      { type: 'navigate', command: 'zoomIn' },
      { type: 'navigate', command: 'zoomToFit' },
    ]);
    expect(screen.getByRole('button', { name: 'Zoom to fit' }).title).toMatch(
      /^Zoom to fit \(.+1\)$/,
    );
  });

  it('rounds the zoom, and says nothing is known with an em dash', () => {
    expect(zoomPercentOf(undefined)).toBe('—');
    expect(zoomPercentOf(1)).toBe('100%');
    expect(zoomPercentOf(0.0549)).toBe('5%');
    expect(zoomPercentOf(32)).toBe('3200%');
  });
});

describe('createZoomSource', () => {
  it('tells its subscribers of a change only, until they stop listening', () => {
    const zoom = createZoomSource();
    const listener = vi.fn();
    const stop = zoom.subscribe(listener);
    zoom.write(2);
    zoom.write(2);
    expect(zoom.read()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    zoom.write(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
