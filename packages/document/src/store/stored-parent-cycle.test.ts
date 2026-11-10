import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { hasStoredParentCycle } from './stored-parent-cycle.js';

it('follows changed parent chains while ignoring unrelated cycles and unreadable placements', () => {
  const doc = new Y.Doc();
  const objects = doc.getMap<unknown>('objects');
  for (const [id, parentId] of [
    ['a', 'b'],
    ['b', 'a'],
    ['leaf', 'a'],
    ['root', null],
  ]) {
    if (id === null || id === undefined) throw new Error('missing id');
    objects.set(id, new Y.Map([['placement', { parentId }]]));
  }
  objects.set('unreadable', 1);
  expect(hasStoredParentCycle(objects, ['root', 'unreadable', 'missing'])).toBe(false);
  expect(hasStoredParentCycle(objects, ['leaf'])).toBe(true);
  expect(hasStoredParentCycle(objects, ['a'])).toBe(true);
  const b = objects.get('b');
  if (!(b instanceof Y.Map)) throw new Error('missing b');
  b.set('placement', { parentId: null });
  expect(hasStoredParentCycle(objects, ['leaf', 'a', 'b'])).toBe(false);
  doc.destroy();
});
