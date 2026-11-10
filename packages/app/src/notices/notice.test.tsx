// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastRegionProvider } from '../feedback/toast-region.js';

import { Notice, NOTICE_DURATION_MS } from './notice.js';
import { refusalNotice } from './refusal-notice.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('refusalNotice', () => {
  const error = (message: string) =>
    ({ code: 'locked', objectId: 'a', path: [], message }) as const;

  it('says what went wrong first, and how many more', () => {
    expect(refusalNotice([error('the object is locked')])).toBe(
      'That change could not be made: the object is locked.',
    );
    expect(refusalNotice([error('a'), error('b'), error('c')])).toBe(
      'That change could not be made: a (and 2 more).',
    );
    expect(refusalNotice([])).toBe('That change could not be made.');
  });
});

// Item 4: the notice is posted to the one toast region, so each render is wrapped in a
// provider; the assertions are kept, but for the empty region (there is no region while there
// is no toast: each toast's region is mounted empty and then filled, toast-region.test.tsx) and
// Dismiss's name, which the shared Toast gives as "Dismiss: <message>".
const wrapper = ToastRegionProvider;

describe('Notice', () => {
  it('shows politely and goes after its time, restarting for a new notice', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const view = render(
      <Notice notice={{ message: 'Refused', sequence: 1 }} onDismiss={onDismiss} />,
      { wrapper },
    );
    expect(screen.getByRole('status', { name: 'Notice' }).textContent).toContain('Refused');
    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION_MS - 1);
    });
    view.rerender(<Notice notice={{ message: 'Again', sequence: 2 }} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while there is no notice, and clears its timer on unmount', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const view = render(<Notice notice={undefined} onDismiss={onDismiss} />, { wrapper });
    expect(screen.queryByRole('status', { name: 'Notice' })).toBeNull();
    view.rerender(<Notice notice={{ message: 'Refused', sequence: 1 }} onDismiss={onDismiss} />);
    expect(screen.getByRole('status', { name: 'Notice' }).textContent).toContain('Refused');
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION_MS);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('goes when dismissed', () => {
    const onDismiss = vi.fn();
    render(<Notice notice={{ message: 'Refused', sequence: 1 }} onDismiss={onDismiss} />, {
      wrapper,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Refused' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Notice with an action', () => {
  it('shows its button, which runs the action and hides the notice', () => {
    const run = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Notice
        notice={{ message: 'Moved to Two.', sequence: 1, action: { label: 'Go to Two', run } }}
        onDismiss={onDismiss}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to Two' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
