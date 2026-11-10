// @vitest-environment jsdom
// CONTRACT: the shared timer follows relay time, stays outside personal undo,
// remains keyboard operable and read-only by role, and alerts only for an observed run-out.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHistory, YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { FacilitateCard } from './facilitate-card.js';
import type { TimerChime } from './timer-chime.js';

const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };
const BOB: TransactionOrigin = { kind: 'user', principalId: 'user:bob' as PrincipalId };
const RELAY: TransactionOrigin = { kind: 'system', principalId: 'system' as PrincipalId };
const START = 1_770_000_000_000;
let relayNow = START;

function mount(
  store = new YjsDocumentStore(),
  options: { origin?: TransactionOrigin; canEdit?: boolean; offsetMs?: number } = {},
) {
  const play = vi.fn(() => true);
  const chime: TimerChime = { play, dispose: vi.fn() };
  const clock = { now: () => relayNow + (options.offsetMs ?? 0) };
  const view = render(
    <FacilitateCard
      source={{ store, origin: options.origin ?? ADA, serverClock: clock }}
      canEdit={options.canEdit ?? true}
      storage={{ getItem: () => null, setItem: vi.fn() }}
      createChime={() => chime}
    />,
  );
  const section = view.container.querySelector('section[aria-label="Facilitate"]');
  if (!(section instanceof HTMLElement)) throw new Error('Expected the Facilitate card');
  return { store, play, card: within(section), view };
}

function advance(ms: number): void {
  act(() => {
    relayNow += ms;
    vi.advanceTimersByTime(ms);
  });
}

