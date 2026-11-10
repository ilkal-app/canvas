import { describe, expect, it } from 'vitest';

import { copySelection } from '@canvas/document';
import {
  createBoard,
  exportBoard,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import { decodeObjectsFlavour, encodeClipboardFlavours } from './clipboard-flavours.js';
import { CANVAS_OBJECTS_MIME_TYPE } from './clipboard-formats.js';
import { importWithExternalMains } from './external-mains.js';

/**
 * The fields every object here shares.
 *
 * @param id - The id.
 * @param z - The stacking key.
 * @param parentId - The parent, or null.
 * @returns The fields.
 */
function shared(id: string, z: string, parentId: string | null = null) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  };
}

const MAIN: BoardObject = {
  ...shared('card', 'a0'),
  type: 'component',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  name: 'Card',
  retired: false,
};

const CHILD: BoardObject = {
  ...shared('card-bg', 'a0', 'card'),
  type: 'shape',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  kind: 'rectangle',
  stroke: null,
  fill: [1, 0, 0, 1],
  cornerRadius: 0,
  sides: 4,
  label: null,
};

/**
 * An instance of the card.
 *
 * @param id - Its id.
 * @param mainId - The main it names.
 * @returns The instance.
 */
function instance(id: string, mainId = 'card'): BoardObject {
  return {
    ...shared(id, 'a1'),
    type: 'instance',
    x: 200,
    y: 0,
    width: 100,
    height: 60,
    mainId: mainId as ObjectId,
    overrides: { 'card-bg': { fill: [0, 1, 0, 1] } },
  };
}

/**
 * The objects flavour of a copy of some objects of a board holding the card and an instance.
 *
 * @param ids - What to copy.
 * @returns The flavour's JSON.
 * @throws {Error} When nothing was copied.
 */
function copiedJson(ids: readonly string[]): string {
  const board = createBoard([MAIN, CHILD, instance('inst')]);
  const copied = copySelection(board, ids as ObjectId[]);
  if (copied === undefined) throw new Error('nothing was copied');
  return encodeClipboardFlavours(copied).get(CANVAS_OBJECTS_MIME_TYPE) ?? '';
}

describe('decodeObjectsFlavour and instances', () => {
  it('reads back a copied instance whose main is not in the copy, the main left on the board', () => {
    const decoding = decodeObjectsFlavour(copiedJson(['inst']));
    expect(decoding.kind).toBe('board');
    if (decoding.kind !== 'board') return;
    expect([...decoding.board.objects.keys()]).toEqual(['inst']);
    expect(decoding.board.objects.get('inst' as ObjectId)).toMatchObject({
      type: 'instance',
      mainId: 'card',
      overrides: { 'card-bg': { fill: [0, 1, 0, 1] } },
    });
  });

  it('reads back a copied main with its instance as it did', () => {
    const decoding = decodeObjectsFlavour(copiedJson(['card', 'inst']));
    expect(decoding.kind).toBe('board');
    if (decoding.kind !== 'board') return;
    expect([...decoding.board.objects.keys()].sort()).toEqual(['card', 'card-bg', 'inst']);
  });
});

describe('importWithExternalMains', () => {
  /**
   * A portable document of some objects.
   *
   * @param objects - The objects.
   * @returns The document.
   */
  function documentOf(objects: readonly BoardObject[]): unknown {
    return exportBoard(createBoard(objects));
  }

  it('imports a board without instances as importBoard does', () => {
    const board = importWithExternalMains(documentOf([MAIN, CHILD]));
    expect([...board.objects.keys()]).toEqual(['card', 'card-bg']);
  });

  it('still refuses an instance whose main in the copy is not a component', () => {
    expect(() =>
      importWithExternalMains(documentOf([CHILD, instance('inst', 'card-bg')])),
    ).toThrow();
  });

  it('still refuses what importBoard refuses besides the outside main', () => {
    const broken = { ...instance('inst'), width: -1 } as BoardObject;
    expect(() => importWithExternalMains(documentOf([broken]))).toThrow();
    expect(() => importWithExternalMains({ format: 'other' })).toThrow();
  });

  it('leaves no stand-in for the outside main in the board it returns', () => {
    const board = importWithExternalMains(documentOf([instance('one'), instance('two')]));
    expect([...board.objects.keys()].sort()).toEqual(['one', 'two']);
  });
});
