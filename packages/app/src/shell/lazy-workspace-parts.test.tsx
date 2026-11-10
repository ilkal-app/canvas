// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePanelProps } from '../panels/style-panel.js';
import type { SelectionPopoverProps } from '../selection-popover/selection-popover.js';
import { panelLayoutFor } from '../state/dock-layout.js';

import {
  LazySelectionPopover,
  LazyStylePanel,
  preloadWorkspaceParts,
} from './lazy-workspace-parts.js';
import { shellBoardModeContext } from './shell-board-mode.js';
import { whiteboardChromeContext } from './whiteboard-chrome.js';

/** How often each replaced module was loaded, and the focus requests the popover was given. */
const seen = vi.hoisted(() => ({ popoverLoads: 0, focusRequests: [] as (number | undefined)[] }));

vi.mock('../panels/style-panel.js', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the module's export is a component, PascalCase.
  StylePanel: (): ReactElement => <aside aria-label="Style" />,
}));

vi.mock('../selection-popover/selection-popover.js', () => {
  seen.popoverLoads += 1;
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the module's export is a component, PascalCase.
    SelectionPopover: (props: SelectionPopoverProps): ReactElement => {
      seen.focusRequests.push(props.focusRequests);
      return <div role="toolbar" aria-label="Selection" />;
    },
  };
});

afterEach(() => {
  cleanup();
});

/** Props the replaced components ignore. */
const PANEL_PROPS = {} as StylePanelProps;

/**
 * The popover inside a shell of the given mode and chrome.
 *
 * @param mode - The board's mode.
 * @param chrome - The whiteboard chrome.
 * @param focusRequests - The shell's mod+/ count.
 * @returns The element.
 */
function popoverIn(
  mode: 'whiteboard' | 'diagram',
  chrome: 'floating' | 'classic',
  focusRequests = 0,
): ReactElement {
  return (
    <whiteboardChromeContext.Provider value={chrome}>
      <shellBoardModeContext.Provider
        value={{ mode, changeMode: () => undefined, drawers: panelLayoutFor(mode, chrome) }}
      >
        <LazySelectionPopover {...({} as SelectionPopoverProps)} focusRequests={focusRequests} />
      </shellBoardModeContext.Provider>
    </whiteboardChromeContext.Provider>
  );
}

// The tests run in order: the popover's code is cold until the third.
describe('the workspace lazy parts', () => {
  it('shows the style panel once its code arrives, and at once after', async () => {
    render(<LazyStylePanel {...PANEL_PROPS} />);
    expect(screen.queryByRole('complementary', { name: 'Style' })).toBeNull();
    expect(await screen.findByRole('complementary', { name: 'Style' })).toBeTruthy();
    cleanup();
    render(<LazyStylePanel {...PANEL_PROPS} />);
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeTruthy();
  });

  it('never loads the selection popover on a board where it does not belong', async () => {
    render(popoverIn('diagram', 'floating'));
    render(popoverIn('whiteboard', 'classic'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(seen.popoverLoads).toBe(0);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
  });

  it('keeps a mod+/ pressed while the popover loads as a request for focus', async () => {
    const view = render(popoverIn('whiteboard', 'floating', 3));
    view.rerender(popoverIn('whiteboard', 'floating', 4));
    expect(await screen.findByRole('toolbar', { name: 'Selection' })).toBeTruthy();
    expect(seen.popoverLoads).toBe(1);
    // Mounted with the count from before the load, then given the new one: a new request.
    expect(seen.focusRequests[0]).toBe(3);
    await waitFor(() => {
      expect(seen.focusRequests.at(-1)).toBe(4);
    });
  });

  it('shows the popover at once on a whiteboard under the floating chrome, once loaded', async () => {
    await preloadWorkspaceParts();
    seen.focusRequests.length = 0;
    render(popoverIn('whiteboard', 'floating', 7));
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();
    expect(seen.focusRequests.every((count) => count === 7)).toBe(true);
  });
});
