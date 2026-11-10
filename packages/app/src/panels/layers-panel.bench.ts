import { bench, describe } from 'vitest';

import {
  createLargeBoardObjects,
  generateKeyBetween,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
} from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { benchSize } from './__fixtures__/bench-size.js';
import { layerDropAt } from './layers/layer-drop.js';
import { LAYER_ROW_HEIGHT_PX } from './layers/layer-row-item.js';
import { LayerTree } from './layers/layer-tree.js';
import { renderedItems, visibleRows } from './layers/visible-rows.js';

// The layers panel on the budget's 50k-object board: opening it
// (one walk of the board and the root rows), expanding every frame (50k rows), scrolling the
// whole list a screen at a time (the virtualised window: O(rows in view) per step), and
// following a move, which rebuilds nothing. Then the structural changes a collaborator makes
// while every frame is open (under 16 ms each): a create (alternating with its delete,
// so the board keeps its size), a reparent between two frames and a restack within one; the
// tree follows each change set as it follows a remote one, in one pass. And a drag over the open
// list: the drop under the pointer at a frame's last child, which scans up past every
// sibling to find the sibling above and the parent, the worst a pointer move costs. CI's smoke run
// (`BENCH_SMOKE=1`) uses 2k objects.

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const VIEW_HEIGHT_PX = 480;
const OVERSCAN_ROWS = 8;

const objects = createLargeBoardObjects(COUNT, 85);
const store = new YjsDocumentStore({ clientId: 85 });
store.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of objects) transaction.setObject(object);
});
const frameIds = objects.filter((object) => object.type === 'frame').map((object) => object.id);
const expanded = new LayerTree(store);
expanded.setExpanded(frameIds, true);
const moved = objects.find((object) => object.type !== 'frame')?.id ?? ('' as ObjectId);

// A second expanded tree that follows the store, and the objects the structural cases change:
// a sticky in the middle frame, moved to the frame after it and back, or to the bottom of its
// frame and back to the top.
const following = new LayerTree(store);
following.setExpanded(frameIds, true);
store.subscribe((changes) => {
  following.applyChanges(changes);
});
const middleFrame = frameIds[Math.floor(frameIds.length / 2)] ?? ('' as ObjectId);
const nextFrame = frameIds[Math.floor(frameIds.length / 2) + 1] ?? middleFrame;
const sticky = objects.find(
  (object) => object.parentId === middleFrame && object.type === 'sticky',
);
if (sticky === undefined) throw new Error('The large board has a sticky in every frame.');
const TOP_KEY = generateKeyBetween('b99', null);
const BOTTOM_KEY = generateKeyBetween(null, 'b00');
const created: BoardObject = { ...sticky, id: 'bench-created' as ObjectId, z: TOP_KEY };
let isCreated = false;
let isInNextFrame = false;
let isAtBottom = false;

describe(`layers panel, ${String(COUNT)} objects`, () => {
  bench('open: walk the board and list the root', () => {
    new LayerTree(store);
  });

  bench('expand every frame: list every object', () => {
    new LayerTree(store).setExpanded(frameIds, true);
  });

  bench('scroll the expanded list a screen at a time, top to bottom', () => {
    const rows = expanded.rows();
    for (let top = 0; top < rows.length * LAYER_ROW_HEIGHT_PX; top += VIEW_HEIGHT_PX) {
      const range = visibleRows(
        rows.length,
        top,
        VIEW_HEIGHT_PX,
        LAYER_ROW_HEIGHT_PX,
        OVERSCAN_ROWS,
      );
      renderedItems(rows, range, 0);
    }
  });

  bench('follow a move of one object (no rebuild)', () => {
    expanded.applyChanges({
      origin: SYSTEM_ORIGIN,
      isLocal: true,
      created: [],
      updated: [moved],
      deleted: [],
    });
  });

  bench('drag: the drop under the pointer at the last child of an open frame', () => {
    const rows = expanded.rows();
    let index = rows.length - 1;
    while (index > 0 && rows[index]?.level !== 2) index -= 1;
    layerDropAt(rows, new Set([moved]), index, 0.1);
  });

  bench('follow a create in an open frame, then its delete (alternating)', () => {
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      if (isCreated) transaction.deleteObject(created.id);
      else transaction.setObject(created);
    });
    isCreated = !isCreated;
  });

  bench('follow a reparent between two open frames', () => {
    isInNextFrame = !isInNextFrame;
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(sticky.id, { parentId: isInNextFrame ? nextFrame : middleFrame });
    });
  });

  bench('follow a restack in an open frame (to the bottom, then the top)', () => {
    isAtBottom = !isAtBottom;
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(sticky.id, { z: isAtBottom ? BOTTOM_KEY : TOP_KEY });
    });
  });
});
