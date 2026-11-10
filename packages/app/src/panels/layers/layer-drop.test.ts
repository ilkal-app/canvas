import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { layerDropAt, layerKeyPlacement, movableLayerIds } from './layer-drop.js';
import type { LayerRow } from './layer-rows.js';

function row(id: string, parentId: string | null, level: number, fields: Partial<LayerRow> = {}) {
  return {
    id: id as ObjectId,
    type: 'shape',
    name: id,
    parentId: parentId as ObjectId | null,
    level,
    positionInSet: 1,
    setSize: 1,
    hasChildren: false,
    isExpanded: false,
    isLocked: false,
    isHidden: false,
    ...fields,
  } satisfies LayerRow;
}

// 0 frame (expanded) > 1 group (expanded) > 2 leaf, 3 leaf-2; 4 sibling (in frame);
// 5 closed (collapsed frame); 6 locked (empty frame, locked); 7 shape; 8 bottom.
const ROWS: readonly LayerRow[] = [
  row('frame', null, 1, { type: 'frame', hasChildren: true, isExpanded: true }),
  row('group', 'frame', 2, { type: 'group', hasChildren: true, isExpanded: true }),
  row('leaf', 'group', 3),
  row('leaf-2', 'group', 3),
  row('sibling', 'frame', 2),
  row('closed', null, 1, { type: 'frame', hasChildren: true }),
  row('locked', null, 1, { type: 'frame', isLocked: true }),
  row('shape', null, 1),
  row('bottom', null, 1),
];

const ids = (...values: string[]) => new Set(values as ObjectId[]);

describe('layerDropAt', () => {
  it('drops above a row: directly below the sibling above it, or on top', () => {
    expect(layerDropAt(ROWS, ids('bottom'), 7, 0.1)).toEqual({
      parentId: null,
      belowId: 'locked',
      indicator: { kind: 'line', index: 7, level: 1 },
    });
    expect(layerDropAt(ROWS, ids('bottom'), 0, 0.1)).toEqual({
      parentId: null,
      indicator: { kind: 'line', index: 0, level: 1 },
    });
    // The sibling above `sibling` is `group`, past the group's own children.
    expect(layerDropAt(ROWS, ids('bottom'), 4, 0.2)).toEqual({
      parentId: 'frame',
      belowId: 'group',
      indicator: { kind: 'line', index: 4, level: 2 },
    });
  });

  it('skips dragged siblings when it looks for the one above', () => {
    expect(layerDropAt(ROWS, ids('shape'), 8, 0.1)).toEqual({
      parentId: null,
      belowId: 'locked',
      indicator: { kind: 'line', index: 8, level: 1 },
    });
  });

  it('drops below a row: directly below it, as its own sibling', () => {
    expect(layerDropAt(ROWS, ids('frame'), 7, 0.9)).toEqual({
      parentId: null,
      belowId: 'shape',
      indicator: { kind: 'line', index: 8, level: 1 },
    });
    expect(layerDropAt(ROWS, ids('shape'), 3, 0.6)).toEqual({
      parentId: 'group',
      belowId: 'leaf-2',
      indicator: { kind: 'line', index: 4, level: 3 },
    });
  });

  it('drops below an open container: on top of its children', () => {
    expect(layerDropAt(ROWS, ids('shape'), 1, 0.9)).toEqual({
      parentId: 'group',
      indicator: { kind: 'line', index: 2, level: 3 },
    });
  });

  it('drops onto the middle of a frame or group: into it, on top', () => {
    expect(layerDropAt(ROWS, ids('shape'), 5, 0.5)).toEqual({
      parentId: 'closed',
      indicator: { kind: 'into', index: 5 },
    });
    expect(layerDropAt(ROWS, ids('shape'), 1, 0.4)).toEqual({
      parentId: 'group',
      indicator: { kind: 'into', index: 1 },
    });
  });

  it('drops past the last row at the bottom of the root', () => {
    expect(layerDropAt(ROWS, ids('leaf'), 12, 0.5)).toEqual({
      parentId: null,
      belowId: 'bottom',
      indicator: { kind: 'line', index: 9, level: 1 },
    });
  });

  it('refuses a locked container, and a target inside the dragged objects', () => {
    expect(layerDropAt(ROWS, ids('shape'), 6, 0.5)).toEqual({
      parentId: 'locked',
      indicator: { kind: 'into', index: 6 },
      refusal: '“locked” is locked',
    });
    expect(layerDropAt(ROWS, ids('frame'), 2, 0.9)).toMatchObject({
      parentId: 'group',
      refusal: 'Objects cannot go inside themselves',
    });
    expect(layerDropAt(ROWS, ids('group'), 1, 0.5)).toMatchObject({
      parentId: 'group',
      refusal: 'Objects cannot go inside themselves',
    });
  });

  it('drops nothing next to a dragged row itself', () => {
    expect(layerDropAt(ROWS, ids('shape'), 7, 0.9)).toBeUndefined();
    expect(layerDropAt(ROWS, ids('shape'), 7, 0.1)).toBeUndefined();
    expect(layerDropAt([], ids('shape'), 0, 0.5)).toBeUndefined();
  });
});

