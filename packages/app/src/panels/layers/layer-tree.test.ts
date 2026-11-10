import { describe, expect, it, vi } from 'vitest';

import {
  bringToFrontCommand,
  createObjectCommand,
  deleteObjectsCommand,
  runCommand,
  setStyleCommand,
  type AnyCommand,
  type ChangeSet,
} from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from '../../engine/demo-document.js';

import { buildLayerRows, isContainer, layerNameOf } from './layer-rows.js';
import { LayerTree } from './layer-tree.js';

const SECTIONS = ['section-3', 'section-2', 'section-1', 'section-0'];
const SECTION_0 = 'section-0' as ObjectId;
const MARKER = 'section-0-rect-0-0' as ObjectId;
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'new-shape' as ObjectId };

function setUp() {
  const store = createDemoDocument();
  const tree = new LayerTree(store);
  const changes: ChangeSet[] = [];
  store.subscribe((change) => {
    changes.push(change);
    tree.applyChanges(change);
  });
  const run = (command: AnyCommand, input: unknown) => {
    const outcome = runCommand(store, LOCAL_USER_ORIGIN, command, input, ENVIRONMENT);
    expect(outcome.status).toBe('applied');
  };
  return { store, tree, run, changes };
}

const ids = (tree: LayerTree) => tree.rows().map((row) => row.id);

describe('buildLayerRows', () => {
  it('lists the root top first, with levels, places and expansion', () => {
    const store = createDemoDocument();
    const rows = buildLayerRows(store, new Set([SECTION_0]));
    expect(rows.slice(0, 4).map((row) => row.id)).toEqual([...SECTIONS.slice(0, 3), SECTION_0]);
    expect(rows[3]).toMatchObject({
      name: 'Section 1',
      level: 1,
      positionInSet: 4,
      setSize: 4,
      hasChildren: true,
      isExpanded: true,
      parentId: null,
    });
    expect(rows[4]).toMatchObject({
      level: 2,
      parentId: SECTION_0,
      setSize: 70,
      hasChildren: false,
    });
    expect(rows[4]?.id).toBe('section-0-rect-9-6');
    expect(rows.at(-1)?.id).toBe(MARKER);
    expect(rows).toHaveLength(4 + 70);
  });
});

describe('layerNameOf and isContainer', () => {
  const object = (fields: Record<string, unknown>) => fields as unknown as BoardObject;

  it("names objects by their frame name, text's first line, shape kind or type", () => {
    expect(layerNameOf(object({ type: 'frame', name: '  Plan ' }))).toBe('Plan');
    expect(layerNameOf(object({ type: 'frame', name: '' }))).toBe('Frame');
    expect(layerNameOf(object({ type: 'component', name: 'Card' }))).toBe('Card');
    expect(layerNameOf(object({ type: 'component', name: ' ' }))).toBe('Component');
    expect(layerNameOf(object({ type: 'text', text: 'Hello\nworld' }))).toBe('Hello');
    expect(layerNameOf(object({ type: 'sticky', text: '   ' }))).toBe('Sticky note');
    expect(layerNameOf(object({ type: 'text', text: 'x'.repeat(50) }))).toBe(`${'x'.repeat(39)}…`);
    expect(layerNameOf(object({ type: 'shape', kind: 'ellipse' }))).toBe('Ellipse');
    expect(layerNameOf(object({ type: 'path' }))).toBe('Path');
  });

  it('prefers any object’s own layer name, trimmed, over its derived label', () => {
    expect(layerNameOf(object({ type: 'text', text: 'Hello', name: ' Headline ' }))).toBe(
      'Headline',
    );
    expect(layerNameOf(object({ type: 'shape', kind: 'rectangle', name: 'Card bg' }))).toBe(
      'Card bg',
    );
    expect(layerNameOf(object({ type: 'group', name: 'Icon' }))).toBe('Icon');
    expect(layerNameOf(object({ type: 'shape', kind: 'ellipse', name: '  ' }))).toBe('Ellipse');
  });

  it('counts frames and groups as containers', () => {
    expect(isContainer(object({ type: 'frame' }))).toBe(true);
    expect(isContainer(object({ type: 'group' }))).toBe(true);
    expect(isContainer(object({ type: 'shape' }))).toBe(false);
  });
});

