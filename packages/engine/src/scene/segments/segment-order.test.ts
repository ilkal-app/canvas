// The z-order planner against brute force (the reviewer's harness, committed):
// on seeded random boards of every kind the standard passes draw, a plan that merges segments by
// boxes, or keeps images on fewer pages' segments, may add no z-order error to the plan made by
// passes alone, neither when it is made nor after moves it survives (`checkMovedObjects`), with
// hidden text changing between the plan and the moves; and the plan by passes alone has only the
// errors it is known to have under the engine's split rule (every painted shape and
// every image with opacity above 0 starts a split).
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

import {
  errorClass,
  orderErrors,
  randomBoard,
  randomBox,
  seededRandom,
  toggleHiddenText,
} from './__fixtures__/random-board.js';
import { checkMovedObjects } from './segment-moves.js';
import { planSegmentDraws } from './segment-plan.js';

/** How many boards each property is checked on. */
const BOARDS = 3_000;

function meets(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * The errors a plan adds to another's.
 *
 * @param errors - The plan's.
 * @param baseline - The other's.
 * @returns The errors only the plan has.
 */
function added(errors: Set<string>, baseline: Set<string>): string[] {
  return [...errors].filter((error) => !baseline.has(error));
}

const RULES = ['painted'] as const;

describe('the z-order plan by passes alone on random boards', () => {
  it.each(RULES)(
    'has only cross-pass errors in a segment and text across atlas pages (%s rule)',
    (rule) => {
      const classes = new Map<string, number>();
      let tiledAcrossPages = 0;
      for (let seed = 1; seed <= BOARDS; seed += 1) {
        const board = randomBoard(seed, rule);
        const plan = planSegmentDraws(board.input);
        for (const error of orderErrors(board, plan.entries, board.boxes)) {
          const kind = errorClass(board, error);
          classes.set(kind, (classes.get(kind) ?? 0) + 1);
          expect(kind, `seed ${String(seed)}: ${error}`).not.toBe('unexpected');
        }
        const images = plan.pageSpans.find(({ passIndex }) => passIndex === 2);
        const isTiledAcrossPages = images?.maxPageByRank.some(
          (page, rank) => page > (images.minPageByRank[rank] ?? page),
        );
        if (isTiledAcrossPages === true) tiledAcrossPages += 1;
      }
      // Both known classes occur, and tiled images span pages on many boards.
      expect(classes.get('cross-pass')).toBeGreaterThan(0);
      expect(classes.get('text-pages')).toBeGreaterThan(0);
      expect(tiledAcrossPages).toBeGreaterThan(BOARDS / 10);
    },
  );
});

describe.each(RULES)('the z-order plan on random boards (%s rule)', (rule) => {
  it('adds no z-order error to the plan by passes alone when it merges by boxes', () => {
    let merged = 0;
    let inSplits = 0;
    for (let seed = 1; seed <= BOARDS; seed += 1) {
      const board = randomBoard(seed, rule);
      const byPasses = planSegmentDraws(board.input);
      const byBoxes = planSegmentDraws({
        ...board.input,
        boundsOfRank: (rank) => board.boxes[rank],
      });
      const errors = orderErrors(board, byBoxes.entries, board.boxes);
      const baseline = orderErrors(board, byPasses.entries, board.boxes);
      const extra = added(errors, baseline);
      const byMerges = extra;
      expect(byMerges, `seed ${String(seed)}`).toEqual([]);
      inSplits += extra.length;
      if (byBoxes.segmentCount < byPasses.segmentCount) merged += 1;
    }
    // The property is not vacuous: boxes merge segments on many boards. Errors inside one
    // split are rare, and none under the engine's rule.
    expect(merged).toBeGreaterThan(BOARDS / 5);
    expect(inSplits).toBeLessThan(1);
  });

  it('adds none after hidden text changes and moves, whenever the move check keeps the plan', () => {
    let kept = 0;
    let broken = 0;
    let toggled = 0;
    for (let seed = 1; seed <= BOARDS; seed += 1) {
      const random = seededRandom(seed * 7_919);
      // Text is hidden or shown again between the plan and the moves: the stage re-plans on a
      // new hidden set (`LevelOfDetail.hiddenRevision`), then checks the moves against it.
      const planned = randomBoard(seed, rule);
      const board = toggleHiddenText(planned, random);
      if (board.isTextHidden.some((isHidden, rank) => isHidden !== planned.isTextHidden[rank])) {
        toggled += 1;
      }
      const byPasses = planSegmentDraws(board.input);
      const plan = planSegmentDraws({ ...board.input, boundsOfRank: (rank) => board.boxes[rank] });
      for (let move = 0; move < 3; move += 1) {
        const moved = new Set([Math.floor(random() * board.count)]);
        if (random() < 0.3) moved.add(Math.floor(random() * board.count));
        const boxes = board.boxes.slice();
        for (const rank of moved) boxes[rank] = randomBox(random);
        const spatial = {
          boundsOf: (id: ObjectId) => boxes[Number(id)],
          searchRect: (rect: WorldBounds) =>
            boxes.flatMap((box, rank) =>
              box === undefined || meets(box, rect) ? [String(rank) as ObjectId] : [],
            ),
        };
        const ids = [...moved].map((rank) => String(rank) as ObjectId);
        // The stage checks moves only against a plan that merged by boxes.
        const verdict = plan.hasSpatialMerges
          ? checkMovedObjects(plan, ids, (id) => Number(id), spatial, 256)
          : 'kept';
        if (verdict !== 'kept') {
          broken += 1;
          continue;
        }
        kept += 1;
        const errors = orderErrors(board, plan.entries, boxes);
        const baseline = orderErrors(board, byPasses.entries, boxes);
        const byMerges = added(errors, baseline);
        expect(byMerges, `seed ${String(seed)}, move ${String(move)}`).toEqual([]);
      }
    }
    expect(kept).toBeGreaterThan(BOARDS);
    expect(broken).toBeGreaterThan(0);
    expect(toggled).toBeGreaterThan(BOARDS / 2);
  });
});