describe('layerKeyPlacement', () => {
  it('Alt+Up moves above the sibling above; nothing at the top', () => {
    expect(layerKeyPlacement(ROWS, 8, 'ArrowUp', ids('bottom'))).toEqual({
      parentId: null,
      belowId: 'locked',
    });
    expect(layerKeyPlacement(ROWS, 4, 'ArrowUp', ids('sibling'))).toEqual({ parentId: 'frame' });
    expect(layerKeyPlacement(ROWS, 0, 'ArrowUp', ids('frame'))).toBeUndefined();
  });

  it('Alt+Down moves below the sibling below, past its children; nothing at the bottom', () => {
    expect(layerKeyPlacement(ROWS, 1, 'ArrowDown', ids('group'))).toEqual({
      parentId: 'frame',
      belowId: 'sibling',
    });
    expect(layerKeyPlacement(ROWS, 0, 'ArrowDown', ids('frame'))).toEqual({
      parentId: null,
      belowId: 'closed',
    });
    expect(layerKeyPlacement(ROWS, 8, 'ArrowDown', ids('bottom'))).toBeUndefined();
  });

  it('Alt+Left moves out of the parent, above it; nothing at the root', () => {
    expect(layerKeyPlacement(ROWS, 2, 'ArrowLeft', ids('leaf'))).toEqual({
      parentId: 'frame',
    });
    expect(layerKeyPlacement(ROWS, 4, 'ArrowLeft', ids('sibling'))).toEqual({ parentId: null });
    expect(layerKeyPlacement(ROWS, 7, 'ArrowLeft', ids('shape'))).toBeUndefined();
  });

  it('Alt+Right moves into the frame or group above, on top; nothing under a leaf', () => {
    expect(layerKeyPlacement(ROWS, 4, 'ArrowRight', ids('sibling'))).toEqual({
      parentId: 'group',
    });
    expect(layerKeyPlacement(ROWS, 7, 'ArrowRight', ids('shape'))).toEqual({ parentId: 'locked' });
    expect(layerKeyPlacement(ROWS, 8, 'ArrowRight', ids('bottom'))).toBeUndefined();
    expect(layerKeyPlacement(ROWS, 2, 'Enter', ids('leaf'))).toBeUndefined();
  });
});

// A main (`component`) is a container like a frame; an instance is a leaf (ruling 14).
const COMPONENT_ROWS: readonly LayerRow[] = [
  row('main', null, 1, { type: 'component', hasChildren: true }),
  row('instance', null, 1, { type: 'instance' }),
  row('loose', null, 1),
];

describe('mains and instances', () => {
  it('drops onto the middle of a main: into it, on top', () => {
    expect(layerDropAt(COMPONENT_ROWS, ids('loose'), 0, 0.5)).toEqual({
      parentId: 'main',
      indicator: { kind: 'into', index: 0 },
    });
  });

  it('drops beside an instance, never into it', () => {
    expect(layerDropAt(COMPONENT_ROWS, ids('loose'), 1, 0.4)).toEqual({
      parentId: null,
      belowId: 'main',
      indicator: { kind: 'line', index: 1, level: 1 },
    });
    expect(layerDropAt(COMPONENT_ROWS, ids('loose'), 1, 0.5)).toEqual({
      parentId: null,
      belowId: 'instance',
      indicator: { kind: 'line', index: 2, level: 1 },
    });
    expect(layerDropAt(COMPONENT_ROWS, ids('loose'), 1, 0.6)).toEqual({
      parentId: null,
      belowId: 'instance',
      indicator: { kind: 'line', index: 2, level: 1 },
    });
  });

  it('Alt+Right moves into a main above, but not into an instance', () => {
    expect(layerKeyPlacement(COMPONENT_ROWS, 1, 'ArrowRight', ids('instance'))).toEqual({
      parentId: 'main',
    });
    expect(layerKeyPlacement(COMPONENT_ROWS, 2, 'ArrowRight', ids('loose'))).toBeUndefined();
  });
});

describe('movableLayerIds', () => {
  it('leaves out an object whose ancestor is listed too', () => {
    const parents = new Map<string, string | null>([
      ['frame', null],
      ['group', 'frame'],
      ['leaf', 'group'],
      ['shape', null],
    ]);
    const parentOf = (id: ObjectId) => parents.get(id) as ObjectId | null | undefined;
    expect(movableLayerIds(['leaf', 'shape', 'frame'] as ObjectId[], parentOf)).toEqual([
      'shape',
      'frame',
    ]);
  });
});