describe('LayerTree', () => {
  it('starts collapsed, expands and collapses, and reports each change once', () => {
    const { tree } = setUp();
    const listener = vi.fn();
    tree.subscribe(listener);
    expect(ids(tree)).toEqual(SECTIONS);
    tree.setExpanded([SECTION_0], true);
    tree.setExpanded([SECTION_0], true);
    expect(tree.rows()).toHaveLength(74);
    expect(tree.indexOf(MARKER)).toBe(73);
    tree.setExpanded([SECTION_0], false);
    expect(ids(tree)).toEqual(SECTIONS);
    expect(tree.indexOf(MARKER)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(tree.version()).toBe(3);
  });

  it('reveals an object by expanding its ancestors, and does nothing when it is listed', () => {
    const { tree } = setUp();
    tree.reveal(MARKER);
    expect(tree.indexOf(MARKER)).toBe(73);
    const version = tree.version();
    tree.reveal(MARKER);
    tree.reveal(SECTION_0);
    expect(tree.version()).toBe(version);
  });

  it('follows a reorder: the object moves to the top of its siblings', () => {
    const { tree, run } = setUp();
    tree.setExpanded([SECTION_0], true);
    run(bringToFrontCommand, { ids: [MARKER] });
    expect(tree.indexOf(MARKER)).toBe(4);
    run(bringToFrontCommand, { ids: [SECTION_0] });
    expect(ids(tree)[0]).toBe(SECTION_0);
  });

  it('follows creation and deletion', () => {
    const { tree, run } = setUp();
    const shape = {
      type: 'shape',
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      width: 10,
      height: 10,
      kind: 'ellipse',
      stroke: null,
      fill: null,
      cornerRadius: 0,
      sides: 3,
      label: null,
    };
    run(createObjectCommand, { object: shape });
    expect(tree.rows()[0]).toMatchObject({ id: 'new-shape', name: 'Ellipse' });
    run(deleteObjectsCommand, { ids: ['new-shape', 'section-3'] });
    expect(ids(tree)).toEqual(SECTIONS.slice(1));
  });

  it('patches a lock or a rename in place, and ignores a restyle or a move', () => {
    const { store, tree, run } = setUp();
    const listener = vi.fn();
    tree.subscribe(listener);
    const rows = tree.rows();
    run(setStyleCommand, { changes: [{ id: SECTION_0, style: { clip: true } }] });
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(MARKER, { x: 500 });
    });
    expect(tree.rows()).toBe(rows);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(SECTION_0, { locked: true, name: 'Renamed' });
    });
    expect(tree.rows()[3]).toMatchObject({ id: SECTION_0, isLocked: true, name: 'Renamed' });
    expect(tree.rows()[0]).toBe(rows[0]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const { tree } = setUp();
    const listener = vi.fn();
    tree.subscribe(listener)();
    tree.setExpanded([SECTION_0], true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('queues change sets for its scheduled pass, and drops them when disposed', () => {
    const store = createDemoDocument();
    const cancelled: string[] = [];
    let flush: (() => void) | undefined;
    const tree = new LayerTree(store, {
      scheduleFrame: (callback) => {
        flush = callback;
        return () => {
          cancelled.push('frame');
        };
      },
    });
    const changes: ChangeSet = {
      origin: LOCAL_USER_ORIGIN,
      isLocal: false,
      created: [],
      updated: [],
      deleted: ['section-3' as ObjectId],
    };
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.deleteObject('section-3' as ObjectId);
    });
    tree.queueChanges(changes);
    tree.queueChanges(changes);
    expect(ids(tree)).toEqual(SECTIONS);
    flush?.();
    expect(ids(tree)).toEqual(SECTIONS.slice(1));
    tree.queueChanges(changes);
    tree.dispose();
    expect(cancelled).toEqual(['frame']);
    const unscheduled = new LayerTree(store);
    unscheduled.queueChanges(changes);
    expect(ids(unscheduled)).toEqual(SECTIONS.slice(1));
  });

  it('skips ids it cannot read', () => {
    const { tree } = setUp();
    const rows = tree.rows();
    tree.applyChanges({
      origin: LOCAL_USER_ORIGIN,
      isLocal: true,
      created: [],
      updated: ['gone' as ObjectId],
      deleted: [],
    });
    expect(tree.rows()).toBe(rows);
  });
});
