import type { Point } from '@canvas/schema';

import { isPastClickThreshold } from './click-threshold.js';
import { onContextPress, onHold } from './context-menu-steps.js';
import { isDoublePress, stampOf } from './double-press.js';
import { boxCentreOf } from './oriented-box.js';
import { cursorOfDrag, cursorOfTarget, hoverCursorAt } from './select-cursor.js';
import { beginDrag, dragIntent, type SelectDrag } from './select-drag.js';
import type { NudgeDirection, SelectInput, SelectPointer } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import { resolvePress, type PressTarget, type SelectToolContext } from './select-press.js';
import {
  IDLE_SELECT_TOOL,
  idleFrom,
  type SelectToolState,
  type SelectToolStep,
} from './select-tool-state.js';

export type { SelectToolContext } from './select-press.js';
export { CLICK_THRESHOLD_PX, clickThresholdPx } from './click-threshold.js';
export {
  DOUBLE_PRESS_DISTANCE_PX,
  DOUBLE_PRESS_INTERVAL_MS,
  type PressStamp,
} from './double-press.js';
export {
  IDLE_SELECT_TOOL,
  type SelectToolState,
  type SelectToolStep,
} from './select-tool-state.js';

/** How far an arrow key nudges the selection, world units. */
export const NUDGE_DISTANCE = 1;

/** How far Shift and an arrow key nudge the selection, world units. */
export const NUDGE_LARGE_DISTANCE = 10;

const NUDGE_VECTORS: Readonly<Record<NudgeDirection, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * The tool at rest with the pointer at a point: over a rotation band it asks for the rotate
 * cursor, turned to its corner, else the default. The controller also calls it to bring a
 * resting cursor up to date when the frame or the camera changes under a still pointer. Pure;
 * asks no hit tester; allocates nothing while the cursor keeps its orientation step.
 *
 * @param point - The pointer, world units.
 * @param context - The frame, the zoom, whether the selection can be resized or is locked, the
 *   selection and the view (the count badge hides the controls under it).
 * @param previous - The state now: returned as it is when it is idle with the same cursor.
 * @returns The idle state: {@link IDLE_SELECT_TOOL}, or one with the rotate cursor.
 */
export function restingSelectTool(
  point: Point,
  context: Pick<
    SelectToolContext,
    'frame' | 'zoom' | 'canResize' | 'isLocked' | 'hasFrameControls' | 'selection' | 'visible'
  >,
  previous: SelectToolState = IDLE_SELECT_TOOL,
): SelectToolState {
  const cursor = hoverCursorAt(point, context, previous.cursor);
  if (previous.phase === 'idle' && previous.cursor === cursor) return previous;
  const idle = idleFrom(previous, previous.phase === 'idle' ? previous.lastPress : undefined);
  return cursor === 'default' ? idle : { ...idle, cursor };
}

/**
 * The drag a press starts past the click threshold: a finger's on empty board (or a frame's
 * background) pans the view (on a tablet one finger moves around the board, as two do);
 * a mouse's or a pen's draws a marquee there; anything else as `beginDrag` decides.
 *
 * @param state - The pressing state.
 * @returns The drag.
 */
function dragFrom(state: Extract<SelectToolState, { readonly phase: 'pressing' }>): SelectDrag {
  const { target, start } = state;
  if (target.kind === 'empty' && start.pointerType === 'touch') {
    return { kind: 'pan', last: start.screen };
  }
  return beginDrag(target, start.isShiftPressed, state.previousIds, state.enteredGroupId);
}

