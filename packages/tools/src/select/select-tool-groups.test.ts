import { describe, expect, it } from 'vitest';

import type { HitRectMode, WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import { contextFor, pointer, run } from './__fixtures__/select-tool-steps.js';
import type { PointHit, SelectHitTester } from './select-hit-tester.js';
import type { SelectInput } from './select-input.js';
import { DOUBLE_PRESS_INTERVAL_MS, IDLE_SELECT_TOOL, type SelectToolState } from './select-tool.js';
import { selectionOf } from './selection-state.js';

// The select tool's group rules: double presses emit `activate` (the controller enters
// a group with it), presses and marquees act at the entered level, and Escape or a click on
// empty board leaves one level.

const G = 'group-g' as ObjectId;
const H = 'group-h' as ObjectId;
const D = 'rect-d' as ObjectId;

/** What the recording hit tester was asked, and with which entered group. */
interface Asked {
  readonly points: (ObjectId | null | undefined)[];
  readonly rects: (ObjectId | null | undefined)[];
}

/**
 * A hit tester over one grouped object at (0, 0)–(100, 50): the select target is group-g at
 * the top level, rect-d once group-g is entered; everything else is empty board. It records
 * the entered group it is asked with.
 *
 * @returns The hit tester and what it was asked.
 */
function recordingHitTester(): { hitTester: SelectHitTester; asked: Asked } {
  const asked: Asked = { points: [], rects: [] };
  const hitTester: SelectHitTester = {
    isAboveSelection: () => false,
    hitPoint: ({ x, y }: Point, zoom: number, enteredGroupId?: ObjectId | null) => {
      expect(zoom).toBe(1);
      asked.points.push(enteredGroupId);
      if (x < 0 || x > 100 || y < 0 || y > 50) return undefined;
      const hit: PointHit =
        enteredGroupId === G || enteredGroupId === H
          ? { id: D, part: 'object', scope: G }
          : { id: G, part: 'object', scope: null };
      return hit;
    },
    hitRect: (rect: WorldBounds, mode: HitRectMode, enteredGroupId?: ObjectId | null) => {
      expect(rect.minX).toBeLessThanOrEqual(rect.maxX);
      expect(mode).toMatch(/^(intersect|contain)$/);
      asked.rects.push(enteredGroupId);
      return enteredGroupId === G ? [D] : [G];
    },
    frameAt: () => undefined,
  };
  return { hitTester, asked };
}

/**
 * A timed pointer input at a world point, the camera at the origin at 100% (screen = world).
 *
 * @param kind - Down, move or up.
 * @param point - The point.
 * @param timeStamp - When, ms.
 * @returns The input.
 */
function timed(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
  timeStamp: number,
): SelectInput {
  return {
    kind,
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
    timeStamp,
  };
}

/**
 * A click: a press and a release at one point and time.
 *
 * @param point - The point.
 * @param timeStamp - When, ms.
 * @returns The two inputs.
 */
function click(point: Point, timeStamp: number): SelectInput[] {
  return [timed('pointerDown', point, timeStamp), timed('pointerUp', point, timeStamp + 60)];
}

/** The tool at rest inside group-g. */
const INSIDE_G: SelectToolState = { ...IDLE_SELECT_TOOL, enteredGroupId: G };

describe('select tool: double presses', () => {
  it('asks to activate the target of a second press within the interval and distance', () => {
    const { hitTester } = recordingHitTester();
    const context = contextFor(selectionOf([G]), undefined, { hitTester });
    const { intents } = run(
      [...click({ x: 10, y: 10 }, 1000), ...click({ x: 12, y: 11 }, 1250)],
      context,
    );
    expect(intents).toEqual([
      { type: 'select', ids: [G] },
      { type: 'activate', id: G, world: { x: 12, y: 11 } },
    ]);
  });

  it('does not activate on presses too far apart in time or space, or without timestamps', () => {
    const { hitTester } = recordingHitTester();
    const context = contextFor(selectionOf([G]), undefined, { hitTester });
    const late = 1000 + DOUBLE_PRESS_INTERVAL_MS + 1;
    const slow = run([...click({ x: 10, y: 10 }, 1000), ...click({ x: 10, y: 10 }, late)], context);
    const far = run([...click({ x: 10, y: 10 }, 1000), ...click({ x: 15, y: 10 }, 1100)], context);
    const untimed = run(
      [
        pointer('pointerDown', { x: 10, y: 10 }),
        pointer('pointerUp', { x: 10, y: 10 }),
        pointer('pointerDown', { x: 10, y: 10 }),
        pointer('pointerUp', { x: 10, y: 10 }),
      ],
      context,
    );
    for (const { intents } of [slow, far, untimed]) {
      expect(intents.some((intent) => intent.type === 'activate')).toBe(false);
    }
  });

  it('activates once for a triple press, and not after a drag', () => {
    const { hitTester } = recordingHitTester();
    const context = contextFor(selectionOf([G]), undefined, { hitTester });
    const triple = run(
      [
        ...click({ x: 10, y: 10 }, 1000),
        ...click({ x: 10, y: 10 }, 1100),
        ...click({ x: 10, y: 10 }, 1200),
      ],
      context,
    );
    expect(triple.intents.filter((intent) => intent.type === 'activate')).toHaveLength(1);
    const dragged = run(
      [
        timed('pointerDown', { x: 10, y: 10 }, 1000),
        timed('pointerMove', { x: 40, y: 10 }, 1010),
        timed('pointerUp', { x: 40, y: 10 }, 1020),
        ...click({ x: 40, y: 10 }, 1100),
      ],
      context,
    );
    expect(dragged.intents.some((intent) => intent.type === 'activate')).toBe(false);
  });
});

describe('select tool: double presses on different objects', () => {
  it('does not activate when the second press lands on another object, or the first on none', () => {
    const [left, right] = ['left', 'right'] as ObjectId[];
    const hitTester: SelectHitTester = {
      isAboveSelection: () => false,
      hitPoint: ({ x, y }) =>
        y < 0 || y > 50 || x > 100
          ? undefined
          : { id: x < 50 ? (left ?? G) : (right ?? G), part: 'object', scope: null },
      hitRect: () => [],
      frameAt: () => undefined,
    };
    const context = contextFor(undefined, undefined, { hitTester });
    const across = run(
      [...click({ x: 48, y: 10 }, 1000), ...click({ x: 51, y: 10 }, 1100)],
      context,
    );
    expect(across.intents.some((intent) => intent.type === 'activate')).toBe(false);
    const fromEmpty = run(
      [...click({ x: 102, y: 10 }, 1000), ...click({ x: 99, y: 10 }, 1100)],
      context,
    );
    expect(fromEmpty.intents.some((intent) => intent.type === 'activate')).toBe(false);
  });
});

describe('select tool: the entered group', () => {
  it('hit tests at the entered level and takes the level of what a press lands on', () => {
    const { hitTester, asked } = recordingHitTester();
    const context = contextFor(undefined, undefined, { hitTester, outerGroupId: null });
    const { state, intents } = run(click({ x: 10, y: 10 }, 1000), context, {
      ...INSIDE_G,
      enteredGroupId: H,
    });
    expect(asked.points).toEqual([H]);
    expect(intents).toEqual([{ type: 'select', ids: [D] }]);
    // rect-d sits in group-g, so the press left group-h for group-g.
    expect(state.enteredGroupId).toBe(G);
  });

  it('leaves one level on a click on empty board, clearing the selection', () => {
    const { hitTester } = recordingHitTester();
    const context = contextFor(selectionOf([D]), undefined, { hitTester, outerGroupId: G });
    const { state, intents } = run(click({ x: 500, y: 500 }, 1000), context, {
      ...INSIDE_G,
      enteredGroupId: H,
    });
    expect(intents).toEqual([{ type: 'select', ids: [] }]);
    expect(state.enteredGroupId).toBe(G);
  });

  it('leaves one level on Escape at rest, selecting the group it leaves', () => {
    const { hitTester } = recordingHitTester();
    const context = contextFor(selectionOf([D]), undefined, { hitTester, outerGroupId: null });
    const { state, intents } = run([{ kind: 'escape' }], context, INSIDE_G);
    expect(intents).toEqual([{ type: 'select', ids: [G] }]);
    expect(state).toEqual(IDLE_SELECT_TOOL);
    const again = run([{ kind: 'escape' }], contextFor(selectionOf([G])), state);
    expect(again.intents).toEqual([{ type: 'select', ids: [] }]);
  });

  it('marquees at the entered level', () => {
    const { hitTester, asked } = recordingHitTester();
    const context = contextFor(undefined, undefined, { hitTester });
    const { intents } = run(
      [
        timed('pointerDown', { x: 300, y: 300 }, 1000),
        timed('pointerMove', { x: -10, y: -10 }, 1010),
        timed('pointerUp', { x: -10, y: -10 }, 1020),
      ],
      context,
      INSIDE_G,
    );
    expect(asked.rects).toEqual([G, G]);
    expect(intents.filter((intent) => intent.type === 'marquee').at(-1)).toMatchObject({
      ids: [D],
    });
  });

  it('keeps the entered group through hovers, drags and cancels', () => {
    const { hitTester } = recordingHitTester();
    const context = contextFor(selectionOf([D]), undefined, { hitTester, outerGroupId: null });
    const { state } = run(
      [
        timed('pointerMove', { x: 400, y: 400 }, 900),
        timed('pointerDown', { x: 10, y: 10 }, 1000),
        timed('pointerMove', { x: 40, y: 10 }, 1010),
        { kind: 'pointerCancel' },
        timed('pointerMove', { x: 400, y: 400 }, 1100),
      ],
      context,
      INSIDE_G,
    );
    expect(state.enteredGroupId).toBe(G);
  });
});
