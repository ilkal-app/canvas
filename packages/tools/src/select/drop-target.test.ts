import { describe, expect, it, vi } from 'vitest';

import {
  frame,
  id,
  indexOf,
  mapSource,
  rect,
  selectBoardObjects,
} from './__fixtures__/select-board.js';
import { dropTargetBox, stackDropOf, withDropTargets, withoutDropTargets } from './drop-target.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { TransformPlan } from './transform-plan.js';

// The select board has frame-f at (400, 0), 300 × 200, holding rect-c at (420, 20) on the board
// (50 × 50, centre (445, 45)). Here frame-n, 100 × 80 at (150, 100) in frame-f, sits at
// (550, 100) on the board, and frame-t, 200 × 200 at (1000, 0), is turned a quarter turn, so it
// covers x 800–1000, y 0–200.
function setUp() {
  const objects = [
    ...selectBoardObjects(),
    frame('frame-n', 'frame-f', { x: 150, y: 100, width: 100, height: 80 }),
    frame('frame-t', null, { x: 1000, y: 0, width: 200, height: 200, rotation: Math.PI / 2 }),
  ];
  const source = mapSource(objects);
  return { source, hitTester: createSelectHitTester(indexOf(objects), source) };
}

/** A move plan. */
type MovePlan = TransformPlan & { readonly kind: 'move' };

function move(ids: readonly string[], x: number, y: number): MovePlan {
  return { kind: 'move', ids: ids.map(id), delta: { x, y } };
}

function parentsOf(plan: TransformPlan): [string, string | null][] {
  return plan.kind === 'move' ? [...(plan.parentIds ?? [])] : [];
}

describe('withDropTargets', () => {
  it('takes an object dragged out of its frame to the root', () => {
    const { source, hitTester } = setUp();
    // rect-c's centre goes to (445, 245), below frame-f.
    expect(parentsOf(withDropTargets(move(['rect-c'], 0, 200), source, hitTester))).toEqual([
      ['rect-c', null],
    ]);
  });

  it('takes a group into a frame by the centre of its children', () => {
    const { source, hitTester } = setUp();
    // group-g's children span (0, 300)–(100, 340); the centre (50, 320) goes to (500, 70).
    expect(parentsOf(withDropTargets(move(['group-g'], 450, -250), source, hitTester))).toEqual([
      ['group-g', 'frame-f'],
    ]);
  });

  it('takes an object dropped over a frame into it, the top-most one when frames nest', () => {
    const { source, hitTester } = setUp();
    // rect-a's centre (50, 25) goes to (450, 125): frame-f; then to (600, 140): frame-n in it.
    expect(parentsOf(withDropTargets(move(['rect-a'], 400, 100), source, hitTester))).toEqual([
      ['rect-a', 'frame-f'],
    ]);
    expect(parentsOf(withDropTargets(move(['rect-a'], 550, 115), source, hitTester))).toEqual([
      ['rect-a', 'frame-n'],
    ]);
  });

  it('finds a turned frame by where it is drawn', () => {
    const { source, hitTester } = setUp();
    // rect-a's centre goes to (850, 125), inside frame-t's turned box.
    expect(parentsOf(withDropTargets(move(['rect-a'], 800, 100), source, hitTester))).toEqual([
      ['rect-a', 'frame-t'],
    ]);
  });

  it('leaves an object whose centre stays in its own frame where it is', () => {
    const { source, hitTester } = setUp();
    expect(parentsOf(withDropTargets(move(['rect-c'], 30, 30), source, hitTester))).toEqual([]);
  });

  it('never drops an object into itself, what it holds, or anything moved with it', () => {
    const { source, hitTester } = setUp();
    // frame-f's centre (550, 100) is over frame-n, its own child; frame-t moves too.
    const plan = move(['frame-f', 'frame-t'], 0, 0.5);
    expect(parentsOf(withDropTargets(plan, source, hitTester))).toEqual([]);
    // rect-a lands where frame-t was, but frame-t moves with it.
    const together = move(['rect-a', 'frame-t'], 800, 100);
    expect(parentsOf(withDropTargets(together, source, hitTester))).toEqual([]);
  });

  it('leaves objects in groups, objects without a box and missing objects alone', () => {
    const { source, hitTester } = setUp();
    const plan = move(['rect-d', 'connector-k', 'gone'], 450, -250);
    expect(parentsOf(withDropTargets(plan, source, hitTester))).toEqual([]);
  });

  it('passes resizes and rotations through unchanged', () => {
    const { source, hitTester } = setUp();
    const plan: TransformPlan = {
      kind: 'rotate',
      ids: [id('rect-a')],
      angle: 1,
      pivot: { x: 0, y: 0 },
    };
    expect(withDropTargets(plan, source, hitTester)).toBe(plan);
  });
});