function setSeconds(seconds: number): void {
  fireEvent.click(screen.getByRole('button', { name: /set the duration/ }));
  const field = screen.getByRole('textbox', { name: 'Timer duration' });
  fireEvent.change(field, { target: { value: `0:${String(seconds).padStart(2, '0')}` } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

beforeEach(() => {
  vi.useFakeTimers();
  relayNow = START;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Facilitate card acceptance', () => {
  it('shows the same second on two synced stores despite device clocks minutes apart, then syncs pause', () => {
    const ada = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    const stopAda = ada.subscribeUpdates(({ update, isLocal }) => {
      if (isLocal) bob.applyUpdate(update, RELAY);
    });
    const stopBob = bob.subscribeUpdates(({ update, isLocal }) => {
      if (isLocal) ada.applyUpdate(update, RELAY);
    });
    try {
      vi.setSystemTime(START - 180_000);
      const first = mount(ada);
      vi.setSystemTime(START + 180_000);
      const second = mount(bob, { origin: BOB, offsetMs: 400 });
      // The relay estimates agree within one second even if the devices' wall clocks do not.
      fireEvent.click(first.card.getByRole('button', { name: 'Start the timer' }));
      advance(61_000);
      const firstSeconds = first.card.getByRole('button', { name: /left/ }).textContent;
      const secondSeconds = second.card.getByRole('button', { name: /left/ }).textContent;
      expect(firstSeconds).toBe('03:59');
      expect(secondSeconds).toBe('03:59');
      fireEvent.click(second.card.getByRole('button', { name: 'Pause the timer' }));
      expect(ada.boardTimer.current?.status).toBe('paused');
      expect(bob.boardTimer.current?.status).toBe('paused');
      advance(60_000);
      expect(first.card.getByRole('button', { name: /left/ }).textContent).toBe(firstSeconds);
      expect(second.card.getByRole('button', { name: /left/ }).textContent).toBe(secondSeconds);
    } finally {
      stopAda();
      stopBob();
    }
  });

  it('keeps timer actions out of the actor’s undo history', () => {
    const { store, card } = mount();
    const history = createHistory(store, ADA.principalId);
    fireEvent.click(card.getByRole('button', { name: 'Start the timer' }));
    fireEvent.click(card.getByRole('button', { name: 'Pause the timer' }));
    fireEvent.click(card.getByRole('button', { name: 'Resume the timer' }));
    const timer = store.boardTimer.current;
    expect(timer?.updatedBy).toBe(ADA.principalId);
    expect(history.undo()).toBe(false);
    expect(store.boardTimer.current).toEqual(timer);
    fireEvent.click(card.getByRole('button', { name: 'Reset the timer' }));
    const reset = store.boardTimer.current;
    expect(history.undo()).toBe(false);
    expect(store.boardTimer.current).toEqual(reset);
    history.destroy();
  });

  it('orders keyboard stops, activates buttons with Enter and Space, and contains duration Escape', () => {
    const { card, store } = mount();
    expect(card.getAllByRole('button').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Mute the timer’s sound',
      'Collapse Facilitate',
      '05:00 left, set the duration',
      'Start the timer',
      'Reset the timer',
    ]);
    const start = card.getByRole('button', { name: 'Start the timer' });
    start.focus();
    fireEvent.keyDown(start, { key: 'Enter' });
    fireEvent.click(start);
    expect(store.boardTimer.current?.status).toBe('running');
    const pause = card.getByRole('button', { name: 'Pause the timer' });
    pause.focus();
    fireEvent.keyDown(pause, { key: ' ' });
    fireEvent.click(pause);
    expect(store.boardTimer.current?.status).toBe('paused');
    fireEvent.click(card.getByRole('button', { name: /set the duration/ }));
    const field = card.getByRole('textbox', { name: 'Timer duration' });
    fireEvent.change(field, { target: { value: 'bad' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const outsideEscape = vi.fn();
    document.addEventListener('keydown', outsideEscape);
    fireEvent.keyDown(field, { key: 'Escape', bubbles: true });
    expect(outsideEscape).not.toHaveBeenCalled();
    expect(card.queryByRole('textbox', { name: 'Timer duration' })).toBeNull();
    expect(store.boardTimer.current?.durationMs).toBe(300_000);
    document.removeEventListener('keydown', outsideEscape);
  });

  it('alerts once per observed run, but not for a late joiner or a paused or reset timer', () => {
    const first = mount();
    setSeconds(2);
    fireEvent.click(first.card.getByRole('button', { name: 'Start the timer' }));
    advance(2250);
    expect(first.card.getByText('Time’s up')).toBeTruthy();
    expect(first.play).toHaveBeenCalledTimes(1);
    advance(3000);
    expect(first.play).toHaveBeenCalledTimes(1);
    const late = mount(first.store, { origin: BOB });
    expect(late.card.queryByText('Time’s up')).toBeNull();
    expect(late.play).not.toHaveBeenCalled();
    fireEvent.click(first.card.getByRole('button', { name: 'Start the timer' }));
    advance(1000);
    fireEvent.click(first.card.getByRole('button', { name: 'Pause the timer' }));
    advance(2000);
    expect(first.play).toHaveBeenCalledTimes(1);
    fireEvent.click(first.card.getByRole('button', { name: 'Resume the timer' }));
    fireEvent.click(first.card.getByRole('button', { name: 'Reset the timer' }));
    advance(2000);
    expect(first.play).toHaveBeenCalledTimes(1);
    fireEvent.click(first.card.getByRole('button', { name: 'Start the timer' }));
    advance(2250);
    expect(first.play).toHaveBeenCalledTimes(2);
  });

  it('lets a read-only person observe, but no timer control changes the store', () => {
    const { card, store } = mount(undefined, { canEdit: false });
    const before = store.encodeState();
    for (const name of ['Start the timer', 'Reset the timer']) {
      const control = card.getByRole('button', { name });
      expect(control).toHaveProperty('disabled', true);
      fireEvent.click(control);
    }
    expect(card.getByRole('button', { name: /left/ })).toHaveProperty('disabled', true);
    expect(store.encodeState()).toEqual(before);
  });
});
