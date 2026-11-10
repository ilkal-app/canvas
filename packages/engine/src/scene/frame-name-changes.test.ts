// Frames' name display resolved in the change set the scene reads: a frame without
// showName reads with the default over its ancestors, and a move to another parent lists the
// frames below the moved object again.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { frameObject, groupObject, shapeObject } from './__fixtures__/scene-objects.js';
import { withResolvedFrameNames } from './frame-name-changes.js';
import { markRootMoveChanges } from './root-move-changes.js';
import { SceneHierarchy } from './scene-hierarchy.js';
import type { SceneChangeSet } from './scene-source.js';

/**
 * A change set over some objects.
 *
 * @param objects - The document.
 * @param updated - The ids it lists as updated.
 * @returns The change set.
 */
function changesOf(objects: readonly BoardObject[], updated: readonly string[]): SceneChangeSet {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    created: [],
    updated: updated as ObjectId[],
    deleted: [],
    get: (id) => byId.get(id),
  };
}

/**
 * The hierarchy of objects as the scene last applied them.
 *
 * @param objects - The objects.
 * @returns The hierarchy.
 */
function hierarchyOf(objects: readonly BoardObject[]): SceneHierarchy {
  const hierarchy = new SceneHierarchy();
  for (const object of objects) hierarchy.setParent(object.id, object.parentId);
  return hierarchy;
}

const OUTER = frameObject('outer');
const GROUP = groupObject('group');
const CARD = frameObject('card', { parentId: 'group' });
const SHOWN = frameObject('shown', { parentId: 'group', showName: true });
const NOTE = shapeObject('note', { parentId: 'group' });
const BEFORE = [OUTER, GROUP, CARD, SHOWN, NOTE];

describe('withResolvedFrameNames', () => {
  it('reads a frame without showName with the default over its ancestors, once per id', () => {
    const changes = withResolvedFrameNames(changesOf(BEFORE, ['card']), hierarchyOf(BEFORE));
    expect(changes.get('card' as ObjectId)).toMatchObject({ showName: true });
    expect(changes.get('card' as ObjectId)).toBe(changes.get('card' as ObjectId));
    expect(changes.get('shown' as ObjectId)).toBe(SHOWN);
    expect(changes.get('note' as ObjectId)).toBe(NOTE);
    expect(changes.updated).toEqual(['card']);
    expect(CARD).not.toHaveProperty('showName');
  });

  it('lists the frames without showName below an object moved to another parent', () => {
    const after = [OUTER, { ...GROUP, parentId: 'outer' as ObjectId }, CARD, SHOWN, NOTE];
    const changes = withResolvedFrameNames(changesOf(after, ['group']), hierarchyOf(BEFORE));
    expect(changes.updated).toEqual(['group', 'card']);
    expect(changes.get('card' as ObjectId)).toMatchObject({ showName: false });
  });

  it('walks nothing for a move within the same parent', () => {
    const after = [OUTER, { ...GROUP, x: 50 }, CARD, SHOWN, NOTE];
    const raw = changesOf(after, ['group']);
    expect(withResolvedFrameNames(raw, hierarchyOf(BEFORE)).updated).toBe(raw.updated);
  });

  it('survives a parent cycle in the hierarchy', () => {
    const hierarchy = hierarchyOf(BEFORE);
    hierarchy.setParent('group' as ObjectId, 'card' as ObjectId);
    const changes = withResolvedFrameNames(changesOf(BEFORE, ['group']), hierarchy);
    expect(changes.updated).toEqual(['group', 'card']);
  });

  it('returns a root move batch as it is', () => {
    const raw = markRootMoveChanges(changesOf(BEFORE, ['outer']));
    expect(withResolvedFrameNames(raw, hierarchyOf(BEFORE))).toBe(raw);
  });
});
