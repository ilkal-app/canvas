// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOAST_DURATION_MS, Toast } from './toast.js';
import toastCss from './toast.module.css?raw';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('keeps its live region in place and empty while there is nothing to say', () => {
    render(<Toast role="status" toast={undefined} onDismiss={() => undefined} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    expect(region.parentElement?.dataset.kind).toBeUndefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('holds only the sentence in its region, with its action and Dismiss beside it', () => {
    const onAction = vi.fn<() => void>();
    const onDismiss = vi.fn<() => void>();
    render(
      <Toast
        role="alert"
        toast={{ kind: 'error', message: 'Couldn’t save', action: { label: 'Retry', onAction } }}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t save');
    expect(screen.getByRole('alert').parentElement?.dataset.kind).toBe('error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Couldn’t save' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('draws an inverse toast with no dot and no Dismiss button, its action kept (frame H4)', () => {
    const onAction = vi.fn<() => void>();
    render(
      <Toast
        role="status"
        toast={{
          kind: 'success',
          message: '“Hiring loop” moved to Trash',
          action: { label: 'Undo', onAction },
          tone: 'inverse',
        }}
        onDismiss={() => undefined}
      />,
    );
    const toast = screen.getByRole('status').parentElement;
    expect(toast?.dataset.tone).toBe('inverse');
    expect(toast?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    // The fill and its ink, and an amber action (no new colours: theme tokens).
    expect(toastCss).toMatch(/\.toast\[data-tone='inverse'\] \{[^}]*var\(--color-action-fill\)/);
    expect(toastCss).toMatch(/var\(--color-hand-you\)/);
  });

  it('goes by itself after its time when timed, and stays when not', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn<() => void>();
    const { rerender } = render(
      <Toast
        role="status"
        toast={{ kind: 'success', message: 'Sent', isTimed: true }}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    rerender(
      <Toast role="status" toast={{ kind: 'info', message: 'Loading' }} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows an action whose feature is not built disabled, saying so, and doing nothing', () => {
    const onAction = vi.fn<() => void>();
    render(
      <Toast
        role="alert"
        toast={{
          kind: 'error',
          message: 'Stopped',
          action: { label: 'Ask again', onAction, isAvailable: false },
        }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Ask again — not available yet' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('Ask again — not available yet');
    expect(button.textContent).toBe('Ask again');
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Stopped');
  });

  it('has no Dismiss without a handler', () => {
    render(<Toast role="status" toast={{ kind: 'info', message: 'Loading' }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is drawn as the Toast component: the sheet, its hairline, 8 px corners and an 8 px dot', () => {
    expect(toastCss).toMatch(
      /\.toast\[data-kind\] \{[^}]*border: 1px solid var\(--color-line-hairline\);[^}]*border-radius: 8px;[^}]*background: var\(--color-surface-sheet\);[^}]*box-shadow: var\(--shadow-float\);/,
    );
    expect(toastCss).toMatch(/\.dot \{[^}]*width: 8px;[^}]*height: 8px;/);
    expect(toastCss).toMatch(
      /\[data-kind='success'\] \.dot \{\s*background: var\(--color-mark-live\);/,
    );
    expect(toastCss).toMatch(
      /\[data-kind='error'\] \.dot \{\s*background: var\(--color-mark-red-pencil\);/,
    );
  });
});
