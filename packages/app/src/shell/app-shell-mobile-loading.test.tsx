// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// L1 below 768 px wide: while the live board loads, editing is refused everywhere the
// compact chrome says so, not only on the bar: the undo pill is dimmed and out of reach, the engine
// takes no edit and the shortcuts none, and no "You can view this board" notice shows for an editor.
// Once the board is live, all of it works again. 768 px and wider is unchanged ('s L1 there
// refuses nothing). In Chrome: tooling/scenario/specs/app/mobile-connection-states.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { VIEW_ONLY_MESSAGE } from '../collab/view-only-notice.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { fakeViewport } from './__fixtures__/fake-media.js';
import { AppShell } from './app-shell.js';

/**
 * Gives the page a viewport of a width, as `window.matchMedia` answers it.
 *
 * @param width - The width, CSS px.
 */
function useViewport(width: number): void {
  const viewport = fakeViewport(width);
  // The width queries from the viewport; any other (the colour scheme) answered no.
  const matchMedia = (query: string) =>
    query.startsWith('(width') ? viewport.matchMedia(query) : viewport.matchMedia('(width < 0px)');
  Object.defineProperty(window, 'matchMedia', {
    value: matchMedia,
    configurable: true,
    writable: true,
  });
}

/**
 * Renders the shell on a board whose live copy is loading.
 *
 * @returns The connection and the engine.
 * @throws {Error} When no engine mounted.
 */
function renderLoading() {
  const { mount, engines } = createFakeMount();
  const connection = new FakeBoardConnection('demo');
  connection.setState('connecting');
  render(<AppShell mode="diagram" platform="mac" mountEngine={mount} connection={connection} />);
  const engine = engines[0];
  if (engine === undefined) throw new Error('Missing engine.');
  return { connection, engine };
}

beforeEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('the live board loading below 768 px wide (L1)', () => {
  it('refuses Undo from the pill, the engine’s edits and the shortcuts until the board is live', () => {
    useViewport(390);
    const { connection, engine } = renderLoading();
    const pill = screen.getByRole('group', { name: 'History', hidden: true });
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(pill).getByRole('button', { name: 'Undo', hidden: true }));
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(engine.actions).toEqual([]);
    expect(engine.editable.at(-1)).toBe(false);
    // An editor is not told they can only view.
    expect(screen.queryByText(VIEW_ONLY_MESSAGE)).toBeNull();
    // The bar keeps the editor's buttons, dimmed (five: the mode button went).
    const bar = screen.getByRole('toolbar', { name: 'Tools', hidden: true });
    expect(within(bar).getAllByRole('button', { hidden: true })).toHaveLength(5);

    act(() => {
      connection.setState('connected');
    });
    expect(engine.editable.at(-1)).toBe(true);
    const live = screen.getByRole('group', { name: 'History' });
    expect(live.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(within(live).getByRole('button', { name: 'Undo' }));
    expect(engine.actions).toContainEqual({ type: 'history', command: 'undo' });
  });

  it('at 768 px refuses nothing, as before', () => {
    useViewport(768);
    const { engine } = renderLoading();
    expect(engine.editable.at(-1)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(engine.actions).toContainEqual({ type: 'history', command: 'undo' });
  });
});