function onPointerMove(
  state: SelectToolState,
  pointer: SelectPointer,
  context: SelectToolContext,
): SelectToolStep {
  if (state.phase === 'idle')
    return { state: restingSelectTool(pointer.world, context, state), intents: [] };
  if (state.phase === 'dragging' && state.drag.kind === 'pan') {
    // A pan reports the finger's movement since the last move, and remembers where it is now.
    const drag = { kind: 'pan' as const, last: pointer.screen };
    const intent = dragIntent(state.drag, state.start.world, pointer, context);
    return { state: { ...state, drag }, intents: [intent] };
  }
  if (state.phase === 'dragging') {
    const cursor = cursorOfDrag(state.drag, state.start.world, pointer.world, state.cursor);
    return {
      state: cursor === state.cursor ? state : { ...state, cursor },
      intents: [dragIntent(state.drag, state.start.world, pointer, context)],
    };
  }
  // A press on the count badge is inert: no drag starts from it.
  if (state.target.kind === 'badge' || !isPastClickThreshold(state.start, pointer.screen)) {
    return { state, intents: [] };
  }
  const { enteredGroupId } = state;
  const drag = dragFrom(state);
  const cursor = cursorOfDrag(drag, state.start.world, pointer.world, state.cursor);
  const dragging = { phase: 'dragging' as const, start: state.start, drag, cursor, enteredGroupId };
  if (drag.kind === 'pan') return onPointerMove(dragging, pointer, context);
  return { state: dragging, intents: [dragIntent(drag, state.start.world, pointer, context)] };
}

function onPointerUp(
  state: SelectToolState,
  pointer: SelectPointer,
  context: SelectToolContext,
): SelectToolStep {
  if (state.phase === 'idle') return { state, intents: [] };
  const idle = restingSelectTool(pointer.world, context, state);
  if (state.phase === 'dragging' && state.drag.kind === 'pan') {
    // A pan selects nothing and writes nothing: only the finger's last stretch, if it moved.
    const { last } = state.drag;
    const isStill = pointer.screen.x === last.x && pointer.screen.y === last.y;
    const intent = dragIntent(state.drag, state.start.world, pointer, context);
    return { state: idle, intents: isStill ? [] : [intent] };
  }
  if (state.phase === 'dragging') {
    const last = dragIntent(state.drag, state.start.world, pointer, context);
    return { state: idle, intents: [last, { type: 'commit' }] };
  }
  const { target } = state;
  const click = 'onClick' in target ? target.onClick : undefined;
  // A click on empty board (its clear; not Shift's, nor a double-tap's zoom) leaves the entered
  // group for the one above it.
  const isLeaving = target.kind === 'empty' && target.onClick?.type === 'select';
  const enteredGroupId = isLeaving ? (context.outerGroupId ?? null) : state.enteredGroupId;
  const rest = idleFrom(idle, state.lastPress, enteredGroupId);
  const clicked = rest.cursor === idle.cursor ? rest : { ...rest, cursor: idle.cursor };
  return { state: clicked, intents: click ? [click] : [] };
}

/**
 * What the second press of a double press does instead of its click. It is decided on the release,
 * for every pointer: the second press carries `activate` (with the pointer type, so the controller
 * can tell a finger's double-tap) or, on empty board, `doubleTap` as its click, which comes only
 * if the pointer lifts without dragging past the dead zone (or, for a finger, being held into a
 * long-press); that press neither narrows or clears the selection nor leaves a group. A second
 * press that drags is a drag: clicking a shape and at once dragging it moves it, rather
 * than opening its label's editor under the pointer.
 *
 * @param target - What the second press landed on.
 * @param press - The second press.
 * @param context - The selection, which the zoom fits unless it is empty.
 * @returns The target, its click replaced, and the intents at the press.
 */
function asDoublePress(
  target: PressTarget,
  press: SelectPointer,
  context: SelectToolContext,
): { readonly target: PressTarget; readonly intents: readonly SelectIntent[] } {
  if (target.kind === 'empty') {
    const fit = context.selection.ids.length > 0 ? 'selection' : 'board';
    return { target: { ...target, onClick: { type: 'doubleTap', fit } }, intents: [] };
  }
  if (target.kind !== 'object') return { target, intents: [] };
  const { pointerType } = press;
  const activate: SelectIntent = {
    type: 'activate',
    id: target.id,
    world: press.world,
    ...(pointerType === undefined ? {} : { pointerType }),
  };
  // Decided on the second release: a second press that drags or is held is a drag or a
  // long-press, not an activation.
  return { target: { ...target, onClick: activate }, intents: [] };
}

