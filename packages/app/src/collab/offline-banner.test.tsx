// @vitest-environment jsdom
// The offline banner: its message in a polite live region, Retry now.
// item 6: its words for a dropped relay; the tests of an offline device now say so
// (`isDeviceOffline`). Item 4 moved it into the one toast region (
// of 2026-10-07): rewritten to render in a provider; its words, Retry now and the polite region
// are kept; it now has no Dismiss and stays until the board is back; Retry now is no longer made
// inert with the layout (the region is outside it, and inside an open dialog). In the shell: the
// top bars' tests (shell/app-shell-top-bars.test.tsx); in Chrome:
// tooling/scenario/specs/app/top-bar-states.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastRegionProvider } from '../feedback/toast-region.js';
import { TOAST_DURATION_MS } from '../feedback/toast.js';

import { CONNECTION_DROPPED_MESSAGE, OFFLINE_BANNER_MESSAGE } from './connection-label.js';
import {
  CONNECTION_DROPPED_COMPACT_MESSAGE,
  OFFLINE_BANNER_COMPACT_MESSAGE,
  OfflineBanner,
  offlineBannerMessageOf,
} from './offline-banner.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrapper = ToastRegionProvider;

describe('OfflineBanner', () => {
  it('says the board is offline and offers Retry now, which asks for a reconnection', () => {
    const onRetry = vi.fn();
    render(<OfflineBanner isShown isDeviceOffline onRetry={onRetry} />, { wrapper });
    const region = screen.getByRole('status', { name: 'Board sync' });
    expect(region.textContent).toBe(
      'You’re offline. Edits are kept on this device and sync when you reconnect.',
    );
    expect(region.textContent).toBe(OFFLINE_BANNER_MESSAGE);
    expect(region.closest('[data-kind]')?.getAttribute('data-kind')).toBe('info');
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while the board is live, and is announced when it comes', () => {
    const { rerender } = render(
      <OfflineBanner isShown={false} isDeviceOffline onRetry={vi.fn()} />,
      { wrapper },
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<OfflineBanner isShown isDeviceOffline onRetry={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Board sync' }).textContent).toBe(
      OFFLINE_BANNER_MESSAGE,
    );
  });

  it('says the connection dropped while the device is online and the client reconnects', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<OfflineBanner isShown onRetry={onRetry} />, { wrapper });
    const region = screen.getByRole('status', { name: 'Board sync' });
    expect(region.textContent).toBe(CONNECTION_DROPPED_MESSAGE);
    expect(region.textContent).toBe('Connection dropped. Reconnecting…');
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The device goes offline: its words changed, so announced again.
    rerender(<OfflineBanner isShown isDeviceOffline onRetry={onRetry} />);
    expect(screen.getByRole('status', { name: 'Board sync' }).textContent).toBe(
      OFFLINE_BANNER_MESSAGE,
    );
  });

  it('has no Retry now without a handler, no Dismiss, and stays until the board is back', () => {
    vi.useFakeTimers();
    const { rerender } = render(<OfflineBanner isShown onRetry={undefined} />, { wrapper });
    expect(screen.queryByRole('button')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('status', { name: 'Board sync' }).textContent).toBe(
      CONNECTION_DROPPED_MESSAGE,
    );
    rerender(<OfflineBanner isShown={false} onRetry={undefined} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says it in fewer words below 768 px wide (MX2), still with Retry now', () => {
    const onRetry = vi.fn();
    render(<OfflineBanner isShown isDeviceOffline isCompact onRetry={onRetry} />, { wrapper });
    const region = screen.getByRole('status', { name: 'Board sync' });
    expect(region.textContent).toBe('Offline · edits kept on this device');
    expect(region.textContent).toBe(OFFLINE_BANNER_COMPACT_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('chooses its words by the reason and the width', () => {
    expect(offlineBannerMessageOf(true, false)).toBe(OFFLINE_BANNER_MESSAGE);
    expect(offlineBannerMessageOf(false, false)).toBe(CONNECTION_DROPPED_MESSAGE);
    expect(offlineBannerMessageOf(true, true)).toBe(OFFLINE_BANNER_COMPACT_MESSAGE);
    expect(offlineBannerMessageOf(false, true)).toBe(CONNECTION_DROPPED_COMPACT_MESSAGE);
  });
});
