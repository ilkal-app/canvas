// @vitest-environment jsdom
// The one toast region (UI-18, item 4): stacking with the newest nearest the dock, the
// timing per kind (D-TOAST) with fake timers, Escape, and the dialog case (the region shows
// inside an open dialog, so its toasts stay reachable while the page behind is inert). The pure
// rules: toast-region-store.test.ts; placement: toast-placement.test.ts; with a dialog open:
// toast-region-dialog.test.tsx; in Chrome:
// tooling/scenario/specs/app/toast-region.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RegionToast } from './toast-region-store.js';
import {
  PostedToast,
  ToastHome,
  ToastRegionBoundary,
  ToastRegionProvider,
  useToast,
  useToastRegion,
} from './toast-region.js';
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
 * The messages shown, in the region's order.
 *
 * @returns The messages.
 */
function shownMessages(): string[] {
  const stack = document.querySelector('[data-toast-region]');
  return [...(stack?.querySelectorAll('[role="status"], [role="alert"]') ?? [])].map(
    (region) => region.textContent,
  );
}

describe('the toast region: stacking', () => {
  it('stacks every posted toast in one place, the newest last, nearest the dock', () => {
    render(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'info', message: 'Moved to Two.' }} />
        <Poster toast={{ kind: 'success', message: 'Invite sent' }} />
        <Poster toast={{ kind: 'error', message: 'Couldn’t save', onDismiss: vi.fn() }} />
      </ToastRegionProvider>,
    );
    expect(document.querySelectorAll('[data-toast-region]')).toHaveLength(1);
    expect(shownMessages()).toEqual(['Moved to Two.', 'Invite sent', 'Couldn’t save']);
    // Polite for what was done, assertive for why not.
    expect(screen.getAllByRole('status').map((region) => region.textContent)).toEqual([
      'Moved to Two.',
      'Invite sent',
    ]);
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t save');
  });

  it('shows in a shell’s home over its own place, and nothing while there is no toast', () => {
    const { rerender } = render(
      <ToastRegionProvider>
        <div data-testid="shell">
          <ToastHome />
        </div>
        <Poster toast={undefined} />
      </ToastRegionProvider>,
    );
    expect(document.querySelector('[data-toast-region]')).toBeNull();
    rerender(
      <ToastRegionProvider>
        <div data-testid="shell">
          <ToastHome />
        </div>
        <Poster
          toast={{ kind: 'info', message: 'You can view this board', label: 'Board access' }}
        />
      </ToastRegionProvider>,
    );
    const region = screen.getByRole('status', { name: 'Board access' });
    expect(within(screen.getByTestId('shell')).getByRole('status')).toBe(region);
  });

  it('posts a shared Toast’s content where one was rendered in place', () => {
    const onDismiss = vi.fn<() => void>();
    render(
      <ToastRegionProvider>
        <PostedToast toast={{ kind: 'error', message: 'Couldn’t revoke' }} onDismiss={onDismiss} />
        <PostedToast toast={undefined} />
      </ToastRegionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Couldn’t revoke' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mounts each toast’s live region empty, then fills it, so it is announced', () => {
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { subtree: true, childList: true });
    render(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'info', message: 'Loading the people on this board…' }} />
      </ToastRegionProvider>,
    );
    const records = observer.takeRecords();
    observer.disconnect();
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('Loading the people on this board…');
    // The sentence arrived in a region already in the page, not with it.
    const filled = records.filter(
      (record) =>
        record.target === region &&
        [...record.addedNodes].some((node) => node.textContent === region.textContent),
    );
    expect(filled).toHaveLength(1);
  });

  // With no provider above (a part shown on its own, in a test or an embed), a poster shows its
  // toast in place, in a minimal region of its own, as the region would.
  it('shows a toast in place, with its role, name, action and Dismiss, with no region above', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn<() => void>();
    const onDismiss = vi.fn<() => void>();
    const { container, rerender } = render(
      <Poster
        toast={{
          kind: 'info',
          message: 'Connection dropped. Reconnecting…',
          label: 'Board sync',
          isPersistent: true,
          action: { label: 'Retry now', onAction: onRetry },
        }}
      />,
    );
    const region = screen.getByRole('status', { name: 'Board sync' });
    expect(region.textContent).toBe('Connection dropped. Reconnecting…');
    expect(container.querySelector('[data-toast-standalone]')?.contains(region)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // A condition has no Dismiss and stays.
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(screen.getByRole('status', { name: 'Board sync' })).toBeTruthy();
    // An Error speaks assertively and offers Dismiss; an Info goes after its time.
    rerender(<Poster toast={{ kind: 'error', message: 'Couldn’t save', onDismiss }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Couldn’t save' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<Poster toast={{ kind: 'info', message: 'Moved to Two.' }} />);
    expect(screen.getByRole('status').textContent).toBe('Moved to Two.');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<Poster toast={undefined} />);
    expect(container.querySelector('[data-toast-region]')).toBeNull();
  });

  it('shows nothing in place inside a region: the region shows it', () => {
    render(
      <ToastRegionProvider>
        <div data-testid="poster-place">
          <Poster toast={{ kind: 'info', message: 'Moved to Two.' }} />
        </div>
      </ToastRegionProvider>,
    );
    expect(screen.getByTestId('poster-place').childElementCount).toBe(0);
    expect(document.querySelector('[data-toast-standalone]')).toBeNull();
    expect(shownMessages()).toEqual(['Moved to Two.']);
  });

  it('refuses a place for toasts with no region above', () => {
    // React reports the error it rethrows; kept out of the output.
    const report = vi.spyOn(globalThis.console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ToastHome />)).toThrow('no ToastRegionProvider above');
    report.mockRestore();
  });

  it('makes one region per page: a boundary inside a provider uses it', () => {
    let outer: unknown;
    let inner: unknown;
    function Probe(props: { readonly onStore: (store: unknown) => void }): null {
      props.onStore(useToastRegion());
      return null;
    }
    render(
      <ToastRegionProvider>
        <Probe onStore={(store) => (outer = store)} />
        <ToastRegionBoundary>
          <Probe onStore={(store) => (inner = store)} />
        </ToastRegionBoundary>
      </ToastRegionProvider>,
    );
    expect(inner).toBe(outer);
  });
});

