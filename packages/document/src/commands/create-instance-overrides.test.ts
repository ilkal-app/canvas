// `createInstance` with `overrides` (rule 12): placement and overrides are one command,
// so one transaction and one undo step, and every path is checked as `setInstanceOverride`
// checks it, with the same error codes.
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { codesOf, overridesOf } from './__fixtures__/component-fixtures.js';
import { createInstanceCommand } from './create-instance.js';

const GREEN: [number, number, number, number] = [0.2, 0.9, 0.2, 1];

describe('createInstance with overrides', () => {
  it('places the instance with its overrides stored', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    const overrides = { [noteId]: { text: 'Hi', color: GREEN }, [boxId]: { isHidden: true } };
    const { result } = applyCommand(store, createInstanceCommand, {
      componentId: mainId,
      x: 1000,
      y: 0,
      overrides,
    });
    expect(mustGet(store, result.instanceId)).toMatchObject({ type: 'instance', mainId });
    expect(overridesOf(store, result.instanceId)).toEqual(overrides);
  });

  it('stores no overrides when none are given', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const { result } = applyCommand(store, createInstanceCommand, {
      componentId: mainId,
      x: 0,
      y: 0,
    });
    expect(overridesOf(store, result.instanceId)).toEqual({});
  });

  it('takes a nested path through an instance inside the main', () => {
    const store = new YjsDocumentStore();
    const outer = seedMainWithChildren(store, { prefix: 'outer' }).mainId;
    const leafId = seedLeafMain(store, 'main-leaf', { x: 1000, y: 1000 });
    const nested = placeInstance(store, 'main-leaf', {
      x: 120,
      y: 280,
      parentId: outer,
      instanceId: 'nested',
    });
    const overrides = { [`${nested}/${leafId}`]: { color: GREEN } };
    const { result } = applyCommand(store, createInstanceCommand, {
      componentId: outer,
      x: 2000,
      y: 0,
      overrides,
    });
    expect(overridesOf(store, result.instanceId)).toEqual(overrides);
  });

  it('refuses a path outside the main as invalid-override-path, writing nothing', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: mainId,
      x: 0,
      y: 0,
      overrides: { nowhere: { text: 'Hi' } },
    });
    expect(codesOf(errors)).toEqual(['invalid-override-path']);
    expect(errors[0]?.path).toEqual(['overrides', 'nowhere']);
  });

  it('refuses a nested path whose first part is not an instance', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: mainId,
      x: 0,
      y: 0,
      overrides: { [`${boxId}/${noteId}`]: { text: 'Hi' } },
    });
    expect(codesOf(errors)).toEqual(['invalid-override-path']);
  });

  it('refuses a field the child’s type does not take as invalid-override', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId, captionId } = seedMainWithChildren(store);
    // A rectangle has no sticky colour; a text has no fill.
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: mainId,
      x: 0,
      y: 0,
      overrides: { [boxId]: { color: GREEN }, [captionId]: { fill: GREEN } },
    });
    expect(codesOf(errors)).toEqual(['invalid-override', 'invalid-override']);
    expect(errors.map(({ path }) => path)).toEqual([
      ['overrides', boxId],
      ['overrides', captionId],
    ]);
  });

  it('refuses a malformed record before validating, as the schema does', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: mainId,
      x: 0,
      y: 0,
      overrides: { [noteId]: {} },
    });
    expect(codesOf(errors)).toEqual(['invalid-input']);
  });

  it('still refuses a missing main before reading overrides', () => {
    const store = new YjsDocumentStore();
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: 'no-such-main',
      x: 0,
      y: 0,
      overrides: { anything: { text: 'Hi' } },
    });
    expect(codesOf(errors)).toEqual(['missing-main']);
  });

  it('is one undo step: undo leaves neither the instance nor its overrides behind', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const before = new Map(store.read().objects);
    const history = createHistory(store, ADA.principalId);
    const { result } = applyCommand(store, createInstanceCommand, {
      componentId: mainId,
      x: 1000,
      y: 0,
      overrides: { [noteId]: { text: 'Hi' } },
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(store.get(result.instanceId)).toBeUndefined();
    expect(new Map(store.read().objects)).toEqual(before);
    expect(history.redo()).toBe(true);
    expect(overridesOf(store, result.instanceId)).toEqual({ [noteId]: { text: 'Hi' } });
    history.destroy();
  });
});