/**
 * A primary press at rest: resolves what it lands on (`resolvePress`, at the entered level),
 * takes the tool to the level of the object it lands on, and, when it is the second press of a
 * double press (`isDoublePress`: 4 CSS px for a mouse or a pen, 32 for a finger, 400 ms for
 * both), acts as one instead of as a click (`asDoublePress`).
 *
 * @param state - The state now, at rest.
 * @param press - The press.
 * @param context - The zoom, the selection, its frame, and the hit tester.
 * @returns The pressing state and the intents.
 */
function onPointerDown(
  state: SelectToolState,
  press: SelectPointer,
  context: SelectToolContext,
): SelectToolStep {
  const resolution = resolvePress(press, context, state.enteredGroupId);
  const enteredGroupId =
    resolution.enteredGroupId === undefined ? state.enteredGroupId : resolution.enteredGroupId;
  const previousIds = context.selection.ids;
  const pressed = resolution.target;
  // Presses on objects are remembered, and a finger's on empty board (null), for a double-tap.
  const isTouchOnBoard = pressed.kind === 'empty' && press.pointerType === 'touch';
  const pressedId = pressed.kind === 'object' ? pressed.id : isTouchOnBoard ? null : undefined;
  const isDouble = pressedId !== undefined && isDoublePress(state.lastPress, press, pressedId);
  const double = isDouble
    ? asDoublePress(pressed, press, context)
    : { target: pressed, intents: [] };
  const { target } = double;
  const intents = [...resolution.intents, ...double.intents];
  const cursor = cursorOfTarget(target, state.cursor);
  const pressing = { phase: 'pressing' as const, start: press, target, previousIds, cursor };
  // A press is remembered until it is released as a click (`onPointerUp`); the second press of
  // a double press starts afresh, so a third is not another double.
  const stamp = isDouble || pressedId === undefined ? undefined : stampOf(press, pressedId);
  return {
    state:
      stamp === undefined
        ? { ...pressing, enteredGroupId }
        : { ...pressing, enteredGroupId, lastPress: stamp },
    intents,
  };
}

/**
 * Enter at rest with exactly one object selected: activates it at the selection frame's centre.
 *
 * @param state - The state now.
 * @param context - The selection and its frame.
 * @returns The step.
 */
function onEnter(state: SelectToolState, context: SelectToolContext): SelectToolStep {
  const [id] = context.selection.ids;
  const { frame } = context;
  if (state.phase !== 'idle' || context.selection.ids.length !== 1 || !id || !frame) {
    return { state, intents: [] };
  }
  return {
    state,
    intents: [{ type: 'activate', id, world: boxCentreOf(frame), source: 'enter' }],
  };
}

function onAbandon(
  state: SelectToolState,
  context: SelectToolContext,
  isEscape: boolean,
): SelectToolStep {
  // A pan has nothing to undo: the view stays where the finger left it.
  if (state.phase === 'dragging' && state.drag.kind === 'pan') {
    return { state: idleFrom(state), intents: [] };
  }
  if (state.phase === 'dragging') {
    const restore: SelectIntent[] =
      state.drag.kind === 'marquee' ? [{ type: 'select', ids: state.drag.previousIds }] : [];
    return { state: idleFrom(state), intents: [...restore, { type: 'cancel' as const }] };
  }
  if (state.phase === 'pressing' && !isEscape && state.start.pointerType === 'touch') {
    // Two fingers landing are a pan or a pinch, not a press on what the first one touched.
    return { state: idleFrom(state), intents: [{ type: 'select', ids: state.previousIds }] };
  }
  if (state.phase === 'pressing' || !isEscape) return { state: idleFrom(state), intents: [] };
  // Escape at rest inside a group leaves one level, selecting the group it leaves.
  const { enteredGroupId } = state;
  if (enteredGroupId !== null) {
    return {
      state: idleFrom(state, undefined, context.outerGroupId ?? null),
      intents: [{ type: 'select' as const, ids: [enteredGroupId] }],
    };
  }
  if (context.selection.ids.length === 0) return { state: idleFrom(state), intents: [] };
  return { state: idleFrom(state), intents: [{ type: 'select' as const, ids: [] }] };
}

