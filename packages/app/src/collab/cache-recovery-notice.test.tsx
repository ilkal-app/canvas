// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { CacheRecoveryState } from '@canvas/collab';

import { ToastRegionProvider } from '../feedback/toast-region.js';

import { CacheRecoveryNotice } from './cache-recovery-notice.js';
import { downloadRecoverySources } from './download-recovery-sources.js';

// Item 4 moved the notice into the one toast region (of
// 2026-10-07): each render is wrapped in a provider; the assertions are unchanged.
const wrapper = ToastRegionProvider;

vi.mock('./download-recovery-sources.js', () => ({ downloadRecoverySources: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function source(state: CacheRecoveryState) {
  return { state, subscribe: () => () => undefined, exportSources: () => Promise.resolve([]) };
}

it('keeps unresolved content visible and exports without dismissing or deleting it', async () => {
  const recovery = source({ phase: 'retained', unresolvedRecordCount: 2 });
  render(<CacheRecoveryNotice recovery={recovery} boardId="board-1" />, { wrapper });
  expect(screen.getByRole('status', { name: 'Saved recovery copy' }).textContent).toContain(
    '2 saved records',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download recovery copy' }));
  await waitFor(() => {
    expect(downloadRecoverySources).toHaveBeenCalledWith(recovery, 'board-1');
  });
  expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
});

it('reports an export failure while leaving the download action available', async () => {
  vi.mocked(downloadRecoverySources).mockRejectedValueOnce(new Error('storage unavailable'));
  render(
    <CacheRecoveryNotice
      recovery={source({ phase: 'failed', unresolvedRecordCount: 0 })}
      boardId="board-1"
    />,
    { wrapper },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download recovery copy' }));
  await waitFor(() => {
    expect(screen.getByRole('status', { name: 'Saved recovery copy' }).textContent).toContain(
      'Download failed',
    );
  });
  expect(
    screen.getByRole('button', { name: 'Download recovery copy' }).hasAttribute('disabled'),
  ).toBe(false);
});

it('keeps the saved copy downloadable while recovery waits offline', async () => {
  const recovery = source({ phase: 'waiting', unresolvedRecordCount: 0 });
  render(<CacheRecoveryNotice recovery={recovery} boardId="board-1" />, { wrapper });
  expect(screen.getByRole('status', { name: 'Saved recovery copy' }).textContent).toContain(
    'waiting for a connection',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download recovery copy' }));
  await waitFor(() => {
    expect(downloadRecoverySources).toHaveBeenCalledWith(recovery, 'board-1');
  });
});
