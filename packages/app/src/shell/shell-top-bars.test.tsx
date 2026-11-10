// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { ToastRegionProvider } from '../feedback/toast-region.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { ShellTopBars } from './shell-top-bars.js';

afterEach(cleanup);

describe('ShellTopBars', () => {
  it('names no page for collaborators without a way to read page names', () => {
    const connection = new FakeBoardConnection('demo');
    const status = connection.status();
    vi.spyOn(connection, 'status').mockReturnValue({
      ...status,
      collaborators: [
        { principalId: 'jo', kind: 'user', name: 'Jonas', color: '#c77ddb', page: 'page-1' },
      ],
    });
    render(
      <ShellTopBars
        content={undefined}
        fallbackTitle="Demo"
        actions={[]}
        state={INITIAL_SHELL_STATE}
        themePreference="system"
        dispatch={vi.fn()}
        onThemeChange={vi.fn()}
        isInert={false}
        connection={connection}
        onShare={undefined}
      />,
      // Its offline banner posts to the one toast region (item 4).
      { wrapper: ToastRegionProvider },
    );
    expect(screen.getByRole('img', { name: 'Jonas' })).toBeDefined();
  });

  it('leaves a wheel alone when no canvas is beside the bars', () => {
    render(
      <ShellTopBars
        content={undefined}
        fallbackTitle="Demo"
        actions={[]}
        state={INITIAL_SHELL_STATE}
        themePreference="system"
        dispatch={vi.fn()}
        onThemeChange={vi.fn()}
        isInert={false}
        connection={undefined}
        onShare={undefined}
      />,
      // Its offline banner posts to the one toast region (item 4).
      { wrapper: ToastRegionProvider },
    );
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 });
    screen.getByRole('group', { name: 'Board' }).dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});
