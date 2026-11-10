import { bench, describe } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import type { BoardObject, ConnectorObject, ObjectId, PrincipalId } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { benchSize } from '../select/__fixtures__/bench-size.js';
import { rect } from '../select/__fixtures__/select-board.js';
import { ADA, createSelectStore, NOW, storeSource } from '../select/__fixtures__/select-store.js';

import { ConnectorRouteHandles } from './connector-route-handles.js';

// CPU cost of one pointer move while a selected connector's route handle is dragged (the budget:
// "no frame > 33 ms during a drag"): the move re-places the connector's ends, routes it
// and previews it, for an elbow's middle piece and a curve's bend, over a 50k-object board (the
// synthetic large board; CI's smoke run builds 2k), and the overlay the next frame draws. Gated by
// `pnpm bench:ci` (its micro-benchmark suite).

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });

/**
 * A connector between the two boxes, from a's right side (60, 30) to b's left side (300, 230).
 *
 * @param id - Its id.
 * @param route - Its route.
 * @returns The connector.
 */
function connectorOf(id: string, route: ConnectorObject['route']): ConnectorObject {
  return {
    id: id as ObjectId,
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a5',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: NOW,
    updatedAt: NOW,
    type: 'connector',
    from: { kind: 'object', objectId: 'bench-a' as ObjectId, anchor: { x: 1, y: 0.5 } },
    to: { kind: 'object', objectId: 'bench-b' as ObjectId, anchor: { x: 0, y: 0.5 } },
    route,
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
}

const OBJECTS: BoardObject[] = [
  ...createLargeBoardObjects(COUNT, 679),
  rect('bench-a', null, { x: 0, y: 0, width: 60, height: 60 }),
  rect('bench-b', null, { x: 300, y: 200, width: 60, height: 60 }),
  connectorOf('bench-elbow', 'elbow'),
  connectorOf('bench-curve', 'curved'),
];
const STORE = createSelectStore(OBJECTS);

/**
 * Route handles with one connector selected, its handle pressed at a point.
 *
 * @param id - The connector.
 * @param handle - Where its handle is.
 * @param handle.x - Its world x.
 * @param handle.y - Its world y.
 * @returns The editor, dragging.
 */
function dragging(id: string, handle: { x: number; y: number }): ConnectorRouteHandles {
  const editor = new ConnectorRouteHandles({
    store: STORE,
    origin: ADA,
    environment: { clock: () => NOW, createId: () => 'unused' as ObjectId },
    setPreview: () => undefined,
    onChange: () => undefined,
    source: storeSource(STORE),
    selection: () => [id as ObjectId],
  });
  editor.press(move('pointerDown', handle.x, handle.y), 1);
  return editor;
}

/**
 * A pointer input at zoom 1.
 *
 * @param kind - Its kind.
 * @param x - World x.
 * @param y - World y.
 * @returns The input.
 */
function move(kind: 'pointerDown' | 'pointerMove', x: number, y: number) {
  const point = { x, y };
  return {
    kind,
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
  } satisfies ToolPointerInput;
}

describe(`connector route handles, one move of a drag, ${String(COUNT)} objects`, () => {
  const elbow = dragging('bench-elbow', { x: 180, y: 130 });
  let step = 0;
  bench('elbow middle piece: a move and the overlay', () => {
    step = (step + 1) % 100;
    elbow.follow(move('pointerMove', 100 + step, 130));
    elbow.overlay();
  });

  const curve = dragging('bench-curve', { x: 180, y: 130 });
  bench('curve bend: a move and the overlay', () => {
    step = (step + 1) % 100;
    curve.follow(move('pointerMove', 150, 60 + step));
    curve.overlay();
  });
});
