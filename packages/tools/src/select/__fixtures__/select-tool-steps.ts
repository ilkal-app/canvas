// The select tool's state machine driven step by step, for its tests: a fake hit tester over
// two objects and a frame, contexts, pointer inputs and a runner that collects intents.
import type { HitRectMode, WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { OrientedBox } from '../oriented-box.js';
import type { SelectHitTester } from '../select-hit-tester.js';
import type { SelectInput } from '../select-input.js';
import type { SelectIntent } from '../select-intent.js';
import {
  IDLE_SELECT_TOOL,
  stepSelectTool,
  type SelectToolContext,
  type SelectToolState,
} from '../select-tool.js';
import { EMPTY_SELECTION, type SelectionState } from '../selection-state.js';

/** Object a (see {@link HIT_TESTER}). */
export const A = 'a' as ObjectId;
/** Object b. */
export const B = 'b' as ObjectId;
/** Object c, which only marquees find. */
export const C = 'c' as ObjectId;
/** Frame f (see {@link HIT_TESTER}). */
export const F = 'f' as ObjectId;
/** One degree, radians. */
export const DEGREE = Math.PI / 180;

/**
 * Object a covers (0, 0)–(100, 50) and b covers (200, 0)–(300, 50); frame f covers
 * (400, 100)–(600, 300), with its title band (400, 76)–(600, 100) above it, and takes objects
 * dropped there; c is found by marquees.
 */
export const HIT_TESTER: SelectHitTester = {
  isAboveSelection: () => false,
  hitPoint: ({ x, y }) => {
    if (x >= 400 && x <= 600 && y >= 76 && y <= 300) {
      return { id: F, part: y < 100 ? 'title' : 'background', scope: null };
    }
    if (y < 0 || y > 50) return undefined;
    if (x >= 0 && x <= 100) return { id: A, part: 'object', scope: null };
    if (x >= 200 && x <= 300) return { id: B, part: 'object', scope: null };
    return undefined;
  },
  hitRect: (rect: WorldBounds, mode: HitRectMode) =>
    mode === 'intersect' && rect.maxX >= 200 ? [B, C] : [C],
  frameAt: ({ x, y }, isEligible) =>
    x >= 400 && x <= 600 && y >= 100 && y <= 300 && isEligible(F) ? F : undefined,
};

/** The frame of object a alone. */
export const FRAME_A: OrientedBox = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
/** The frame of objects a and b together. */
export const FRAME_AB: OrientedBox = { x: 0, y: 0, width: 300, height: 50, rotation: 0 };

/**
 * A context at 100% with the fake hit tester.
 *
 * @param selection - The selection; empty by default.
 * @param frame - Its frame; none by default.
 * @param overrides - Other fields to replace.
 * @returns The context.
 */
export function contextFor(
  selection: SelectionState = EMPTY_SELECTION,
  frame?: OrientedBox,
  overrides: Partial<SelectToolContext> = {},
): SelectToolContext {
  return {
    zoom: 1,
    selection,
    frame,
    canResize: true,
    isLocked: false,
    hitTester: HIT_TESTER,
    ...overrides,
  };
}

/**
 * A pointer input at a world point, the camera at the origin at 100% (screen = world).
 *
 * @param kind - Down, move or up.
 * @param point - The point, world units and CSS px alike.
 * @param isShiftPressed - Whether Shift is held.
 * @param isModPressed - Whether mod (⌘ or Control) is held.
 * @returns The input.
 */
export function pointer(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
  isShiftPressed = false,
  isModPressed = false,
): SelectInput {
  return { kind, screen: point, world: point, isShiftPressed, isModPressed };
}

/**
 * Feeds inputs to the machine with a fixed context, collecting every intent.
 *
 * @param inputs - The inputs, in order.
 * @param context - The context for every step.
 * @param start - The state to start from.
 * @returns The final state and all intents.
 */
export function run(
  inputs: readonly SelectInput[],
  context: SelectToolContext,
  start: SelectToolState = IDLE_SELECT_TOOL,
): { state: SelectToolState; intents: SelectIntent[] } {
  let state = start;
  const intents: SelectIntent[] = [];
  for (const input of inputs) {
    const step = stepSelectTool(state, input, context);
    state = step.state;
    intents.push(...step.intents);
  }
  return { state, intents };
}
