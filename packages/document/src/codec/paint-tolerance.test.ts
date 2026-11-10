// The reader's tolerance of stored paints: a replay from
// storage or Redis passes no door, so a stored fill or background the schema refuses as a paint
// (`ink`, any other string, a number) reads as no fill, and the object, its outline and its label
// still read. The stored value itself is not rewritten. Real raw updates.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { RELAY, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { tolerateStoredPaints } from './paint-tolerance.js';

describe('a replayed fill or background the schema refuses', () => {
  it.each(['ink', 'red', 7, false])(
    'reads a shape fill of %j as no fill, keeping its outline and label, and stores it as is',
    (fill) => {
      const board = fixtureGateBoard();
      try {
        const update = rawUpdate(board, (objects) => {
          mergeGroup(objects, 'shape-box', 'style', { fill });
        });
        board.writer.applyUpdate(update, RELAY);
        const read = board.writer.read();
        const original = fixtureObject('shape-box', 'shape');
        expect(read.objects.get(original.id)).toMatchObject({
          type: 'shape',
          fill: null,
          stroke: original.stroke,
          label: original.label,
        });
        expect(read.issues).toEqual([]);
        // The stored value is the peer's, unchanged: only the read projection is tolerant.
        const stored = new Y.Doc();
        Y.applyUpdate(stored, board.writer.encodeState());
        const style = stored
          .getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME)
          .get('shape-box')
          ?.get('style');
        expect((style as Record<string, unknown>).fill).toEqual(fill);
        stored.destroy();
      } finally {
        board.hub.destroy();
        board.writer.destroy();
      }
    },
  );

  it('reads a frame background of ink as none', () => {
    const board = fixtureGateBoard();
    try {
      const frame = [...board.writer.read().objects.values()].find(
        (object) => object.type === 'frame',
      );
      expect(frame).toBeDefined();
      const frameId = String(frame?.id);
      const update = rawUpdate(board, (objects) => {
        mergeGroup(objects, frameId, 'style', { background: 'ink' });
      });
      board.writer.applyUpdate(update, RELAY);
      const read = board.writer.read();
      expect(read.objects.get(frame?.id ?? ('' as never))).toMatchObject({
        type: 'frame',
        background: null,
        name: frame?.type === 'frame' ? frame.name : undefined,
      });
      expect(read.issues).toEqual([]);
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });
});

describe('tolerateStoredPaints', () => {
  it('keeps absent, null and solid tuple paints, and never adds a field', () => {
    const target: Record<string, unknown> = { fill: [2, 0, 0, 1], background: null };
    tolerateStoredPaints(target);
    expect(target).toEqual({ fill: [2, 0, 0, 1], background: null });
  });
});