describe('the toast region: timing per kind (D-TOAST)', () => {
  it('lets Info and Success go after 4 s and keeps an Error and a condition', () => {
    vi.useFakeTimers();
    const onInfoDismiss = vi.fn<() => void>();
    render(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'info', message: 'Moved', onDismiss: onInfoDismiss }} />
        <Poster toast={{ kind: 'success', message: 'Sent' }} />
        <Poster toast={{ kind: 'error', message: 'Not sent', onDismiss: vi.fn() }} />
        <Poster
          toast={{ kind: 'info', message: 'Loading the people on this board…', isPersistent: true }}
        />
      </ToastRegionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(shownMessages()).toHaveLength(4);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onInfoDismiss).toHaveBeenCalledTimes(1);
    expect(shownMessages()).toEqual(['Not sent', 'Loading the people on this board…']);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(shownMessages()).toEqual(['Not sent', 'Loading the people on this board…']);
    // The condition offers no Dismiss; the error stays until dismissed.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Dismiss']);
  });

  it('restarts the time for a toast posted anew, and keeps it across renders', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'info', message: 'Refused', key: 1 }} />
      </ToastRegionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    rerender(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'info', message: 'Refused', key: 1 }} />
      </ToastRegionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(shownMessages()).toEqual([]);
    rerender(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'info', message: 'Refused', key: 2 }} />
      </ToastRegionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(shownMessages()).toEqual(['Refused']);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(shownMessages()).toEqual([]);
  });

  it('withdraws a toast when its poster unmounts', () => {
    const { rerender } = render(
      <ToastRegionProvider>
        <Poster toast={{ kind: 'error', message: 'Stopped' }} />
      </ToastRegionProvider>,
    );
    expect(shownMessages()).toEqual(['Stopped']);
    rerender(<ToastRegionProvider />);
    expect(shownMessages()).toEqual([]);
  });
});

describe('the toast region: Escape', () => {
  /**
   * A page with a field, a menu that takes Escape, and three toasts.
   *
   * @returns The page.
   */
  function Page(): ReactElement {
    return (
      <ToastRegionProvider>
        <input aria-label="Name" />
        <div
          role="menu"
          tabIndex={-1}
          aria-label="Board"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault();
          }}
        />
        <button type="button">Canvas</button>
        <Poster toast={{ kind: 'info', message: 'Offline', isPersistent: true }} />
        <Poster toast={{ kind: 'info', message: 'First', onDismiss: vi.fn() }} />
        <Poster toast={{ kind: 'error', message: 'Second', onDismiss: vi.fn() }} />
        <Poster toast={{ kind: 'info', message: 'Kept', isPersistent: true }} />
      </ToastRegionProvider>
    );
  }

  it('dismisses the newest toast that can be dismissed, one per press', () => {
    render(<Page />);
    const canvas = screen.getByRole('button', { name: 'Canvas' });
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(shownMessages()).toEqual(['Offline', 'First', 'Kept']);
    fireEvent.keyDown(canvas, { key: 'Escape', repeat: true });
    expect(shownMessages()).toEqual(['Offline', 'First', 'Kept']);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(shownMessages()).toEqual(['Offline', 'Kept']);
  });

  it('leaves Escape to text editing, a menu that took it and an IME, and other keys alone', () => {
    render(<Page />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Board' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Canvas' }), {
      key: 'Escape',
      isComposing: true,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Canvas' }), { key: 'Enter' });
    expect(shownMessages()).toEqual(['Offline', 'First', 'Second', 'Kept']);
  });

  it('does not take Escape from the canvas: the window still hears it', () => {
    const heard = vi.fn<(event: KeyboardEvent) => void>();
    window.addEventListener('keydown', heard);
    render(<Page />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Canvas' }), { key: 'Escape' });
    window.removeEventListener('keydown', heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0]?.[0].defaultPrevented).toBe(false);
  });
});
