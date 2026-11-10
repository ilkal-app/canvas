import type { ScreenPoint } from '../camera/camera-moves.js';

import { isPastClickThreshold } from './click-threshold.js';
import type { SelectPointer } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import { resolvePress, type PressTarget, type SelectToolContext } from './select-press.js';
import { idleFrom, type SelectToolState, type SelectToolStep } from './select-tool-state.js';
import { isLongPress } from './touch-gestures.js';

/**
 * What opening the context menu on a press target does: a press on empty board clears the
 * selection first (unless Shift), so the menu offers what the board offers (paste); anywhere
 * else the selection stays as the press left it.
 *
 * @param target - What the press landed on.
 * @param pointer - Where the menu opens.
 * @returns The intents, the menu last.
 */
function contextMenuIntents(target: PressTarget, pointer: SelectPointer): SelectIntent[] {
  const menu: SelectIntent = {
    type: 'contextMenu',
    screen: pointer.screen,
    world: pointer.world,
    ...(pointer.pointerType === 'touch' ? { isTouch: true } : {}),
  };
  // The clear, not a double-tap's zoom, which the second tap of one carries as its click.
  return target.kind === 'empty' && target.onClick?.type === 'select'
    ? [target.onClick, menu]
    : [menu];
}

/**
 * A secondary click: at rest it resolves like a press
 * (an unselected object is selected; empty board clears the selection) and opens the menu
 * there; during a press (a Control-click on a Mac, whose primary press came first) it ends the
 * press without a click and opens the menu for what the press landed on. Mid-drag, nothing.
 * Pure.
 *
 * @param state - The state now.
 * @param pointer - The secondary click.
 * @param context - The selection, its frame, the zoom and the hit tester.
 * @returns The step.
 */
export function onContextPress(
  state: SelectToolState,
  pointer: SelectPointer,
  context: SelectToolContext,
): SelectToolStep {
  if (state.phase === 'pressing') {
    return { state: idleFrom(state), intents: contextMenuIntents(state.target, pointer) };
  }
  if (state.phase !== 'idle') return { state, intents: [] };
  const { target, intents } = resolvePress(pointer, context, state.enteredGroupId);
  return { state, intents: [...intents, ...contextMenuIntents(target, pointer)] };
}

/**
 * Time passing with a finger down: a touch
 * press held `LONG_PRESS_MS` (by its `timeStamp`) that has not wandered `LONG_PRESS_SLOP_PX`
 * from where it landed (it would be dragging otherwise, or, on the inert count badge, would
 * have wandered off) opens the context menu at the finger. The tool is then at rest: the rest
 * of that finger is no gesture (the app's binding ignores it until it lifts, and at rest a
 * release clicks nothing), and the menu's entries run at once. Pure.
 *
 * @param state - The state now.
 * @param timeStamp - The time now, ms, on the press's clock.
 * @param screen - Where the finger is now, CSS px on the viewport.
 * @returns The step.
 */
export function onHold(
  state: SelectToolState,
  timeStamp: number,
  screen: ScreenPoint,
): SelectToolStep {
  if (state.phase !== 'pressing' || state.start.pointerType !== 'touch') {
    return { state, intents: [] };
  }
  const { start } = state;
  if (!isLongPress(start.timeStamp ?? 0, timeStamp) || isPastClickThreshold(start, screen)) {
    return { state, intents: [] };
  }
  return { state: idleFrom(state), intents: contextMenuIntents(state.target, start) };
}
