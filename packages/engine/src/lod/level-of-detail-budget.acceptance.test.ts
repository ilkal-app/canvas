import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { LevelOfDetail, type LodCounters, type LodPass } from './level-of-detail.js';
import { TEXT_LOD_RULE } from './lod-thresholds.js';

const PASS: LodPass = {
  name: 'words',
  levelOfDetail: {
    rule: TEXT_LOD_RULE,
    sizeOf: (object) => ('width' in object ? object.width : 0),
  },
};
const counts = (): LodCounters => ({ lodTransitions: 0, lodThrashes: 0 });
const pending = (lod: LevelOfDetail): boolean =>
  (lod as unknown as { hasPendingChanges(): boolean }).hasPendingChanges();

function populated(changesPerFrame?: number): LevelOfDetail {
  const lod = new LevelOfDetail({ changesPerFrame });
  lod.register([PASS]);
  for (let index = 0; index < 111; index++)
    lod.track(0, shapeObject(`s${String(index)}`, { width: 10 }));
  return lod;
}

describe('level of detail form-change budget', () => {
  it('limits transitions and converges at a held scale without thrash', () => {
    const cap = 13;
    const limited = populated(cap);
    const unlimited = populated(Infinity);
    limited.update(undefined, 1, counts());
    unlimited.update(undefined, 1, counts());
    unlimited.update(undefined, 0.2, counts());
    for (let frame = 0; frame < 10; frame++) {
      const counters = counts();
      limited.update(undefined, 0.2, counters);
      expect(counters.lodTransitions).toBeLessThanOrEqual(cap);
      expect(counters.lodThrashes).toBe(0);
      expect(pending(limited)).toBe(frame < 8);
    }
    for (let index = 0; index < 111; index++) {
      const id = `s${String(index)}` as ObjectId;
      expect(limited.formOf('words', id)).toBe(unlimited.formOf('words', id));
    }
  });

  it('matches the default unbounded forms and transition counts with Infinity', () => {
    const implicit = populated();
    const explicit = populated(Infinity);
    for (const scale of [1, 0.2, 0.5, 1, 0.2]) {
      const a = counts();
      const b = counts();
      implicit.update(undefined, scale, a);
      explicit.update(undefined, scale, b);
      expect(b).toEqual(a);
      expect(pending(explicit)).toBe(false);
      for (let index = 0; index < 111; index++) {
        const id = `s${String(index)}` as ObjectId;
        expect(explicit.formOf('words', id)).toBe(implicit.formOf('words', id));
      }
    }
  });
});
