// @vitest-environment jsdom
// Item 6: the existing PresenceShareBar and OfflineBanner are the acceptance seams.
// The notice is the retry surface; its words differ for a dropped relay and an offline device.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardConnectionStatus } from './board-connection-status.js';
import { isAwayFromRelay } from './connection-label.js';
import { OfflineBanner } from './offline-banner.js';
import { PresenceShareBar } from './presence-share-bar.js';

const CONNECTED: BoardConnectionStatus = {
  boardId: 'Plans00000000000000000',
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

afterEach(cleanup);

function connectionView(status: BoardConnectionStatus, onRetry: () => void) {
  return (
    <>
      <PresenceShareBar connection={{ status: () => status, subscribe: () => () => undefined }} />
      <OfflineBanner isShown={isAwayFromRelay(status)} onRetry={onRetry} />
    </>
  );
}

function renderConnection(status: BoardConnectionStatus, onRetry = vi.fn()) {
  const view = render(connectionView(status, onRetry));
  return { ...view, onRetry };
}

describe('relay connection lost', () => {
  it('says Reconnecting and shows the dropped-connection toast; Retry now reconnects at once', () => {
    const { onRetry } = renderConnection({ ...CONNECTED, state: 'reconnecting' });
    expect(screen.getByRole('status', { name: /^Connection: Reconnecting/ }).textContent).toBe(
      'Reconnecting',
    );
    expect(screen.getByText('Connection dropped. Reconnecting…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('removes both connection-lost notices when connected again', () => {
    const lost = renderConnection({ ...CONNECTED, state: 'reconnecting' });
    expect(screen.getByText('Connection dropped. Reconnecting…')).toBeTruthy();
    lost.rerender(connectionView(CONNECTED, lost.onRetry));
    expect(screen.queryByText('Connection dropped. Reconnecting…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Connection: Connected' }).textContent).toBe('Live');
  });

  it.each([
    ['unauthorized', 'Not authorized'],
    ['outdated', 'App out of date: reload the page'],
  ] as const)('%s keeps its terminal notice and offers no reconnect', (state, notice) => {
    renderConnection({ ...CONNECTED, state });
    expect(screen.getByRole('status', { name: `Connection: ${notice}` })).toBeTruthy();
    expect(screen.queryByText('Connection dropped. Reconnecting…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
  });
});
