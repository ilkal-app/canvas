// Acceptance: instance overrides
// (`setInstanceOverride`, `resetInstanceOverrides`), child constraints (`setConstraints`), what a
// resize of a component, a frame and an instance writes, and asset retention through overrides.
import { describe, expect, it } from 'vitest';

import { listAssetIds } from '../assets/list-asset-ids.js';
import { BODY, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  CARD_CHILD_BOXES,
  createChild,
  newFrame,
  newRectangle,
  newSticky,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import {
  codesOf,
  fieldOf,
  mustFindCommand,
  overridesOf,
} from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';

const NOTE_TEXT = { text: 'Hi' };
const NOTE_COLOR = { color: [0.5, 0.8, 1, 1] };

describe('setInstanceOverride', () => {
  it('merges fields into the path’s record', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const command = mustFindCommand('setInstanceOverride');
    const { result } = applyCommand(store, command, {
      id: instanceId,
      path: noteId,
      override: NOTE_TEXT,
    });
    expect(result).toEqual({ path: noteId });
    applyCommand(store, command, { id: instanceId, path: noteId, override: NOTE_COLOR });
    applyCommand(store, command, { id: instanceId, path: boxId, override: { fill: [0, 1, 0, 1] } });
    expect(overridesOf(store, instanceId)).toEqual({
      [noteId]: { ...NOTE_TEXT, ...NOTE_COLOR },
      [boxId]: { fill: [0, 1, 0, 1] },
    });
  });

  it('addresses a child inside a frame inside the main by the child’s id alone', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    createChild(store, newFrame('inner', mainId, { x: 200, y: 0, width: 200, height: 100 }));
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: boxId, by: { x: 0, y: 0 }, parentId: 'inner' }],
    });
    expect(mustGet(store, boxId).parentId).toBe('inner');
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const command = mustFindCommand('setInstanceOverride');
    applyCommand(store, command, { id: instanceId, path: boxId, override: { fill: [0, 0, 1, 1] } });
    expect(overridesOf(store, instanceId)).toEqual({ [boxId]: { fill: [0, 0, 1, 1] } });
    // Since a path may walk the layers, a step naming a child by id: the frame on the way
    // is read and left out, so the record is stored at the box's id path.
    applyCommand(store, command, {
      id: instanceId,
      path: `inner/${boxId}`,
      override: { fill: [1, 0, 0, 1] },
    });
    expect(overridesOf(store, instanceId)).toEqual({ [boxId]: { fill: [1, 0, 0, 1] } });
  });

  it('refuses a path outside the main, a field the child does not take, a non-instance and a virtual id', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    createChild(store, newSticky('loose', null, { x: 900, y: 900, width: 100, height: 100 }));
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const command = mustFindCommand('setInstanceOverride');
    const refuse = (input: Record<string, unknown>) =>
      codesOf(expectRejected(store, command, { id: instanceId, path: noteId, ...input }));
    expect(refuse({ path: 'loose', override: NOTE_COLOR })).toEqual(['invalid-override-path']);
    expect(refuse({ path: 'nobody', override: NOTE_COLOR })).toEqual(['invalid-override-path']);
    expect(refuse({ override: { fill: [0, 1, 0, 1] } })).toEqual(['invalid-override']);
    // Outside the ticket's override scope: widths and structure stay the main's. (made
    // `runs` beside `text` overridable; its own acceptance pins that and the refusals.)
    for (const outside of [
      { stroke: { color: [1, 0, 0, 1], width: 4 } },
      { label: { text: 'B', runs: [{ length: 1, style: BODY }] } },
      { fontSize: 40 },
      // A child's box became a record field with; its rotation still is not.
      { rotation: 10 },
    ]) {
      expect(refuse({ override: { text: 'Hi', ...outside } })).toEqual(['invalid-input']);
    }
    expect(refuse({ id: 'loose', override: NOTE_COLOR })).toEqual(['unsupported-type']);
    // A virtual id is not an object id: the existing strict id boundary refuses it at parsing.
    expect(refuse({ id: `${instanceId}/${noteId}`, override: NOTE_COLOR })).toEqual([
      'invalid-input',
    ]);
  });
});

describe('resetInstanceOverrides', () => {
  it('clears every record, one record, or only the fields given', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const set = mustFindCommand('setInstanceOverride');
    const reset = mustFindCommand('resetInstanceOverrides');
    const fill = (target: YjsDocumentStore) => {
      applyCommand(target, set, { id: instanceId, path: noteId, override: NOTE_TEXT });
      applyCommand(target, set, { id: instanceId, path: noteId, override: NOTE_COLOR });
      applyCommand(target, set, { id: instanceId, path: boxId, override: { fill: [0, 1, 0, 1] } });
    };
    fill(store);
    const fields = applyCommand(store, reset, { id: instanceId, path: noteId, fields: ['color'] });
    expect(fields.result).toEqual({ paths: [noteId] });
    expect(overridesOf(store, instanceId)).toEqual({
      [noteId]: NOTE_TEXT,
      [boxId]: { fill: [0, 1, 0, 1] },
    });
    const one = applyCommand(store, reset, { id: instanceId, path: boxId });
    expect(one.result).toEqual({ paths: [boxId] });
    expect(overridesOf(store, instanceId)).toEqual({ [noteId]: NOTE_TEXT });
    fill(store);
    const all = applyCommand(store, reset, { id: instanceId });
    expect((all.result as { paths: string[] }).paths.sort()).toEqual([boxId, noteId].sort());
    expect(overridesOf(store, instanceId)).toEqual({});
  });
});

