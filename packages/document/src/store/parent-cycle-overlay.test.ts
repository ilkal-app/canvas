import { expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { thirdFrame } from '../repair/__fixtures__/cycle-fixtures.js';

import { ParentCycleOverlay } from './parent-cycle-overlay.js';

it('bounds the cycle description while retaining its total member count', () => {
  const ids = Array.from(
    { length: 50 },
    (unused, index) => `frame-${String(index).padStart(3, '0')}-${'x'.repeat(80)}` as ObjectId,
  );
  const objects = new Map<ObjectId, BoardObject>(
    ids.map((id, index) => [
      id,
      {
        ...thirdFrame(),
        id,
        parentId: ids[(index + 1) % ids.length] ?? null,
      },
    ]),
  );
  const overlay = new ParentCycleOverlay();
  overlay.update(ids, (id) => objects.get(id));
  const issues = overlay.issues().flatMap(([, values]) => values);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.message.length).toBeLessThanOrEqual(512);
  expect(issues[0]?.message).toContain('50');
  expect(issues[0]?.key).toBe(ids[0]);
});
