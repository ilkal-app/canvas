import { describe, expect, it } from 'vitest';

import type { NewObject } from '@canvas/document';
import { createBoard, type BoardObject, type ObjectId, type PrincipalId } from '@canvas/schema';

import { encodeClipboardFlavours, decodeObjectsFlavour } from './clipboard-flavours.js';
import { CANVAS_OBJECTS_MIME_TYPE, type ClipboardFlavours } from './clipboard-formats.js';
import { PASTE_REFUSED_MESSAGE } from './clipboard-notice.js';
import { createDefaultPasteHandlers } from './default-paste-handlers.js';
import type { PasteItem, PasteTarget } from './paste-handlers.js';

// Fix round 3 (N4 and its minor): a paste refuses what `createObject` refuses, a comment
// pin offset past its limit included, and a clipboard whose JSON holds a number that is not finite
// (a `1e400` literal parses to Infinity) is refused with the paste notice, never pasted as the
// plain text of the copy.

const SHARED = {
  parentId: null,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1_770_000_000_000,
  updatedAt: 1_770_000_000_000,
};

/**
 * A shape and a comment pinned to it at an offset.
 *
 * @param offsetX - The pin's x in the shape's frame.
 * @returns The objects.
 */
function pinnedShape(offsetX: number): BoardObject[] {
  return [
    {
      ...SHARED,
      id: 'shape' as ObjectId,
      x: 0,
      y: 0,
      type: 'shape',
      kind: 'rectangle',
      width: 10,
      height: 10,
      stroke: null,
      fill: null,
      cornerRadius: 0,
      sides: 4,
      label: null,
    },
    {
      ...SHARED,
      id: 'pin' as ObjectId,
      z: 'a1',
      x: 0,
      y: 0,
      type: 'comment',
      threadId: 'thread-1',
      anchor: { kind: 'object', objectId: 'shape' as ObjectId, offset: { x: offsetX, y: 0 } },
    },
  ];
}

/**
 * A paste target that records what it is asked to create and say.
 *
 * @returns The target and what it recorded.
 */
function recordingTarget() {
  const created: (readonly NewObject[])[] = [];
  const notices: string[] = [];
  const target: PasteTarget = {
    pointer: { x: 0, y: 0 },
    viewCentre: { x: 0, y: 0 },
    createObjects: (objects, onCreated) => {
      created.push(objects);
      onCreated?.(objects.map((object, index) => `new-${String(index)}` as ObjectId));
      return true;
    },
    notify: (notice) => {
      notices.push(notice);
    },
  };
  return { target, created, notices };
}

/**
 * Flavours as paste items, with the plain text of the copy after them.
 *
 * @param flavours - The flavours.
 * @returns The items.
 */
function itemsOf(flavours: ClipboardFlavours): PasteItem[] {
  return [
    ...[...flavours]
      .filter(([type]) => type === CANVAS_OBJECTS_MIME_TYPE)
      .map(([type, data]): PasteItem => ({ kind: 'string', type, data })),
    { kind: 'string', type: 'text/plain', data: 'the plain text of the copy' },
  ];
}

/**
 * Flavours whose objects JSON is rewritten.
 *
 * @param objects - The objects copied.
 * @param rewrite - What to do to the JSON text.
 * @returns The flavours.
 */
function flavoursOf(
  objects: BoardObject[],
  rewrite: (json: string) => string = (json) => json,
): ClipboardFlavours {
  const flavours = new Map(encodeClipboardFlavours(createBoard(objects)));
  flavours.set(CANVAS_OBJECTS_MIME_TYPE, rewrite(flavours.get(CANVAS_OBJECTS_MIME_TYPE) ?? ''));
  return flavours;
}

describe('a paste of values past their limits', () => {
  it('a comment pin offset past its limit is refused with the notice', () => {
    const flavours = flavoursOf(pinnedShape(1e300));
    expect(decodeObjectsFlavour(flavours.get(CANVAS_OBJECTS_MIME_TYPE) ?? '')).toMatchObject({
      kind: 'refused',
    });
    const { target, created, notices } = recordingTarget();
    createDefaultPasteHandlers().dispatch(itemsOf(flavours), target);
    expect(created).toEqual([]);
    expect(notices).toEqual([PASTE_REFUSED_MESSAGE]);
  });

  it('a 1e400 literal is refused with the notice, never pasted as plain text', () => {
    const flavours = flavoursOf(pinnedShape(5), (json) => json.replace('"x":0', '"x":1e400'));
    expect(flavours.get(CANVAS_OBJECTS_MIME_TYPE)).toContain('1e400');
    const { target, created, notices } = recordingTarget();
    expect(createDefaultPasteHandlers().dispatch(itemsOf(flavours), target)).toBe(true);
    expect(created).toEqual([]);
    expect(notices).toEqual([PASTE_REFUSED_MESSAGE]);
  });

  it('a pin offset within its limit pastes', () => {
    const { target, created, notices } = recordingTarget();
    createDefaultPasteHandlers().dispatch(itemsOf(flavoursOf(pinnedShape(5))), target);
    expect(created).toHaveLength(1);
    expect(notices).toEqual([]);
  });
});
