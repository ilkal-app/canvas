import { expect, it } from 'vitest';

import { SceneRevisions } from './scene-revisions.js';

const stamp = (sequence: number, session = 'mount'): { session: string; sequence: number } => ({
  session,
  sequence,
});

it('matches only an exactly applied contiguous revision in one session', () => {
  const revisions = new SceneRevisions();
  expect(revisions.matches(stamp(0))).toBe(false);
  revisions.apply(stamp(0));
  expect(revisions.matches(stamp(0))).toBe(true);
  expect(revisions.matches(stamp(1))).toBe(false);
  revisions.apply(stamp(1));
  expect(revisions.matches(stamp(0))).toBe(false);
  expect(revisions.matches(stamp(1))).toBe(true);
});

it.each([
  [stamp(0), stamp(0)],
  [stamp(0), stamp(2)],
  [stamp(0), stamp(1, 'other')],
  [stamp(0), undefined],
  [undefined, stamp(0)],
  [stamp(1)],
])('never recovers certification after a broken stream %j', (...values) => {
  const revisions = new SceneRevisions();
  for (const value of values) revisions.apply(value);
  revisions.apply(stamp(0, 'fresh'));
  revisions.apply(stamp(1, 'fresh'));
  expect(revisions.matches(stamp(1, 'fresh'))).toBe(false);
});

it('owns the applied stamp and invalidates permanently after a frame failure', () => {
  const revisions = new SceneRevisions();
  const input = stamp(0);
  revisions.apply(input);
  input.sequence = 10;
  expect(revisions.matches(stamp(0))).toBe(true);
  revisions.invalidate();
  revisions.apply(stamp(1));
  expect(revisions.matches(stamp(1))).toBe(false);
});