describe('setConstraints', () => {
  it('writes constraints on a child of a component and of a frame', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    createChild(store, newFrame('frame-f', null, { x: 1000, y: 0, width: 600, height: 600 }));
    createChild(
      store,
      newRectangle('in-frame', 'frame-f', { x: 10, y: 10, width: 100, height: 50 }),
    );
    const { result, changes } = applyCommand(store, mustFindCommand('setConstraints'), {
      ids: [boxId, 'in-frame'],
      x: 'stretch',
      y: 'end',
    });
    expect(result).toEqual({ updatedIds: [boxId, 'in-frame'] });
    expect(changes.updated).toEqual([boxId, 'in-frame'].sort());
    expect(fieldOf(store, boxId, 'constraints')).toEqual({ x: 'stretch', y: 'end' });
    expect(fieldOf(store, 'in-frame', 'constraints')).toEqual({ x: 'stretch', y: 'end' });
    expect(mustGet(store, mainId)).toMatchObject({ type: 'component' });
  });

  it('refuses a root object and a child of a group', () => {
    const store = createFixtureStore();
    const command = mustFindCommand('setConstraints');
    expect(codesOf(expectRejected(store, command, { ids: ['frame-plan'], x: 'end' }))).toEqual([
      'invalid-parent',
    ]);
    expect(codesOf(expectRejected(store, command, { ids: ['shape-box'], y: 'end' }))).toEqual([
      'invalid-parent',
    ]);
  });

  it('keeps the other axis when one is omitted', () => {
    const store = new YjsDocumentStore();
    const { boxId } = seedMainWithChildren(store);
    const command = mustFindCommand('setConstraints');
    applyCommand(store, command, { ids: [boxId], x: 'stretch' });
    expect(fieldOf(store, boxId, 'constraints')).toEqual({ x: 'stretch', y: 'start' });
    applyCommand(store, command, { ids: [boxId], y: 'end' });
    expect(fieldOf(store, boxId, 'constraints')).toEqual({ x: 'stretch', y: 'end' });
    applyCommand(store, command, { ids: [boxId], x: 'center' });
    expect(fieldOf(store, boxId, 'constraints')).toEqual({ x: 'center', y: 'end' });
  });
});

describe('resizeObjects with constraints', () => {
  it('rewrites a component’s children by their constraints in the same transaction', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setConstraints'), { ids: [boxId], x: 'stretch' });
    const { changes } = applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: mainId, to: { width: 600, height: 450 } }],
    });
    expect(changes.updated).toEqual([boxId, mainId].sort());
    expect(mustGet(store, mainId)).toMatchObject({ width: 600, height: 450 });
    // The stretch child keeps both insets (200 from the left, 0 from the right); start children stay.
    expect(mustGet(store, boxId)).toMatchObject({ x: 200, y: 0, width: 400, height: 100 });
    expect(mustGet(store, noteId)).toMatchObject(CARD_CHILD_BOXES.note);
  });

  it('rewrites a frame’s children by their constraints', () => {
    const store = new YjsDocumentStore();
    createChild(store, newFrame('frame-f', null, { x: 0, y: 0, width: 400, height: 300 }));
    createChild(
      store,
      newRectangle('stretchy', 'frame-f', { x: 200, y: 0, width: 200, height: 100 }),
    );
    createChild(
      store,
      newRectangle('pinned', 'frame-f', { x: 0, y: 200, width: 100, height: 100 }),
    );
    applyCommand(store, mustFindCommand('setConstraints'), { ids: ['stretchy'], x: 'stretch' });
    const { changes } = applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'frame-f', to: { width: 600, height: 450 } }],
    });
    expect(changes.updated).toEqual(['frame-f', 'stretchy']);
    expect(mustGet(store, 'stretchy')).toMatchObject({ x: 200, y: 0, width: 400, height: 100 });
    expect(mustGet(store, 'pinned')).toMatchObject({ x: 0, y: 200, width: 100, height: 100 });
  });

  it('writes only the instance when an instance is resized', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setConstraints'), { ids: [boxId], x: 'stretch' });
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const { changes } = applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: instanceId, to: { width: 800, height: 600 } }],
    });
    expect(changes.updated).toEqual([instanceId]);
    expect(mustGet(store, instanceId)).toMatchObject({ width: 800, height: 600 });
    expect(mustGet(store, boxId)).toMatchObject(CARD_CHILD_BOXES.box);
  });
});

describe('asset retention through overrides', () => {
  it('lists an asset that appears only in an override, also once the main is retired', () => {
    const store = new YjsDocumentStore();
    const { mainId, photoId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    expect(listAssetIds(store.encodeState())).toEqual(['asset-photo']);
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: photoId,
      override: {
        assetId: 'asset-override',
        naturalSize: { width: 400, height: 400 },
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    });
    expect(listAssetIds(store.encodeState())).toEqual(['asset-override', 'asset-photo']);
    // Retiring the main detaches the instance: the override's asset lives on in the detached
    // copy, and the retained definition still lists its own.
    applyCommand(store, deleteObjectsCommand, { ids: [mainId] });
    expect(fieldOf(store, mainId, 'retired')).toBe(true);
    expect(listAssetIds(store.encodeState())).toEqual(['asset-override', 'asset-photo']);
    // An asset only in the retained definition: the detached copy is deleted, the main stays.
    applyCommand(store, deleteObjectsCommand, { ids: [instanceId] });
    expect(listAssetIds(store.encodeState())).toEqual(['asset-photo']);
  });
});