/**
 * The select tool: a pure state machine over normalised pointer and
 * keyboard input, `idle → pressing → dragging (move | resize | rotate | marquee | pan) → idle`, that
 * emits intents and never touches the document. A press resolves resize handles before the
 * rotation bands outside the frame's corners before objects before empty space
 * (`resolvePress`); a click selects, shift-click toggles, a click on empty board clears; a drag
 * past `clickThresholdPx` moves, resizes, rotates or draws a marquee,
 * emitting its intent on every move and `commit` on release, or `cancel` on Escape or a lost
 * pointer (a second finger, for touch); Escape at rest clears the selection; one finger drives
 * the tool as the mouse does, with finger-sized handles and bands, except that its drag from
 * empty board pans the view (`pan`), with no `commit` or `cancel`; a double press
 * activates the object pressed, and a finger's double-tap on empty board asks for a zoom (`doubleTap`);
 * a touch press held `LONG_PRESS_MS` in place, or a secondary click, opens the context menu;
 * an arrow key nudges it by
 * {@link NUDGE_DISTANCE} ({@link NUDGE_LARGE_DISTANCE} with Shift). A move with no button down
 * (hover) only updates the state's cursor: the rotate cursor over a rotation band, turned to the
 * band's corner and the frame's rotation, and turned with the selection through a rotation drag. A
 * second press on an object soon after a click on it (`isDoublePress`), released without passing
 * the dead zone, or Enter with one object selected at rest, emits `activate`; a second press that
 * drags moves the object. The caller applies the intents and passes the updated selection and
 * frame with the next input.
 *
 * @param state - The state now; not changed.
 * @param input - The input.
 * @param context - The zoom, the selection, its frame, and the hit tester.
 * @returns The next state and the intents.
 */
export function stepSelectTool(
  state: SelectToolState,
  input: SelectInput,
  context: SelectToolContext,
): SelectToolStep {
  switch (input.kind) {
    case 'pointerDown':
      if (state.phase !== 'idle') return { state, intents: [] };
      return onPointerDown(state, input, context);
    case 'pointerMove':
      return onPointerMove(state, input, context);
    case 'pointerUp': {
      if (state.phase !== 'pressing') return onPointerUp(state, input, context);
      // A fast release may be the first report past the dead zone. Give it the
      // same drag transition as a move before deciding whether to click or commit; a pan's
      // stretch is the move's to report, since its release reports only what moved after it.
      const moved = onPointerMove(state, input, context);
      const released = onPointerUp(moved.state, input, context);
      const isPan = moved.state.phase === 'dragging' && moved.state.drag.kind === 'pan';
      return isPan ? { ...released, intents: [...moved.intents, ...released.intents] } : released;
    }
    case 'contextPress':
      return onContextPress(state, input, context);
    case 'hold':
      return onHold(state, input.timeStamp, input.screen);
    case 'pointerCancel':
      return onAbandon(state, context, false);
    case 'escape':
      return onAbandon(state, context, true);
    case 'enter':
      return onEnter(state, context);
    case 'nudge': {
      if (state.phase !== 'idle' || context.selection.ids.length === 0)
        return { state, intents: [] };
      const { x, y } = NUDGE_VECTORS[input.direction];
      const distance = input.isLarge ? NUDGE_LARGE_DISTANCE : NUDGE_DISTANCE;
      return { state, intents: [{ type: 'nudge', delta: { x: x * distance, y: y * distance } }] };
    }
  }
}
