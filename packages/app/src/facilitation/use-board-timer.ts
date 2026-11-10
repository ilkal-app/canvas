import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  createRandomObjectId,
  runCommand,
  setBoardTimerCommand,
  SYSTEM_ORIGIN,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { timerRemainingMs, type BoardTimer, type BoardTimerAction } from '@canvas/schema';

import { hasJustRunOut } from './timer-clock.js';

/** The device clock, where the board has no relay. */
const DEVICE_CLOCK = { now: (): number => Date.now() };

/**
 * Runs one board timer action as the person (start, pause, resume, reset): the shared timer
 * every client counts, timed by the server's clock where the connection has one.
 *
 * @param source - The board's store, the person's origin and the server's clock.
 * @param action - The action.
 * @returns True when it was applied.
 */
export function runBoardTimer(source: BoardTimerSource, action: BoardTimerAction): boolean {
  const { store, origin } = source;
  const clock = source.serverClock ?? DEVICE_CLOCK;
  const actor = origin.kind === 'system' ? undefined : origin.principalId;
  const input = { action, serverNowMs: clock.now(), ...(actor === undefined ? {} : { actor }) };
  const environment = { clock: () => Date.now(), createId: createRandomObjectId };
  return (
    runCommand(store, SYSTEM_ORIGIN, setBoardTimerCommand, input, environment).status === 'applied'
  );
}

/** How often the card reads the clock while a timer runs, in ms. */
export const TIMER_TICK_MS = 250;

/** What the board timer is read from and written to. */
export interface BoardTimerSource {
  /** The board's store. */
  readonly store: DocumentStore;
  /** Who acts: a timer action names its principal as who changed the timer. */
  readonly origin: TransactionOrigin;
  /** The relay's clock as this device estimates it; the device's clock where absent. */
  readonly serverClock?: { now(): number } | undefined;
}

/** The board timer as the card shows it, and its actions. */
export interface BoardTimerState {
  /** The timer, or `undefined` for none. */
  readonly timer: BoardTimer | undefined;
  /** Its time left now by the relay's clock, in ms; `undefined` with no timer. */
  readonly remainingMs: number | undefined;
  /**
   * Runs a timer action now by the relay's clock, as the system (so it never enters the person's
   * undo history), naming the person as who acted.
   *
   * @param action - The action.
   * @returns Whether the command applied.
   */
  readonly run: (action: BoardTimerAction) => boolean;
}

/**
 * The board timer (over's store state): it follows every change of the stored
 * timer, local or remote, and while one runs with time left reads the relay's clock every
 * {@link TIMER_TICK_MS} so the time left counts down (no tick once it reaches zero); `onRunOut` is called once when a running timer it watched runs
 * out (not for one that had run out before it looked).
 *
 * @param source - The store, the person's origin and the relay's clock.
 * @param onRunOut - Called when the timer it watched runs out.
 * @returns The timer, its time left and the action runner.
 */
export function useBoardTimer(source: BoardTimerSource, onRunOut: () => void): BoardTimerState {
  const { store, origin } = source;
  const clock = source.serverClock ?? DEVICE_CLOCK;
  const subscribe = useCallback(
    (listener: () => void) => store.boardTimer.subscribe(listener),
    [store],
  );
  const timer = useSyncExternalStore(subscribe, () => store.boardTimer.current);
  const [now, setNow] = useState(() => clock.now());
  // Ticks only while time is left: a run that reached zero stays stored as running, still.
  const isCounting = timer?.status === 'running' && timerRemainingMs(timer, now) > 0;
  useEffect(() => {
    setNow(clock.now());
    if (!isCounting) return undefined;
    const tick = setInterval(() => {
      setNow(clock.now());
    }, TIMER_TICK_MS);
    return () => {
      clearInterval(tick);
    };
  }, [clock, isCounting, timer]);
  const seen = useRef<{ readonly timer: BoardTimer | undefined; readonly at: number }>({
    timer,
    at: now,
  });
  const onRunOutRef = useRef(onRunOut);
  onRunOutRef.current = onRunOut;
  useEffect(() => {
    if (hasJustRunOut(seen.current.timer, seen.current.at, timer, now)) onRunOutRef.current();
    seen.current = { timer, at: now };
  }, [timer, now]);
  const run = useCallback(
    (action: BoardTimerAction): boolean =>
      runBoardTimer({ store, origin, serverClock: clock }, action),
    [store, origin, clock],
  );
  return {
    timer,
    remainingMs: timer === undefined ? undefined : timerRemainingMs(timer, now),
    run,
  };
}