describe('dropTargetBox', () => {
  it('is the box of the frame the primary object lands in, or nothing over bare board', () => {
    const { source, hitTester } = setUp();
    const plan = move(['rect-a', 'rect-b'], 400, 100);
    expect(dropTargetBox(plan, id('rect-a'), source, hitTester)).toEqual({
      x: 400,
      y: 0,
      width: 300,
      height: 200,
      rotation: 0,
    });
    expect(
      dropTargetBox(move(['rect-a'], 0, 600), id('rect-a'), source, hitTester),
    ).toBeUndefined();
  });

  it('follows the first moved object when the primary one does not move', () => {
    const { source, hitTester } = setUp();
    const plan = move(['rect-a'], 400, 100);
    expect(dropTargetBox(plan, id('rect-locked'), source, hitTester)?.x).toBe(400);
    expect(dropTargetBox(plan, undefined, source, hitTester)?.x).toBe(400);
  });

  it('shows the object’s own frame while it stays inside it', () => {
    const { source, hitTester } = setUp();
    const plan = move(['rect-c'], 10, 10);
    expect(dropTargetBox(plan, id('rect-c'), source, hitTester)?.width).toBe(300);
  });

  it('shows nothing when no moved object is on the board', () => {
    const { source, hitTester } = setUp();
    expect(dropTargetBox(move(['gone'], 400, 100), id('gone'), source, hitTester)).toBeUndefined();
    expect(dropTargetBox(move([], 400, 100), undefined, source, hitTester)).toBeUndefined();
  });
});

describe('withoutDropTargets', () => {
  it('drops a move’s new parents and leaves plans without any as they are', () => {
    const { source, hitTester } = setUp();
    const plan = withDropTargets(move(['rect-c'], 0, 200), source, hitTester);
    expect(withoutDropTargets(plan)).toEqual({
      kind: 'move',
      ids: ['rect-c'],
      delta: { x: 0, y: 200 },
    });
    const plain = move(['rect-c'], 1, 1);
    expect(withoutDropTargets(plain)).toBe(plain);
    const kept = withDropTargets(move(['rect-c'], 1, 1), source, hitTester);
    expect(withoutDropTargets(kept)).toBe(kept);
    const turn: TransformPlan = {
      kind: 'rotate',
      ids: [id('rect-a')],
      angle: 1,
      pivot: { x: 0, y: 0 },
    };
    expect(withoutDropTargets(turn)).toBe(turn);
  });
});

describe('stackDropOf', () => {
  // An auto-layout main at (100, 100), 300 × 100, holding a and b, 40 × 40 at x 10 and 60.
  function mainSetUp() {
    const autoLayout = {
      direction: 'row',
      gap: 10,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      align: 'start',
      justify: 'start',
      width: 'fixed',
      height: 'fixed',
    } as const;
    const main = {
      ...rect('main', null, { x: 100, y: 100, width: 300, height: 100 }),
      type: 'component',
      name: 'Main',
      retired: false,
      autoLayout,
    };
    const objects = [
      main as unknown as ReturnType<typeof rect>,
      { ...rect('a', 'main', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
      { ...rect('b', 'main', { x: 60, y: 10, width: 40, height: 40 }), z: 'a1' },
    ];
    const source = mapSource(objects);
    return { source, hitTester: createSelectHitTester(indexOf(objects), source) };
  }

  it('keeps a box moved inside its auto-layout main in that main, following the first id', () => {
    const { source, hitTester } = mainSetUp();
    // No primary: b, the first moved, from centre x 180 to 125, before a.
    expect(stackDropOf(move(['b'], -55, 0), undefined, source, hitTester)).toMatchObject({
      containerId: 'main',
      belowId: 'a',
    });
  });

  it('is nothing when one moved box leaves the main the others stay in', () => {
    const { source, hitTester } = mainSetUp();
    // a's centre goes from 130 to 370, inside the main (100–400); b's from 180 to 420, outside.
    expect(stackDropOf(move(['a', 'b'], 240, 0), id('a'), source, hitTester)).toBeUndefined();
    expect(stackDropOf(move(['b', 'a'], 240, 0), id('a'), source, hitTester)).toBeUndefined();
  });

  it('settles on the first moved box when it lands in no auto-layout', () => {
    // 300 boxes in a plain frame, all moved: one landing, one frame hit, not one per box.
    const boxes = [...Array(300).keys()].map((index) =>
      rect(`r${String(index)}`, 'plain', {
        x: (index % 20) * 20,
        y: Math.floor(index / 20) * 20,
        width: 10,
        height: 10,
      }),
    );
    const objects = [frame('plain', null, { x: 0, y: 0, width: 600, height: 600 }), ...boxes];
    const source = mapSource(objects);
    const hitTester = createSelectHitTester(indexOf(objects), source);
    const frameAt = vi.spyOn(hitTester, 'frameAt');
    const get = vi.spyOn(source, 'get');
    const plan = move(
      boxes.map(({ id: boxId }) => boxId),
      5,
      5,
    );
    expect(stackDropOf(plan, boxes[0]?.id, source, hitTester)).toBeUndefined();
    expect(frameAt).toHaveBeenCalledTimes(1);
    // Only the first box is previewed and measured, not all 300.
    expect(get.mock.calls.length).toBeLessThan(50);
  });

  it('is nothing for a box dragged out of its main, or a plan naming an object not there', () => {
    const { source, hitTester } = mainSetUp();
    expect(stackDropOf(move(['b'], 0, 300), id('b'), source, hitTester)).toBeUndefined();
    expect(stackDropOf(move(['gone'], 0, 0), id('gone'), source, hitTester)).toBeUndefined();
  });
});
