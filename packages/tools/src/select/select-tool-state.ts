import type { ObjectId } from '@canvas/schema';

import type { PressStamp } from './double-press.js';
import type { SelectCursor } from './select-cursor.js';
import type { SelectDrag } from './select-drag.js';
import type { SelectPointer } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import type { PressTarget } from './select-press.js';

/**
 * The select tool's state: `idle`, `pressing` (the primary button or a finger is down, not yet
 * dragged past `clickThresholdPx`) or `dragging` a move, a resize, a rotation or a marquee,
 * each with the cursor the tool asks for (the rotate cursor, turned to its corner, over a
 * corner's rotation band and through a rotation drag), the innermost group entered,
 * which every phase keeps, and the last click's press, for a double press. A plain value;
 * `stepSelectTool` returns a new one, or the same one when nothing about it changed.
 */
export type SelectToolState = (
  | {
      /** No button down. */
      readonly phase: 'idle';
    }
  | {
      /** The button is down and has not moved far. */
      readonly phase: 'pressing';
      /** The press. */
      readonly start: SelectPointer;
      /** What it landed on. */
      readonly target: PressTarget;
      /** The selection before the press. */
      readonly previousIds: readonly ObjectId[];
    }
  | {
      /** A drag is under way. */
      readonly phase: 'dragging';
      /** The press it started from. */
      readonly start: SelectPointer;
      /** What it does. */
      readonly drag: SelectDrag;
    }
) & {
  /** The cursor the tool asks for now; the app maps it to a CSS cursor. */
  readonly cursor: SelectCursor;
  /**
   * The innermost entered group (`entered-group.ts`), or null at the
   * board's top level: clicks and marquees act on its children, and Escape or a click on empty
   * board leaves one level.
   */
  readonly enteredGroupId: ObjectId | null;
  /** The press of the last click, while a second press could make it a double press. */
  readonly lastPress?: PressStamp;
};

/** The select tool at rest at the top level, with the default cursor. */
export const IDLE_SELECT_TOOL: SelectToolState = Object.freeze({
  phase: 'idle',
  cursor: 'default',
  enteredGroupId: null,
});

/** One step of the select tool: its next state and what it asks for. */
export interface SelectToolStep {
  /** The next state. */
  readonly state: SelectToolState;
  /** The intents, in order; often none. */
  readonly intents: readonly SelectIntent[];
}

/**
 * The tool at rest with the default cursor, keeping what a state remembers across gestures.
 * Pure.
 *
 * @param state - The state now.
 * @param lastPress - The last click's press to remember, if any.
 * @param enteredGroupId - The entered group; the state's by default.
 * @returns The idle state: {@link IDLE_SELECT_TOOL} itself when there is nothing to remember.
 */
export function idleFrom(
  state: SelectToolState,
  lastPress?: PressStamp,
  enteredGroupId: ObjectId | null = state.enteredGroupId,
): SelectToolState {
  if (enteredGroupId === null && lastPress === undefined) return IDLE_SELECT_TOOL;
  const idle = { phase: 'idle' as const, cursor: 'default' as const, enteredGroupId };
  return lastPress === undefined ? idle : { ...idle, lastPress };
}
