import type { ObjectId } from '../ids/object-id.js';
import type { PrincipalId } from '../ids/principal-id.js';

import { timerRemainingMs, type BoardTimer } from './board-timer.js';

/**
 * What a person does to the board timer: `start` (from its whole duration, replacing
 * any timer), `pause`, `resume`, `reset` (back to idle at its duration), `set-duration` (idle at
 * a new duration) and `end` (no timer).
 */
export type BoardTimerAction =
  | {
      /** Start from the whole duration, replacing any timer. */
      readonly kind: 'start';
      /** The duration, in ms. */
      readonly durationMs: number;
      /** The section it is for; none or null for the board. */
      readonly sectionId?: ObjectId | null | undefined;
    }
  | {
      /** Pause a running timer. */
      readonly kind: 'pause';
    }
  | {
      /** Resume a paused timer. */
      readonly kind: 'resume';
    }
  | {
      /** Back to idle at its duration. */
      readonly kind: 'reset';
    }
  | {
      /** Idle at a new duration. */
      readonly kind: 'set-duration';
      /** The new duration, in ms. */
      readonly durationMs: number;
    }
  | {
      /** No timer. */
      readonly kind: 'end';
    };

/** The kinds of {@link BoardTimerAction}. */
export type BoardTimerActionKind = BoardTimerAction['kind'];

/**
 * The timer after an action, at a moment by the relay's clock. Pure: the input is never changed.
 * An action that does not apply leaves the timer as it is (the same object): pausing a timer
 * that is not running or has run out, resuming one that is not paused or has nothing left, and
 * anything but `start` or `end` with no timer. The result is not validated: a caller writes it
 * through `boardTimerSchema`, which refuses an out-of-range duration.
 *
 * @param timer - The timer, or `undefined` for none.
 * @param action - The action.
 * @param serverNowMs - The moment, by the relay's clock (ms since the epoch, rounded down).
 * @param by - Who acts.
 * @returns The timer after the action, or `undefined` for none.
 */
export function applyTimerAction(
  timer: BoardTimer | undefined,
  action: BoardTimerAction,
  serverNowMs: number,
  by: PrincipalId,
): BoardTimer | undefined {
  const now = Math.floor(serverNowMs);
  switch (action.kind) {
    case 'start':
      return {
        status: 'running',
        durationMs: action.durationMs,
        remainingMs: action.durationMs,
        startedAt: now,
        sectionId: action.sectionId ?? null,
        updatedBy: by,
      };
    case 'end':
      return undefined;
    default:
      break;
  }
  if (timer === undefined) return undefined;
  const { durationMs, sectionId } = timer;
  switch (action.kind) {
    case 'pause': {
      const remainingMs = timerRemainingMs(timer, now);
      if (timer.status !== 'running' || remainingMs === 0) return timer;
      return { status: 'paused', durationMs, remainingMs, sectionId, updatedBy: by };
    }
    case 'resume':
      if (timer.status !== 'paused' || timer.remainingMs === 0) return timer;
      return {
        status: 'running',
        durationMs,
        remainingMs: timer.remainingMs,
        startedAt: now,
        sectionId,
        updatedBy: by,
      };
    case 'reset':
      return { status: 'idle', durationMs, sectionId, updatedBy: by };
    case 'set-duration':
      return { status: 'idle', durationMs: action.durationMs, sectionId, updatedBy: by };
  }
}
