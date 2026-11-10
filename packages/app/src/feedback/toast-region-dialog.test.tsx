// @vitest-environment jsdom
// The one toast region with a dialog open (item 4): the region shows inside the open
// dialog, so a dialog's own toasts (Retry) stay reachable while the page behind is inert; the
// dialog keeps Tab inside and closes on Escape from a toast's button, though the region is a
// portal from outside its React tree. The rest of the region: toast-region.test.tsx.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '../dialogs/dialog.js';

import type { RegionToast } from './toast-region-store.js';
import { ToastHome, ToastRegionProvider, useToast, useToastDock } from './toast-region.js';
import { TOAST_DURATION_MS } from './toast.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Posts one toast.
 *
 * @param props - The toast.
 * @param props.toast - The toast, or undefined.
 * @returns Nothing inside a region; without one, the toast in place.
 */
function Poster(props: { readonly toast: RegionToast | undefined }): ReactElement | null {
  return useToast(props.toast);
}

/**
 * A page whose dialog posts an Error with Retry, the rest of the page `inert` while it is open,
 * as the site's pages do.
 *
 * @param props - The handlers.
 * @param props.onRetry - Retry's handler.
 * @returns The page.
 */
function PageWithDialog(props: { readonly onRetry: () => void }): ReactElement {
  const [isOpen, setOpen] = useState(true);
  return (
    <ToastRegionProvider>
      <div data-testid="page" inert={isOpen}>
        <ShellLike />
      </div>
      {isOpen ? (
        <Dialog
          title="Share"
          onClose={() => {
            setOpen(false);
          }}
        >
          <Poster
            toast={{
              kind: 'error',
              message: 'Couldn’t send the invite.',
              action: { label: 'Retry', onAction: props.onRetry },
              onDismiss: vi.fn(),
            }}
          />
        </Dialog>
      ) : null}
    </ToastRegionProvider>
  );
}

/**
 * A shell's stand-in: its home for the region and a board condition.
 *
 * @returns The shell.
 */
function ShellLike(): ReactElement {
  const dockRef = useRef<HTMLDivElement>(null);
  useToastDock(dockRef);
  return (
    <div data-testid="shell">
      <div ref={dockRef} role="toolbar" aria-label="Tools" />
      <Poster
        toast={{ kind: 'info', message: 'Connection dropped. Reconnecting…', isPersistent: true }}
      />
      <ToastHome />
    </div>
  );
}

describe('the toast region: a dialog open over an inert page', () => {
  it('shows inside the dialog, so its Retry is reachable by Tab, and goes home after', () => {
    const onRetry = vi.fn<() => void>();
    render(<PageWithDialog onRetry={onRetry} />);
    const dialog = screen.getByRole('dialog', { name: 'Share' });
    const region = document.querySelector('[data-toast-region]');
    expect(dialog.contains(region)).toBe(true);
    expect(region?.closest('[inert]')).toBeNull();
    expect(screen.getByTestId('page').hasAttribute('inert')).toBe(true);
    // The board's condition shows there too, so nothing the person is told is behind the inert page.
    expect(within(dialog).getByText('Connection dropped. Reconnecting…')).toBeTruthy();
    // Shift+Tab from the dialog's first control wraps to its last: the toast's Dismiss.
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Dismiss: Couldn’t send the invite.' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Escape in the dialog is the dialog's: it closes, the toasts stay.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const home = document.querySelector('[data-toast-home]:not(:empty)');
    expect(within(screen.getByTestId('shell')).getByText('Connection dropped. Reconnecting…')).toBe(
      home?.querySelector('[role="status"]'),
    );
  });

  it('keeps Tab inside the dialog and closes it on Escape from a toast’s button', () => {
    render(<PageWithDialog onRetry={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Share' });
    // The region is a portal from outside the dialog's React tree: the dialog hears its keys in
    // the page (`useToastHostKeys`), and no page listener does.
    const heard = vi.fn<(event: KeyboardEvent) => void>();
    window.addEventListener('keydown', heard);
    const dismiss = within(dialog).getByRole('button', {
      name: 'Dismiss: Couldn’t send the invite.',
    });
    dismiss.focus();
    fireEvent.keyDown(dismiss, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    const retry = within(dialog).getByRole('button', { name: 'Retry' });
    fireEvent.keyDown(retry, { key: 'Escape', repeat: true });
    expect(screen.getByRole('dialog', { name: 'Share' })).toBe(dialog);
    fireEvent.keyDown(retry, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Share' })).toBe(dialog);
    fireEvent.keyDown(retry, { key: 'Escape' });
    window.removeEventListener('keydown', heard);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it('makes its own region for a dialog shown on its own', () => {
    render(
      <Dialog title="New board" onClose={vi.fn()}>
        <Poster toast={{ kind: 'error', message: 'Couldn’t create the board.' }} />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New board' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Couldn’t create the board.');
  });
});

/**
 * A shell with a timed notice and a persistent banner, and a dialog opened and closed over it.
 *
 * @param props - Whether the dialog is open.
 * @param props.isDialogOpen - Whether it is.
 * @returns The page.
 */
function ShellWithToasts(props: { readonly isDialogOpen: boolean }): ReactElement {
  return (
    <ToastRegionProvider>
      <div data-testid="page" inert={props.isDialogOpen}>
        <Poster toast={{ kind: 'info', message: 'Moved to Two.', label: 'Notice' }} />
        <Poster
          toast={{
            kind: 'info',
            message: 'Connection dropped. Reconnecting…',
            label: 'Board sync',
            isPersistent: true,
          }}
        />
        <ToastHome />
      </div>
      {props.isDialogOpen ? (
        <Dialog title="Keyboard shortcuts" onClose={vi.fn()}>
          <p>Shortcuts</p>
        </Dialog>
      ) : null}
    </ToastRegionProvider>
  );
}

// Item 4: moving the region into a dialog and back
// is invisible to its toasts: their time runs on from their posting, and none is announced again.
describe('the toast region: moving between a home and a dialog', () => {
  it('keeps a timed toast’s 4 s from its posting across a dialog opening and closing', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ShellWithToasts isDialogOpen={false} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<ShellWithToasts isDialogOpen />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByRole('status', { name: 'Notice' }).textContent).toBe(
      'Moved to Two.',
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender(<ShellWithToasts isDialogOpen={false} />);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 3500 - 1);
    });
    expect(screen.getByRole('status', { name: 'Notice' }).textContent).toBe('Moved to Two.');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status', { name: 'Notice' })).toBeNull();
    // The banner stays: a condition has no time.
    expect(screen.getByRole('status', { name: 'Board sync' })).toBeTruthy();
  });

  it('moves a persistent banner’s own element, never emptying and refilling its live region', () => {
    const { rerender } = render(<ShellWithToasts isDialogOpen={false} />);
    const banner = screen.getByRole('status', { name: 'Board sync' });
    const observer = new MutationObserver(() => undefined);
    observer.observe(banner, { subtree: true, childList: true, characterData: true });
    rerender(<ShellWithToasts isDialogOpen />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByRole('status', { name: 'Board sync' })).toBe(banner);
    rerender(<ShellWithToasts isDialogOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status', { name: 'Board sync' })).toBe(banner);
    expect(document.querySelector('[data-toast-home]:not(:empty)')?.contains(banner)).toBe(true);
    // Not one change to the live region's text: nothing for a screen reader to announce again.
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(banner.textContent).toBe('Connection dropped. Reconnecting…');
  });
});
