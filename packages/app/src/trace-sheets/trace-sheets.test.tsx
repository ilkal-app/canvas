// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { TraceTintModel } from '@canvas/engine';

import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ToastRegionStore } from '../feedback/toast-region-store.js';
import { ToastRegionProvider, useToastRegion } from '../feedback/toast-region.js';

import { ATLAS, createAgentBoard } from './__fixtures__/agent-board.js';
import { PRESENCE_SETTLE_MS } from './sheet-agents.js';
import { TraceSheets } from './trace-sheets.js';

beforeEach(() => {
  // One page frame per test step is enough: the tabs' placement is checked in Chrome.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets presence repopulate after the person's connection came up. */
function settlePresence(): void {
  act(() => {
    vi.advanceTimersByTime(PRESENCE_SETTLE_MS);
  });
}

/**
 * An engine that records the tints it is shown, with a camera at the origin.
 *
 * @returns The engine and the tints.
 */
function fakeEngine() {
  const tints: TraceTintModel[] = [];
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    showTraceTint: (model: TraceTintModel) => tints.push(model),
  } as unknown as MountedEngine;
  return { engine, tints };
}

function setUp(canEdit = true, beside: ReactElement | null = null) {
  const board = createAgentBoard();
  const { engine, tints } = fakeEngine();
  const notices: string[] = [];
  // Item 4: the stopped agent's notice is a toast in the one region, not in the tab.
  // Rewritten, assertions kept: no alert while the agent works (rather than an empty one in the
  // tab), the stopped notice in the region (rather than in the tab), and Ask again first of the
  // notice's buttons, the tab keeping Lift off and Keep sheet.
  render(
    <>
      {beside}
      <TraceSheets
        connection={board.connection}
        engine={engine}
        canEdit={canEdit}
        themeName="dark"
        onNotice={(message) => notices.push(message)}
      />
    </>,
    { wrapper: ToastRegionProvider },
  );
  act(() => {
    board.connection.set({ state: 'connected' });
  });
  settlePresence();
  return { board, tints, notices };
}

describe('TraceSheets', () => {
  it('opens a sheet with the agent’s name, announces it, and tints its objects', () => {
    const { board, tints } = setUp();
    let ids: string[] = [];
    act(() => {
      ids = board.agentCreates([0, 300]);
    });
    const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
    expect(within(tab).getByText('2 objects so far · on its own sheet')).toBeTruthy();
    expect(within(tab).getByRole('button', { name: 'Lift off' })).toBeTruthy();
    expect(within(tab).getByRole('button', { name: 'Keep sheet' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Atlas is working on a trace sheet.');
    expect(tints.at(-1)).toEqual({
      sheets: [
        {
          bounds: { minX: 0, minY: 0, maxX: 400, maxY: 60 },
          color: [157 / 255, 180 / 255, 196 / 255, 1],
        },
      ],
    });
    expect(ids).toHaveLength(2);
  });

  it('shows a viewer the sheet and its name, without Keep or Lift off', () => {
    const { board } = setUp(false);
    act(() => {
      board.agentCreates([0]);
    });
    const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
    expect(within(tab).queryByRole('button')).toBeNull();
  });

  it('closes the sheet on Keep and leaves the board as it is', () => {
    const { board, tints } = setUp();
    let ids: string[] = [];
    act(() => {
      ids = board.agentCreates([0, 300]);
    });
    act(() => {
      screen.getByRole('button', { name: 'Keep sheet' }).click();
    });
    expect(screen.queryByRole('region')).toBeNull();
    expect(tints.at(-1)).toEqual({ sheets: [] });
    expect(ids.map((id) => board.person.get(id as never) !== undefined)).toEqual([true, true]);
  });

  it('lifts the sheet off in one undo step, keeping what the person changed, with a notice', () => {
    const { board, notices } = setUp();
    const history = createHistory(board.person, board.connection.origin.principalId);
    let ids: string[] = [];
    act(() => {
      ids = board.agentCreates([0, 300, 600]);
    });
    const [one, two, three] = ids as [never, never, never];
    act(() => {
      board.personMoves(two);
    });
    history.stopCapturing();
    act(() => {
      screen.getByRole('button', { name: 'Lift off' }).click();
    });
    expect([one, two, three].map((id) => board.person.get(id) !== undefined)).toEqual([
      false,
      true,
      false,
    ]);
    expect(notices).toEqual(['Lifted off 2 objects. Kept 1 object someone has changed since.']);
    expect(screen.queryByRole('region')).toBeNull();

    act(() => {
      history.undo();
    });
    expect([one, three].map((id) => board.person.get(id) !== undefined)).toEqual([true, true]);
    // Brought back by the person's own undo: not the agent's new work, so no sheet.
    expect(screen.queryByRole('region')).toBeNull();
  });

  describe('when the agent stops mid-way', () => {
    const stoppedText = 'Atlas stopped: connection lost. What it drafted stays on the sheet.';

    it('says the agent stopped, in the header and an announced notice, the objects untouched', () => {
      const { board } = setUp();
      let ids: string[] = [];
      act(() => {
        ids = board.agentCreates([0, 300]);
      });
      const before = ids.map((id) => board.person.get(id as never));
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      const tab = screen.getByRole('region', { name: 'Atlas · stopped' });
      expect(tab.dataset.stopped).toBe('true');
      expect(within(tab).getByText('2 objects so far · on its own sheet')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toBe(stoppedText);
      expect(within(tab).queryByRole('alert')).toBeNull();
      expect(ids.map((id) => board.person.get(id as never))).toEqual(before);
    });

    it('shows Ask again disabled, not available yet, first of the notice’s buttons', () => {
      const { board } = setUp();
      act(() => {
        board.agentCreates([0]);
      });
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      const tab = screen.getByRole('region', { name: 'Atlas · stopped' });
      expect(
        within(tab)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Lift off', 'Keep sheet']);
      const notice = screen.getByRole('alert').parentElement;
      if (notice === null) throw new Error('no notice');
      const buttons = within(notice).getAllByRole('button');
      // An Error that states a condition: no Dismiss, it stays while the agent is stopped.
      expect(
        buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent),
      ).toEqual(['Ask again — not available yet']);
      const [askAgain] = buttons as [HTMLButtonElement];
      expect(askAgain.getAttribute('aria-disabled')).toBe('true');
      expect(askAgain.disabled).toBe(false);
      act(() => {
        askAgain.click();
      });
      expect(screen.getByRole('region', { name: 'Atlas · stopped' })).toBe(tab);
    });

    it('posts an Ask again whose handler, if ever run, changes nothing', () => {
      let region: ToastRegionStore | undefined;
      function RegionProbe(): null {
        region = useToastRegion();
        return null;
      }
      const { board, tints, notices } = setUp(true, <RegionProbe />);
      let ids: string[] = [];
      act(() => {
        ids = board.agentCreates([0, 300]);
      });
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      const tab = screen.getByRole('region', { name: 'Atlas · stopped' });
      const entry = region?.snapshot().entries.at(-1);
      expect(entry?.toast).toMatchObject({
        kind: 'error',
        action: { label: 'Ask again', isAvailable: false },
      });
      const before = ids.map((id) => board.person.get(id as never));
      const tintCount = tints.length;
      act(() => {
        entry?.toast.action?.onAction();
      });
      expect(ids.map((id) => board.person.get(id as never))).toEqual(before);
      expect(screen.getByRole('region', { name: 'Atlas · stopped' })).toBe(tab);
      expect(screen.getByRole('alert').textContent).toBe(stoppedText);
      expect(tints).toHaveLength(tintCount);
      expect(notices).toEqual([]);
    });

    it('keeps Keep as before: the sheet closes and the board stays', () => {
      const { board, tints } = setUp();
      let ids: string[] = [];
      act(() => {
        ids = board.agentCreates([0, 300]);
      });
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      act(() => {
        screen.getByRole('button', { name: 'Keep sheet' }).click();
      });
      expect(screen.queryByRole('region')).toBeNull();
      expect(tints.at(-1)).toEqual({ sheets: [] });
      expect(ids.map((id) => board.person.get(id as never) !== undefined)).toEqual([true, true]);
    });

    it('keeps Lift off as before, its notice naming the agent as presence last did', () => {
      const { board, notices } = setUp();
      let ids: string[] = [];
      act(() => {
        ids = board.agentCreates([0, 300, 600]);
      });
      const [, two] = ids as [never, never, never];
      act(() => {
        board.personMoves(two);
      });
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      act(() => {
        screen.getByRole('button', { name: 'Lift off' }).click();
      });
      expect(ids.map((id) => board.person.get(id as never) !== undefined)).toEqual([
        false,
        true,
        false,
      ]);
      expect(notices).toEqual(['Lifted off 2 objects. Kept 1 object someone has changed since.']);
      expect(screen.queryByRole('region')).toBeNull();
    });

    it('returns to work, the notice gone, when the agent comes back', () => {
      const { board } = setUp();
      act(() => {
        board.agentCreates([0]);
      });
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      expect(screen.getByRole('region', { name: 'Atlas · stopped' })).toBeTruthy();
      act(() => {
        board.connection.set({ collaborators: [ATLAS] });
      });
      const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
      expect(tab.dataset.stopped).toBe('false');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        within(tab)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Lift off', 'Keep sheet']);
    });

    it('does not take the person’s own lost connection for the agent stopping', () => {
      const { board } = setUp();
      act(() => {
        board.agentCreates([0]);
      });
      act(() => {
        board.connection.set({ state: 'offline', collaborators: [] });
      });
      expect(screen.getByRole('region', { name: 'Atlas’s trace sheet' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not take the person’s own reconnect, presence arriving after it, for a stop', () => {
      const { board } = setUp();
      act(() => {
        board.agentCreates([0]);
      });
      act(() => {
        board.connection.set({ state: 'connecting', collaborators: [] });
      });
      // Connected again before the relay's presence has reached the person.
      act(() => {
        board.connection.set({ state: 'connected', collaborators: [] });
      });
      expect(screen.getByRole('region', { name: 'Atlas’s trace sheet' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => {
        board.connection.set({ collaborators: [ATLAS] });
      });
      settlePresence();
      expect(screen.getByRole('region', { name: 'Atlas’s trace sheet' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says the agent stopped once presence has had its chance after a reconnect', () => {
      const { board } = setUp();
      act(() => {
        board.agentCreates([0]);
      });
      act(() => {
        board.connection.set({ state: 'connecting', collaborators: [] });
      });
      act(() => {
        board.connection.set({ state: 'connected', collaborators: [] });
      });
      expect(screen.queryByRole('alert')).toBeNull();
      settlePresence();
      expect(screen.getByRole('region', { name: 'Atlas · stopped' })).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toBe(stoppedText);
    });

    it('never says an agent presence has not shown stopped', () => {
      const { board } = setUp();
      act(() => {
        board.connection.set({ collaborators: [] });
      });
      act(() => {
        board.agentCreates([0]);
      });
      // No presence name to show: the agent's id, as the document records it.
      expect(screen.getByRole('region', { name: 'atlas’s trace sheet' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
