import { expect, it } from 'vitest';

import { createDemoBoard } from './demo-board.js';
import { HostMoveQueue } from './host-move-queue.js';

const objects = createDemoBoard().slice(0, 2);
const ids = objects.map(({ id }) => id);
const base = objects.flatMap(({ x, y }) => [x, y]);
const preview = (positions: readonly number[]) => ({
  ids,
  objects,
  positions: new Float64Array(positions),
});

it('sends one delta for a translation exactly equal to every root position', () => {
  const queue = new HostMoveQueue();
  queue.show(preview(base));
  expect(queue.takeMove()[0]).toMatchObject({ kind: 'begin', positions: new Float64Array(base) });
  const translated = objects.flatMap(({ x, y }) => [x + 3.25, y - 4.5]);
  queue.show(preview(translated));
  expect(queue.takeMove()).toEqual([
    { kind: 'update', session: 1, sequence: 1, delta: [3.25, -4.5] },
  ]);
});

it('sends positions when one root differs or double arithmetic differs', () => {
  const queue = new HostMoveQueue();
  queue.show(preview(base));
  queue.takeMove();
  const different = objects.flatMap(({ x, y }, index) => [x + 1 + index, y + 2]);
  queue.show(preview(different));
  expect(queue.takeMove()).toEqual([
    { kind: 'update', session: 1, sequence: 1, positions: new Float64Array(different) },
  ]);
  const rounded = objects.flatMap(({ x, y }) => [x + 0.1, y + 0.2]);
  rounded[2] = (rounded[2] ?? 0) + Number.EPSILON;
  queue.show(preview(rounded));
  expect(queue.takeMove()).toEqual([
    { kind: 'update', session: 1, sequence: 2, positions: new Float64Array(rounded) },
  ]);
});
