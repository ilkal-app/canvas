// @vitest-environment jsdom
// The Facilitate card over the board timer: roles, start, pause, resume, reset,
// the duration field, collapse, mute, and the run-out toast and chime, on a frozen relay clock.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { FacilitateCard, TIMER_RUN_OUT_MESSAGE } from './facilitate-card.js';
import type { TimerChime } from './timer-chime.js';
import { TIMER_TICK_MS } from './use-board-timer.js';

const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };
const T0 = 1_770_000_000_000;

let serverNow = T0;
let clockReads = 0;
const clock = {
  now: () => {
    clockReads += 1;
    return serverNow;
  },
};

/**
 * Moves the relay clock and the page's timers on together.
 *
 * @param ms - How far.
 */
function advance(ms: number): void {
  act(() => {
    serverNow += ms;
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Renders the card over a fresh board.
 *
 * @param options - Who the person may be, and the device's storage.
 * @param options.canEdit - Whether they may change the timer; true by default.
 * @param options.storage - The device's storage.
 * @returns The store and the chime's plays.
 */
function renderCard(options: { canEdit?: boolean; storage?: Map<string, string> } = {}) {
  const store = new YjsDocumentStore();
  let plays = 0;
  const chime: TimerChime = {
    play: () => {
      plays += 1;
      return true;
    },
    dispose: vi.fn(),
  };
  const values = options.storage ?? new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  render(
    <FacilitateCard
      source={{ store, origin: ADA, serverClock: clock }}
      canEdit={options.canEdit ?? true}
      storage={storage}
      createChime={() => chime}
    />,
  );
  return { store, plays: () => plays };
}

beforeEach(() => {
  vi.useFakeTimers();
  serverNow = T0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const button = (name: RegExp | string) => screen.getByRole('button', { name });

describe('the Facilitate card', () => {
  it('starts, counts down on the relay clock, pauses, resumes and resets', () => {
    const { store } = renderCard();
    expect(screen.getByRole('region', { name: 'Facilitate' })).toHaveProperty(
      'dataset.popoverAvoid',
      '',
    );
    expect(button(/^05:00 left/).textContent).toBe('05:00');
    fireEvent.click(button('Start the timer'));
    expect(store.boardTimer.current).toMatchObject({ status: 'running', updatedBy: 'user:ada' });
    advance(1500);
    expect(button(/left/).textContent).toBe('04:59');
    expect(button('Pause the timer').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Pause the timer'));
    expect(store.boardTimer.current?.status).toBe('paused');
    advance(10_000);
    expect(button(/left/).textContent).toBe('04:59');
    fireEvent.click(button('Resume the timer'));
    advance(2000);
    expect(button(/left/).textContent).toBe('04:57');
    fireEvent.click(button('Reset the timer'));
    expect(store.boardTimer.current?.status).toBe('idle');
    expect(button(/left/).textContent).toBe('05:00');
    expect(button('Reset the timer')).toHaveProperty('disabled', true);
  });

  it('sets the duration from the time while not running, refusing what is not one', () => {
    const { store } = renderCard();
    fireEvent.click(button(/^05:00 left, set the duration/));
    const field = screen.getByRole('textbox', { name: 'Timer duration' });
    fireEvent.change(field, { target: { value: 'soon' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field, { target: { value: '1:30' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByText('of 01:30')).toBeTruthy();
    expect(store.boardTimer.current).toBeUndefined();
    fireEvent.click(button('Start the timer'));
    expect(store.boardTimer.current?.durationMs).toBe(90_000);
    expect(button(/left/)).toHaveProperty('disabled', true);
    fireEvent.click(button('Pause the timer'));
    fireEvent.click(button(/left, set the duration/));
    const again = screen.getByRole('textbox', { name: 'Timer duration' });
    fireEvent.change(again, { target: { value: '10' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(store.boardTimer.current?.durationMs).toBe(90_000);
    fireEvent.click(button(/left, set the duration/));
    fireEvent.change(screen.getByRole('textbox', { name: 'Timer duration' }), {
      target: { value: '10' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Timer duration' }));
    expect(store.boardTimer.current).toMatchObject({ status: 'idle', durationMs: 600_000 });
  });

  it('says when the timer runs out, and chimes unless this device muted it', () => {
    const storage = new Map<string, string>();
    const { plays } = renderCard({ storage });
    fireEvent.click(button(/set the duration/));
    fireEvent.change(screen.getByRole('textbox', { name: 'Timer duration' }), {
      target: { value: '0:02' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Timer duration' }), { key: 'Enter' });
    fireEvent.click(button('Start the timer'));
    advance(2000 + TIMER_TICK_MS);
    expect(screen.getByText(TIMER_RUN_OUT_MESSAGE)).toBeTruthy();
    expect(plays()).toBe(1);
    expect(button(/left/).textContent).toBe('00:00');
    // No tick once it reached zero: nothing left to count, so the clock is not read.
    const reads = clockReads;
    advance(5 * TIMER_TICK_MS);
    expect(clockReads).toBe(reads);
    fireEvent.click(button('Mute the timer’s sound'));
    expect(storage.get('canvas.facilitation.timerMuted')).toBe('true');
    fireEvent.click(button('Start the timer'));
    advance(2000 + TIMER_TICK_MS);
    expect(plays()).toBe(1);
  });

  it('shows a timer someone else runs, and lets a viewer change nothing', () => {
    const { store } = renderCard({ canEdit: false });
    for (const name of ['Start the timer', 'Reset the timer'])
      expect(button(name)).toHaveProperty('disabled', true);
    expect(button(/^05:00 left$/)).toHaveProperty('disabled', true);
    act(() => {
      store.transact({ kind: 'system', principalId: 'system' as PrincipalId }, (transaction) => {
        transaction.setBoardTimer({
          status: 'running',
          durationMs: 60_000,
          remainingMs: 60_000,
          startedAt: T0,
          sectionId: null,
          updatedBy: 'user:bob' as PrincipalId,
        });
      });
    });
    advance(30_000);
    expect(button(/left/).textContent).toBe('00:30');
    expect(button('Pause the timer')).toHaveProperty('disabled', true);
  });

  it('collapses to its head, with the time beside the name', () => {
    renderCard();
    fireEvent.click(button('Start the timer'));
    fireEvent.click(button('Collapse Facilitate'));
    expect(screen.queryByRole('button', { name: 'Pause the timer' })).toBeNull();
    expect(screen.getByText('05:00')).toBeTruthy();
    expect(button('Expand Facilitate').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button('Expand Facilitate'));
    expect(button('Pause the timer')).toBeTruthy();
  });
});
