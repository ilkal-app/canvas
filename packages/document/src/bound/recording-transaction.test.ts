import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  applyCommand,
  mustGet,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { previewCommand } from '../commands/preview-command.js';
import { ADA, BODY, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentTransaction } from '../store/document-store.js';

import { RecordingTransaction } from './recording-transaction.js';

describe('RecordingTransaction', () => {
  it('records patches, whole objects, deletions and network members as the store would', () => {
    const store = createFixtureStore();
    const recording = new RecordingTransaction(store, ADA);
    recording.patchObject(id('shape-box'), { x: 7 });
    recording.patchObject(id('shape-box'), { y: 8 });
    expect(recording.get(id('shape-box'))).toMatchObject({ x: 7, y: 8 });
    expect(recording.deleteObject(id('sticky-idea'))).toBe(true);
    expect(recording.get(id('sticky-idea'))).toBeUndefined();
    expect(recording.deleteObject(id('sticky-idea'))).toBe(false);
    recording.setVertex(id('path-squiggle'), { id: 'v1', x: 50, y: 0, mirror: 'none' });
    recording.setVertex(id('path-squiggle'), { id: 'v9', x: 5, y: 5, mirror: 'none' });
    expect(recording.deleteVertex(id('path-squiggle'), 'v2')).toBe(true);
    recording.setSegment(id('path-squiggle'), {
      id: 's9',
      a: 'v1',
      b: 'v9',
      ha: { x: 0, y: 0 },
      hb: { x: 0, y: 0 },
    });
    expect(recording.deleteSegment(id('path-squiggle'), 'gone')).toBe(false);
    const path = recording.get(id('path-squiggle'));
    if (path?.type !== 'path') throw new Error('not a path');
    expect(path.vertices.map(({ id: key, x }) => [key, x])).toEqual([
      ['v1', 50],
      ['v3', 200],
      ['v9', 5],
    ]);
    expect(path.segments.map(({ id: key }) => key)).toEqual(['s1', 's2', 's9']);
    const transaction: DocumentTransaction = recording;
    expect(transaction.origin).toBe(ADA);
    transaction.insertText(id('text-title'), 0, 'x', BODY);
    transaction.deleteText(id('text-title'), 0, 1);
    transaction.formatText(id('text-title'), 0, 1, { italic: true });
    expect(recording.written.get(id('text-title'))).toBe(store.get(id('text-title')));
    expect([...recording.written.keys()].sort()).toEqual(
      ['path-squiggle', 'shape-box', 'sticky-idea', 'text-title'].sort(),
    );
    expect(() => {
      recording.patchObject('nowhere' as ObjectId, { x: 1 });
    }).toThrow(RangeError);
  });
});

describe('previewCommand', () => {
  it('says what a command would write and writes nothing', () => {
    const store = createFixtureStore();
    const before = store.encodeState();
    const move = { moves: [{ id: 'image-photo', by: { x: 5, y: 0 } }] };
    const preview = previewCommand(store, ADA, moveObjectsCommand, move, testEnvironment());
    expect(store.encodeState()).toEqual(before);
    if (preview.status !== 'planned') throw new Error('refused');
    const written = preview.written.get(id('image-photo'));
    expect(written).toMatchObject({ x: mustGet(store, 'image-photo').x + 5 });
    applyCommand(store, moveObjectsCommand, move);
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: written?.x });
  });

  it('returns the errors of an input or a validation that refuses the command', () => {
    const store = createFixtureStore();
    expect(
      previewCommand(store, ADA, moveObjectsCommand, { moves: [] }, testEnvironment()),
    ).toMatchObject({ status: 'rejected', errors: [{ code: 'invalid-input' }] });
    expect(
      previewCommand(
        store,
        ADA,
        moveObjectsCommand,
        { moves: [{ id: 'nowhere', by: { x: 1, y: 0 } }] },
        testEnvironment(),
      ),
    ).toMatchObject({ status: 'rejected', errors: [{ code: 'missing-object' }] });
  });
});
