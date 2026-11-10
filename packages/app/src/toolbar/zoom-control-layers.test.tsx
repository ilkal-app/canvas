// @vitest-environment jsdom
// The zoom control's layers toggle. In Chrome: tooling/scenario/specs/app/layers-drawer.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';

import { ZoomControl } from './zoom-control.js';
import { createZoomSource } from './zoom-source.js';

afterEach(cleanup);

function renderControl(isLayersDrawerOpen: boolean | undefined) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  render(
    <ZoomControl
      zoom={createZoomSource()}
      registry={createDefaultShortcutRegistry('mac')}
      dispatch={dispatch}
      {...(isLayersDrawerOpen === undefined ? {} : { isLayersDrawerOpen })}
    />,
  );
  return { dispatch, group: screen.getByRole('group', { name: 'Zoom' }) };
}

describe('ZoomControl’s layers toggle', () => {
  it('ends the control, after zoom to fit, pressed while the drawer is open', () => {
    const { group } = renderControl(true);
    const names = within(group)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Zoom out', 'Zoom in', 'Zoom to fit', 'Layers']);
    const toggle = within(group).getByRole('button', { name: 'Layers' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.title).toBe('Layers (⌥1)');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Alt+1');
  });

  it('is not pressed while the drawer is closed, and toggles it as alt+1 does', () => {
    const { dispatch, group } = renderControl(false);
    const toggle = within(group).getByRole('button', { name: 'Layers' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(dispatch.mock.calls).toEqual([[{ type: 'toggleLayersDrawer' }]]);
  });

  it('shows no toggle when not told of a drawer', () => {
    const { group } = renderControl(undefined);
    expect(within(group).queryByRole('button', { name: 'Layers' })).toBeNull();
  });
});
