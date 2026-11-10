import { bench, describe } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import { SceneSpatialIndex } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { benchSize } from './__fixtures__/bench-size.js';
import { mapSource, rect } from './__fixtures__/select-board.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { IDLE_SELECT_TOOL, stepSelectTool, type SelectToolState } from './select-tool.js';
import { EMPTY_SELECTION } from './selection-state.js';

// CPU cost of what the select tool does on one pointer event over a board of 1,000 objects
// (input handling shares the frame's budget): a press's hit test, a
// marquee drag's per-move rectangle query, and a whole state-machine step of either.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

/**
 * 1,000 rectangles, 40 × 25 of them on a 50 world-unit grid, every seventh turned.
 *
 * @returns The objects.
 */
function board(): BoardObject[] {
  const objects: BoardObject[] = [];
  for (let index = 0; index < 1000; index += 1) {
    const x = (index % 40) * 50;
    const y = Math.floor(index / 40) * 50;
    const rotation = index % 7 === 0 ? 0.3 : 0;
    objects.push(rect(`r${String(index)}`, null, { x, y, width: 40, height: 40, rotation }));
  }
  return objects;
}

const OBJECTS = board();
const SOURCE = mapSource(OBJECTS);
const INDEX = new SceneSpatialIndex();
const BY_ID = new Map<ObjectId, BoardObject>(OBJECTS.map((object) => [object.id, object]));
INDEX.apply({ created: [...BY_ID.keys()], updated: [], deleted: [], get: (id) => BY_ID.get(id) });
const HITS = createSelectHitTester(INDEX, SOURCE);
const CONTEXT = {
  zoom: 1,
  selection: EMPTY_SELECTION,
  frame: undefined,
  canResize: false,
  isLocked: false,
  hitTester: HITS,
};

describe('select tool per pointer event, 1,000 objects', () => {
  bench('hitPoint: the object under a press', () => {
    HITS.hitPoint({ x: 1015, y: 615 }, 1);
  });

  bench('hitRect intersect: a marquee a tenth of the board wide', () => {
    HITS.hitRect({ minX: 400, minY: 300, maxX: 600, maxY: 450 }, 'intersect');
  });

  bench('a marquee drag step: the state machine, the query and the new selection', () => {
    const pressed: SelectToolState = stepSelectTool(
      IDLE_SELECT_TOOL,
      {
        kind: 'pointerDown',
        screen: { x: 2020, y: 20 },
        world: { x: 2020, y: 20 },
        isShiftPressed: false,
        isModPressed: false,
      },
      CONTEXT,
    ).state;
    stepSelectTool(
      pressed,
      {
        kind: 'pointerMove',
        screen: { x: 1500, y: 400 },
        world: { x: 1500, y: 400 },
        isShiftPressed: false,
        isModPressed: false,
      },
      CONTEXT,
    );
  });
});

/** The parts of Node's runtime the heap measurement reads, when it runs under Node. */
interface NodeRuntime {
  /** Node's process, for its memory report. */
  readonly process?: { memoryUsage(): { readonly heapUsed: number } };
  /** A full garbage collection, present under `node --expose-gc`. */
  readonly gc?: () => void;
}

/**
 * The heap a value keeps alive, as the change in `heapUsed` across building it, with a full
 * collection on each side (`--expose-gc`); without a collector to call it is `null`, since the
 * figure would mix in garbage and could go negative.
 *
 * @param build - Builds the value; it is kept alive until the second reading.
 * @returns The bytes (`null` outside Node or without `--expose-gc`) and the value.
 */
function retainedHeap<Value>(build: () => Value): { bytes: number | null; value: Value } {
  const runtime = globalThis as NodeRuntime;
  runtime.gc?.();
  const before = runtime.process?.memoryUsage().heapUsed;
  const value = build();
  runtime.gc?.();
  const after = runtime.process?.memoryUsage().heapUsed;
  const isMeasured = runtime.gc !== undefined && before !== undefined && after !== undefined;
  return { bytes: isMeasured ? after - before : null, value };
}

// (folded in from): the select tool keeps its own spatial index of the document's
// truth beside the engine's culler index (which follows drag previews), so a 50k-object board
// holds two. This measures the second one on the synthetic budget board (frames laid out on a
// grid so the tree is realistic): its heap, how long building it takes, and a press on it.
const LARGE_COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const LARGE = createLargeBoardObjects(LARGE_COUNT, 45).map((object) =>
  object.type === 'frame'
    ? {
        ...object,
        x: (Number(object.name.slice(6)) % 25) * 1800,
        y: Math.floor(Number(object.name.slice(6)) / 25) * 1800,
      }
    : object,
);
const LARGE_BY_ID = new Map<ObjectId, BoardObject>(LARGE.map((object) => [object.id, object]));
const LARGE_CHANGES = {
  created: [...LARGE_BY_ID.keys()],
  updated: [],
  deleted: [],
  get: (id: ObjectId) => LARGE_BY_ID.get(id),
};
const largeIndex = retainedHeap(() => {
  const index = new SceneSpatialIndex();
  index.apply(LARGE_CHANGES);
  return index;
});
const LARGE_HITS = createSelectHitTester(largeIndex.value, mapSource(LARGE));
// The index's heap goes in the title in square brackets: the regression gate leaves bracketed
// text out of a benchmark's key, since it differs from run to run.
const heapLabel =
  largeIndex.bytes === null ? 'n/a' : `${(largeIndex.bytes / 1_048_576).toFixed(1)} MiB`;

describe(`the select tool's own hit index over ${String(LARGE_COUNT)} objects [heap ${heapLabel}]`, () => {
  bench(
    'build the index from the whole board',
    () => {
      new SceneSpatialIndex().apply(LARGE_CHANGES);
    },
    { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 },
  );

  bench('hitPoint on the large board', () => {
    LARGE_HITS.hitPoint({ x: 1815, y: 1815 }, 1);
  });
});
