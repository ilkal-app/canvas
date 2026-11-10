import { describe, expect, it } from 'vitest';

import {
  createObjectsCommand,
  runCommand,
  YjsDocumentStore,
  type NewObject,
  type TransactionOrigin,
} from '@canvas/document';
import { planDuplicate } from '@canvas/document';
import {
  BOARD_BOUND,
  createBoard,
  createSeededIdGenerator,
  type Board,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import { encodeClipboardFlavours, decodeObjectsFlavour } from './clipboard-flavours.js';
import { CANVAS_OBJECTS_MIME_TYPE, type ClipboardFlavours } from './clipboard-formats.js';
import { PASTE_REFUSED_MESSAGE } from './clipboard-notice.js';
import { createDefaultPasteHandlers } from './default-paste-handlers.js';
import type { PasteItem, PasteTarget } from './paste-handlers.js';

// Paste, duplicate and import judge objects by where they land, resolved through the parents that
// come with them (fix round 2), not by a coordinate relative to a parent: a group of two
// frames at -B and +B holds one 2B from its group, and is honest. A refusal is never silent.

const B = BOARD_BOUND;
const ORIGIN: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/**
 * A group and two 0-size frames in it.
 *
 * @param groupX - The group's x.
 * @param leftX - The first frame's x in the group.
 * @param rightX - The second frame's x in the group.
 * @returns The board.
 */
function groupOfFrames(groupX: number, leftX: number, rightX: number): Board {
  const shared = (id: string, parentId: string | null, x: number, z: string) => ({
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    x,
    y: 0,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });
  const frame = (id: string, x: number, z: string): BoardObject => ({
    ...shared(id, 'g', x, z),
    type: 'frame',
    width: 0,
    height: 0,
    name: id,
    clip: false,
    background: null,
  });
  return createBoard([
    { ...shared('g', null, groupX, 'a0'), type: 'group' },
    frame('left', leftX, 'a0'),
    frame('right', rightX, 'a1'),
  ]);
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
 * Flavours as paste items.
 *
 * @param flavours - The flavours.
 * @returns The items.
 */
function itemsOf(flavours: ClipboardFlavours): PasteItem[] {
  return [...flavours].map(([type, data]) => ({ kind: 'string', type, data }));
}

/**
 * Runs a list through `createObjects` on an empty board.
 *
 * @param objects - The list.
 * @returns The command's status.
 */
function createOnEmptyBoard(objects: readonly NewObject[]): 'applied' | 'rejected' {
  const store = new YjsDocumentStore();
  return runCommand(
    store,
    ORIGIN,
    createObjectsCommand,
    { objects: [...objects] },
    { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(5) },
  ).status;
}

describe('copy and paste of an honest group whose member sits 2B from it', () => {
  const board = groupOfFrames(-B, 0, 2 * B);

  it('decodes as a board, and pastes at the pointer with no notice', () => {
    const flavours = encodeClipboardFlavours(board);
    expect(decodeObjectsFlavour(flavours.get(CANVAS_OBJECTS_MIME_TYPE) ?? '').kind).toBe('board');
    const { target, created, notices } = recordingTarget();
    createDefaultPasteHandlers().dispatch(itemsOf(flavours), target);
    expect(created).toHaveLength(1);
    expect(notices).toEqual([]);
    expect(created[0]?.find(({ id }) => id === 'right')).toMatchObject({ x: 2 * B });
    expect(createOnEmptyBoard(created[0] ?? [])).toBe('applied');
  });

  it('duplicates a group that has room for the offset, and refuses one that has none', () => {
    const roomy = groupOfFrames(-B + 50, 0, 2 * B - 200);
    expect(createOnEmptyBoard(planDuplicate(roomy, ['g' as ObjectId])?.objects ?? [])).toBe(
      'applied',
    );
    // Two frames on the bound itself cannot move 16 units outward.
    expect(createOnEmptyBoard(planDuplicate(board, ['g' as ObjectId])?.objects ?? [])).toBe(
      'rejected',
    );
  });
});

describe('a hostile clipboard', () => {
  const hostile = (): ClipboardFlavours => {
    const flavours = new Map(encodeClipboardFlavours(groupOfFrames(0, 0, 100)));
    const document = JSON.parse(flavours.get(CANVAS_OBJECTS_MIME_TYPE) ?? '{}') as {
      objects: { id: string }[];
    };
    const objects = document.objects.map((object) =>
      object.id === 'right' ? { ...object, x: 1e300 } : object,
    );
    flavours.set(CANVAS_OBJECTS_MIME_TYPE, JSON.stringify({ ...document, objects }));
    return flavours;
  };

  it('is refused as a value past the bound, with the existing notice', () => {
    const decoding = decodeObjectsFlavour(hostile().get(CANVAS_OBJECTS_MIME_TYPE) ?? '');
    expect(decoding).toMatchObject({ kind: 'refused', notice: { message: PASTE_REFUSED_MESSAGE } });
  });

  it('pastes nothing and never falls back to the plain text, and says why', () => {
    const { target, created, notices } = recordingTarget();
    const items: PasteItem[] = [
      ...itemsOf(hostile()),
      { kind: 'string', type: 'text/plain', data: 'the plain text of the copy' },
    ];
    expect(createDefaultPasteHandlers().dispatch(items, target)).toBe(true);
    expect(created).toEqual([]);
    expect(notices).toEqual([PASTE_REFUSED_MESSAGE]);
  });
});
