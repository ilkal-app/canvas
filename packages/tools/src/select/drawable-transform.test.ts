// Transforms of a selection that holds an object the engine does not draw: every
// transform leaves it out, so the command moves the rest instead of being refused whole; Delete
// still takes it.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { arrangeFrameOf } from '../arrange/arrange-frame.js';
import { planArrange } from '../arrange/arrange-plan.js';

import { id, mapSource, selectBoardObjects } from './__fixtures__/select-board.js';
import type { OrientedBox } from './oriented-box.js';
import { resizeAspectOf } from './resize-aspect.js';
import type { SelectIntent } from './select-intent.js';
import { isResizable, transformableIds, type SelectionSource } from './selection-geometry.js';
import { planTransform, type TransformPlan } from './transform-plan.js';

const DRAWN = id('rect-a');
const UNDRAWN = id('rect-c');
const SELECTED = [DRAWN, UNDRAWN];
const FRAME: OrientedBox = { x: 0, y: 0, width: 440, height: 70, rotation: 0 };

/**
 * The select board with rect-c held undrawable by the gate, as the app reads it.
 *
 * @returns The source.
 */
function gatedSource(): SelectionSource {
  return { ...mapSource(selectBoardObjects()), isDrawable: (key: ObjectId) => key !== UNDRAWN };
}

/**
 * The ids a plan changes.
 *
 * @param plan - The plan.
 * @returns The ids.
 */
function idsOf(plan: TransformPlan | undefined): readonly ObjectId[] {
  if (plan === undefined) return [];
  return plan.kind === 'resize' ? plan.boxes.map((box) => box.id) : plan.ids;
}

describe('transforms of a selection holding an undrawable object', () => {
  const intents: readonly (readonly [string, SelectIntent])[] = [
    ['move', { type: 'move', delta: { x: 10, y: 5 }, isAxisLocked: false }],
    ['nudge', { type: 'nudge', delta: { x: 1, y: 0 } }],
    ['rotate', { type: 'rotate', angle: 0.5, pivot: { x: 0, y: 0 } } as SelectIntent],
    [
      'resize',
      {
        type: 'resize',
        handle: 'e',
        delta: { x: 100, y: 0 },
        isProportional: false,
        from: FRAME,
        to: { ...FRAME, width: 540 },
      },
    ],
  ];

  for (const [name, intent] of intents) {
    it(`leaves it out of a ${name}`, () => {
      expect(idsOf(planTransform(intent, SELECTED, gatedSource()))).toEqual([DRAWN]);
    });
  }

  it('leaves it out of align and distribute', () => {
    const source = gatedSource();
    expect(arrangeFrameOf(SELECTED, source).boxes.map((box) => box.id)).toEqual([DRAWN]);
    const three = [DRAWN, id('rect-b'), UNDRAWN];
    for (const operation of ['alignLeft', 'alignTop', 'distributeHorizontally'] as const) {
      const moved = planArrange(operation, three, source)?.moves.map((move) => move.id) ?? [];
      expect(moved, operation).not.toContain(UNDRAWN);
    }
  });

  it('leaves it out of the resize rules, and keeps it for Delete', () => {
    const source = gatedSource();
    expect(isResizable([UNDRAWN], source)).toBe(false);
    expect(resizeAspectOf(SELECTED, source)).toEqual(resizeAspectOf([DRAWN], source));
    expect(transformableIds(SELECTED, source)).toEqual(SELECTED);
  });
});
