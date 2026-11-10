import { expect, it } from 'vitest';

import { boardObjectSchema } from '@canvas/schema';

import { createSelectionCapBoard } from './selection-cap-board.js';

it('lays 600 valid rectangles in 30 columns by 20 rows, past the 500-outline cap', () => {
  const shapes = createSelectionCapBoard();
  expect(shapes).toHaveLength(600);
  expect(new Set(shapes.map(({ id }) => id)).size).toBe(600);
  for (const shape of shapes) expect(boardObjectSchema.safeParse(shape).success).toBe(true);
  expect(shapes[0]).toMatchObject({ id: 'selection-cap-0', x: 40, y: 40, width: 10, height: 10 });
  expect(shapes[29]).toMatchObject({ x: 475, y: 40 });
  expect(shapes[30]).toMatchObject({ x: 40, y: 55 });
  expect(shapes[599]).toMatchObject({ id: 'selection-cap-599', x: 475, y: 325 });
  expect(Math.max(...shapes.map(({ x, width }) => x + width))).toBe(485);
  expect(Math.max(...shapes.map(({ y, height }) => y + height))).toBe(335);
});

it('stacks the rectangles in creation order, deterministically, as fresh objects each call', () => {
  const first = createSelectionCapBoard();
  const second = createSelectionCapBoard();
  const z = first.map((shape) => shape.z);
  expect([...z].sort()).toEqual(z);
  expect(new Set(z).size).toBe(600);
  expect(second).toEqual(first);
  expect(second[0]).not.toBe(first[0]);
});
