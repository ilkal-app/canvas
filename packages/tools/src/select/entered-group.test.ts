import { describe, expect, it } from 'vitest';

import {
  frame,
  group,
  id,
  mapSource,
  rect,
  selectBoardObjects,
} from './__fixtures__/select-board.js';
import {
  enteredScopeIds,
  isInsideEnteredGroup,
  outerGroupOf,
  scopeOfTarget,
} from './entered-group.js';
import { selectTargetOf } from './selection-geometry.js';

// The fixture: group-g at the root holds rect-d and group-h, which holds rect-e. Added here:
// group-x inside frame-f holds rect-x, and group-f, the root group, holds frame-inside, whose
// child group-y holds rect-y (a frame breaks a chain of groups).
const SOURCE = mapSource([
  ...selectBoardObjects(),
  group('group-x', 'frame-f', 100, 100),
  rect('rect-x', 'group-x', { x: 0, y: 0, width: 10, height: 10 }),
  group('group-f', null, 1000, 1000),
  frame('frame-inside', 'group-f', { x: 0, y: 0, width: 200, height: 200 }),
  group('group-y', 'frame-inside', 10, 10),
  rect('rect-y', 'group-y', { x: 0, y: 0, width: 10, height: 10 }),
]);

const G = id('group-g');
const H = id('group-h');
const D = id('rect-d');
const E = id('rect-e');

describe('selectTargetOf with an entered group', () => {
  it('selects the outermost group when nothing is entered, as before', () => {
    expect(selectTargetOf(E, SOURCE)).toBe(G);
    expect(selectTargetOf(D, SOURCE, null)).toBe(G);
    expect(selectTargetOf(id('rect-x'), SOURCE)).toBe(id('group-x'));
  });

  it('selects the object at the entered level, a nested group whole', () => {
    expect(selectTargetOf(D, SOURCE, G)).toBe(D);
    expect(selectTargetOf(E, SOURCE, G)).toBe(H);
    expect(selectTargetOf(E, SOURCE, H)).toBe(E);
  });

  it('selects at an outer entered level for an object outside the inner entered group', () => {
    // group-h is entered, so group-g is too: rect-d is at group-g's level.
    expect(selectTargetOf(D, SOURCE, H)).toBe(D);
  });

  it('ignores the entered group for objects under other groups', () => {
    expect(selectTargetOf(id('rect-x'), SOURCE, G)).toBe(id('group-x'));
  });

  it('stops at a frame, which breaks a chain of groups', () => {
    expect(selectTargetOf(id('rect-y'), SOURCE)).toBe(id('group-y'));
    expect(selectTargetOf(id('rect-y'), SOURCE, id('group-y'))).toBe(id('rect-y'));
  });
});

describe('scopeOfTarget', () => {
  it('is the entered level a target sits at, or none outside the entered chain', () => {
    expect(scopeOfTarget(D, SOURCE, G)).toBe(G);
    expect(scopeOfTarget(H, SOURCE, G)).toBe(G);
    expect(scopeOfTarget(E, SOURCE, H)).toBe(H);
    // A click on rect-d with group-h entered leaves group-h for group-g.
    expect(scopeOfTarget(D, SOURCE, H)).toBe(G);
    expect(scopeOfTarget(id('rect-a'), SOURCE, G)).toBeNull();
    expect(scopeOfTarget(G, SOURCE, null)).toBeNull();
  });
});

describe('outerGroupOf', () => {
  it('is the group one level up, or none at a group directly in a frame or the root', () => {
    expect(outerGroupOf(H, SOURCE)).toBe(G);
    expect(outerGroupOf(G, SOURCE)).toBeNull();
    expect(outerGroupOf(id('group-y'), SOURCE)).toBeNull();
    expect(outerGroupOf(null, SOURCE)).toBeNull();
  });
});

describe('enteredScopeIds', () => {
  it('lists the entered group’s children, or nothing when no group is entered', () => {
    expect([...(enteredScopeIds(G, SOURCE) ?? [])].sort()).toEqual([H, D].sort());
    expect(enteredScopeIds(null, SOURCE)).toBeUndefined();
    expect(enteredScopeIds(id('gone'), SOURCE)).toBeUndefined();
  });
});

describe('isInsideEnteredGroup', () => {
  it('holds anything under the entered group, and everything when none is entered', () => {
    expect(isInsideEnteredGroup(E, G, SOURCE)).toBe(true);
    expect(isInsideEnteredGroup(H, G, SOURCE)).toBe(true);
    expect(isInsideEnteredGroup(G, G, SOURCE)).toBe(false);
    expect(isInsideEnteredGroup(id('rect-a'), G, SOURCE)).toBe(false);
    expect(isInsideEnteredGroup(id('rect-a'), null, SOURCE)).toBe(true);
  });
});
