import type { ObjectId, SiblingKey } from '@canvas/schema';

/**
 * Siblings whose keys and ids exercise every part of the sibling order, in no order: a negative
 * integer (`Zz`), the zero integer and keys that extend it (`a0` below `a0G` below `a0V`), a key
 * that is a prefix of another (`a1`, `a1V`), a longer integer (`b00`), equal keys broken by id,
 * and ids that differ only in case (`B` sorts below `a` by code unit, not by locale).
 */
export const SIBLING_ORDER_FIXTURE: readonly SiblingKey[] = [
  ['n2', 'a1'],
  ['a1v', 'a1V'],
  ['n1', 'a1'],
  ['x', 'Zz'],
  ['y', 'a0V'],
  ['g', 'a0G'],
  ['wide', 'b00'],
  ['a', 'a0'],
  ['B', 'a0'],
  ['z', 'a0'],
].map(([id = '', z = '']) => ({ id: id as ObjectId, z }));

/** The fixture's ids bottom to top, worked out by hand from the rule. */
export const SIBLING_ORDER_FIXTURE_BOTTOM_UP = [
  'x',
  'B',
  'a',
  'z',
  'g',
  'y',
  'n1',
  'n2',
  'a1v',
  'wide',
] as const;
