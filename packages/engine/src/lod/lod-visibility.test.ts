import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { VisibilityChange } from '../spatial/spatial-visibility.js';

import { LevelOfDetail } from './level-of-detail.js';
import { TEXT_LOD_RULE } from './lod-thresholds.js';

const counters = () => ({ lodTransitions: 0, lodThrashes: 0 });

/**
 * Tracks IDs in a text-like pass.
 *
 * @param ids - The object IDs.
 * @returns The LOD state.
 */
function tracked(ids: readonly string[]): LevelOfDetail {
  const lod = new LevelOfDetail();
  lod.register([
    {
      name: 'words',
      levelOfDetail: {
        rule: TEXT_LOD_RULE,
        sizeOf: () => 10,
      },
    },
  ]);
  for (const id of ids) lod.track(0, shapeObject(id));
  return lod;
}

/**
 * Builds a change record using borrowed membership.
 *
 * @param source - The provider identity.
 * @param revision - The new revision.
 * @param members - Current membership.
 * @param entered - Added IDs.
 * @param left - Removed IDs.
 * @returns The change record.
 */
function change(
  source: object,
  revision: number,
  members: ReadonlySet<string>,
  entered: readonly string[],
  left: readonly string[] = [],
): VisibilityChange {
  return {
    source,
    revision,
    previousRevision: revision - 1,
    members: members as ReadonlySet<ObjectId>,
    entered: entered as readonly ObjectId[],
    left: left as readonly ObjectId[],
  };
}

describe('incremental LOD visibility', () => {
  it('uses only the delta after the first snapshot and owns its membership between stages', () => {
    const ids = Array.from({ length: 50000 }, (unused, index) => `s${String(index)}`);
    const lod = tracked(ids);
    const members = new Set(ids.slice(0, 49990));
    const source = {};
    lod.update(change(source, 1, members, [...members]), 0.3, counters());
    const iterate = vi.spyOn(members, Symbol.iterator);
    for (const id of ids.slice(0, 10)) members.delete(id);
    for (const id of ids.slice(49990)) members.add(id);
    const next = change(source, 2, members, ids.slice(49990), ids.slice(0, 10));
    lod.update(next, 0.3, counters());
    expect(iterate).not.toHaveBeenCalled();
    expect(lod.enteredIds).toEqual(ids.slice(49990));
    expect(lod.formOf('words', 's49999' as ObjectId)).toBe('greek');
    expect(lod.isVisible('s0' as ObjectId)).toBe(false);
    members.delete('s49999');
    expect(lod.isVisible('s49999' as ObjectId)).toBe(true);
    const evaluations = lod.evaluations;
    lod.update(next, 0.3, counters());
    expect(lod.evaluations).toBe(evaluations);
  });

  it('recovers from missed revisions and provider switches, including leave/reenter', () => {
    const lod = tracked(['a', 'b']);
    const source = {};
    lod.update(change(source, 1, new Set(['a']), ['a']), 1, counters());
    lod.update(change(source, 4, new Set(['b']), [], []), 0.3, counters());
    expect(lod.isVisible('a' as ObjectId)).toBe(false);
    expect(lod.formOf('words', 'b' as ObjectId)).toBe('greek');
    lod.update(change({}, 4, new Set(['a']), [], []), 0.3, counters());
    expect(lod.formOf('words', 'a' as ObjectId)).toBe('greek');
    expect(lod.isVisible('b' as ObjectId)).toBe(false);
    lod.update(undefined, 1, counters());
    expect(lod.formOf('words', 'a' as ObjectId)).toBe('full');
    expect(lod.formOf('words', 'b' as ObjectId)).toBe('full');
    lod.update(['a' as ObjectId], 0.3, counters());
    expect(lod.isVisible('b' as ObjectId)).toBe(false);
  });
});
