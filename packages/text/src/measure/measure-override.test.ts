import { describe, expect, it } from 'vitest';

import type {
  Board,
  BoardObject,
  InstanceObject,
  ObjectId,
  PrincipalId,
  TextStyle,
} from '@canvas/schema';

import { BUNDLED_FONTS_FINGERPRINT } from '../bundled/fonts-fingerprint.js';

import { measureObjectText } from './measure-object.js';
import { measureOverrideText } from './measure-override.js';
import { measuringFontsFor } from './measure-text.js';

// The size an instance's override gives a text child, shared by MCP and the app.

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

const SHARED = {
  rotation: 0,
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  z: 'a0',
} as const;

/**
 * A main with an auto-width label and a shape, and an instance of it.
 *
 * @param overrides - The instance's records.
 * @returns The board and the instance.
 */
function boardWith(overrides: InstanceObject['overrides']): {
  board: Board;
  instance: InstanceObject;
} {
  const objects: BoardObject[] = [
    {
      ...SHARED,
      id: 'main' as ObjectId,
      type: 'component',
      parentId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      name: 'Chip',
      retired: false,
    },
    {
      ...SHARED,
      id: 'label' as ObjectId,
      type: 'text',
      parentId: 'main' as ObjectId,
      x: 5,
      y: 5,
      width: 40,
      height: 20,
      text: 'ab',
      runs: [{ length: 2, style: STYLE }],
      align: 'left',
      autoWidth: true,
      verticalAlign: 'top',
    },
    {
      ...SHARED,
      id: 'dot' as ObjectId,
      type: 'shape',
      parentId: 'main' as ObjectId,
      x: 60,
      y: 5,
      width: 10,
      height: 10,
      kind: 'rectangle',
      fill: [1, 0, 0, 1],
      stroke: null,
      cornerRadius: 0,
      sides: 4,
      label: null,
    },
  ] as BoardObject[];
  const instance = {
    ...SHARED,
    id: 'inst' as ObjectId,
    type: 'instance',
    parentId: null,
    x: 200,
    y: 0,
    width: 100,
    height: 40,
    mainId: 'main' as ObjectId,
    overrides,
  } as InstanceObject;
  return { board: { objects: new Map([...objects, instance].map((o) => [o.id, o])) }, instance };
}

describe('measureOverrideText', () => {
  it('measures the override’s text at the child’s own box, stamped with the font fingerprint', () => {
    const { board, instance } = boardWith({});
    const text = 'a longer label';
    const measured = measureOverrideText(board, instance, 'label', { text });
    const runs = [{ length: text.length, style: STYLE }];
    const expected = measureObjectText(
      {
        ...(board.objects.get('label' as ObjectId) as Extract<BoardObject, { type: 'text' }>),
        text,
        runs,
      },
      measuringFontsFor([runs]).fonts,
    )?.box;
    expect(measured?.measuredSize).toEqual({
      width: expected?.width,
      height: expected?.height,
      fonts: BUNDLED_FONTS_FINGERPRINT,
    });
  });

  it('measures a hidden child as if shown', () => {
    const { board, instance } = boardWith({ label: { isHidden: true } });
    expect(
      measureOverrideText(board, instance, 'label', { text: 'x', isHidden: true }),
    ).toBeDefined();
  });

  it('measures nothing for a child that is not a text or sticky', () => {
    const { board, instance } = boardWith({});
    expect(measureOverrideText(board, instance, 'dot', { fill: [0, 1, 0, 1] })).toBeUndefined();
    expect(measureOverrideText(board, instance, 'missing', { text: 'x' })).toBeUndefined();
  });

  it('measures a child a preset hides and the instance shows', () => {
    const { board, instance } = boardWith({ label: { isHidden: false } });
    const main = board.objects.get('main' as ObjectId);
    if (main === undefined) throw new Error('no main');
    const objects = new Map(board.objects);
    objects.set(main.id, {
      ...main,
      variantAxes: [{ name: 'mode', values: ['quiet'] }],
      variantPresets: { 'mode=quiet': { label: { isHidden: true } } },
    } as BoardObject);
    const measured = measureOverrideText({ objects }, instance, 'label', {
      isHidden: false,
      text: 'shown',
    });
    expect(measured?.measuredSize.fonts).toBe(BUNDLED_FONTS_FINGERPRINT);
  });
});
