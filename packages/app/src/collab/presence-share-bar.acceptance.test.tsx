// @vitest-environment jsdom
// Presence and sharing in Whiteboard frame A uses a floating sheet on desktop.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardConnectionStatus } from './board-connection-status.js';
import type { ConnectionStatusSource } from './board-connection.js';
import { PresenceShareBar } from './presence-share-bar.js';

afterEach(cleanup);

/** A connected board whose status is stable for the DOM contract. */
class ConnectedBoard implements ConnectionStatusSource {
  readonly #connected: BoardConnectionStatus = {
    boardId: 'viv-614-unit',
    state: 'connected',
    isLocalOnly: false,
    isSavedOnDevice: true,
    pendingUpdateCount: 0,
    isAcknowledged: true,
    isReadOnly: false,
    rejectionReason: undefined,
    collaborators: [],
    strandedEdits: [],
  };

  status(): BoardConnectionStatus {
    return this.#connected;
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

describe('PresenceShareBar floating sheet', () => {
  it('keeps the named presence group, status and Share inside the floating sheet', () => {
    render(<PresenceShareBar connection={new ConnectedBoard()} onShare={vi.fn()} isFloating />);
    const bar = screen.getByRole('group', { name: 'Presence and sharing' });
    expect(bar.getAttribute('data-top-bar')).toBe('presence');
    expect(bar.getAttribute('data-floating-sheet')).toBe('');
    expect(bar.getAttribute('data-shape')).toBe('bar');
    expect(within(bar).getByRole('status', { name: 'Connection: Connected' }).textContent).toBe(
      'Live',
    );
    expect(within(bar).getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it('keeps the classic presence group without floating sheet attributes by default', () => {
    render(<PresenceShareBar connection={new ConnectedBoard()} onShare={vi.fn()} />);
    const bar = screen.getByRole('group', { name: 'Presence and sharing' });
    expect(bar.getAttribute('data-top-bar')).toBe('presence');
    expect(bar.hasAttribute('data-floating-sheet')).toBe(false);
    expect(bar.hasAttribute('data-shape')).toBe(false);
    expect(within(bar).getByRole('status', { name: 'Connection: Connected' }).textContent).toBe(
      'Live',
    );
    expect(within(bar).getByRole('button', { name: 'Share' })).toBeTruthy();
  });
});
