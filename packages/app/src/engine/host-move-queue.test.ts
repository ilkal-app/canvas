import { expect, it } from 'vitest';

import { createDemoBoard } from './demo-board.js';
import { HostMoveQueue } from './host-move-queue.js';

const objects = createDemoBoard().slice(0, 1);
const ids = objects.map((object) => object.id);
const preview = (x: number) => ({ ids, objects, positions: new Float64Array([x, 0]) });

it('sends base geometry once and retains only the latest independently owned snapshot', () => {
  const queue = new HostMoveQueue();
  const first = preview(10);
  queue.show(first);
  queue.show(preview(20));
  expect(queue.takeMove()).toEqual([
    { kind: 'begin', session: 1, sequence: 0, objects, positions: new Float64Array([20, 0]) },
  ]);
  queue.show(preview(30));
  // Every root moved by the same translation from the begin positions: one pair.
  expect(queue.takeMove()).toEqual([{ kind: 'update', session: 1, sequence: 1, delta: [10, 0] }]);
  expect([...first.positions]).toEqual([10, 0]);
  expect(queue.hasPending).toBe(false);
});

it('ends before ordinary changes and uses a new session even for the same membership afterward', () => {
  const queue = new HostMoveQueue();
  queue.show(preview(10));
  queue.takeMove();
  queue.stop();
  queue.show(preview(20));
  expect(queue.takeEnds()).toEqual([{ kind: 'end', session: 1, sequence: 1 }]);
  expect(queue.takeMove()).toEqual([
    { kind: 'begin', session: 2, sequence: 0, objects, positions: new Float64Array([20, 0]) },
  ]);
  queue.show(undefined);
  expect(queue.takeEnds()).toEqual([{ kind: 'end', session: 2, sequence: 1 }]);
  expect(queue.takeMove()).toEqual([]);
});

it('cancels an unsent preview without opening a session and clears disposal references', () => {
  const queue = new HostMoveQueue();
  queue.show(preview(10));
  queue.stop();
  expect(queue.takeEnds()).toEqual([]);
  expect(queue.takeMove()).toEqual([]);
  queue.show(preview(20));
  queue.takeMove();
  queue.clear();
  queue.stop();
  expect(queue.hasPending).toBe(false);
});
