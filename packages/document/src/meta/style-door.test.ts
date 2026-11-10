import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, mergeGroup, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The door judges writes into the `textStyles` and `effectStyles` maps by key shape
// (`judgeStyleWrites`), and a shape's style group may hold `effectStyleId` and a layered shadow.

/**
 * Checks an update written by the fixture writer.
 *
 * @param write - The raw write.
 * @returns The verdict.
 */
function verdictOf(write: Parameters<typeof rawUpdate>[1]): ReturnType<UpdateStampCheck['check']> {
  const board = fixtureGateBoard();
  try {
    return new UpdateStampCheck(board.hub).check(rawUpdate(board, write));
  } finally {
    board.hub.destroy();
    board.writer.destroy();
  }
}

const styleWrite = (map: string, key: string, value: unknown) =>
  verdictOf((objects, doc) => {
    doc.getMap(map).set(key, value);
  });

const TEXT = { fontFamily: 'Inter', fontSize: 24, weight: 400, italic: false };
const SHADOW = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };

describe('the door on the named style maps', () => {
  it.each([
    ['textStyles', 'body.identity', { createdBy: 'agent:scout', createdAt: 1 }],
    ['textStyles', 'body.identity', { createdBy: null, createdAt: 0 }],
    ['textStyles', 'body.name', 'UI/Body'],
    ['textStyles', 'body.value', { ...TEXT, lineHeight: { unit: 'px', value: 20 } }],
    ['effectStyles', 'float.value', { shadows: [SHADOW, SHADOW] }],
  ])('accepts valid %s key %s', (map, key, value) => {
    expect(styleWrite(map, key, value)).toEqual({ kind: 'accepted' });
  });

  it.each([
    ['textStyles', 'body.identity', { createdBy: 'nobody', createdAt: 0 }, 'not-a-style-value'],
    ['textStyles', 'body.identity', { createdBy: null }, 'not-a-style-value'],
    ['textStyles', 'body.name', ' Body', 'not-a-style-value'],
    ['textStyles', 'body.name', 'x'.repeat(41), 'not-a-style-value'],
    ['textStyles', 'body.value', { ...TEXT, color: [1, 0, 0, 1] }, 'not-a-style-value'],
    ['textStyles', 'body.value', { shadows: [SHADOW] }, 'not-a-style-value'],
    ['effectStyles', 'float.value', { shadows: [] }, 'not-a-style-value'],
    ['effectStyles', 'float.value', TEXT, 'not-a-style-value'],
    ['effectStyles', 'float.extra', true, 'not-a-style-key'],
    ['textStyles', 'bad id.name', 'x', 'not-a-style-key'],
  ])('refuses hostile %s write %s %j', (map, key, value, reason) => {
    expect(styleWrite(map, key, value)).toEqual({
      kind: 'accepted',
      hostileValue: expect.objectContaining({ reason, styleKey: key }) as unknown,
    });
  });

  it('accepts an effect style id and shadow layers in a style group, refuses bad layers', () => {
    const style = (value: Readonly<Record<string, unknown>>) =>
      verdictOf((objects) => {
        mergeGroup(objects, 'shape-box', 'style', value);
      });
    expect(style({ effectStyleId: 'float', shadow: [SHADOW, SHADOW] })).toEqual({
      kind: 'accepted',
    });
    expect(style({ shadow: [SHADOW, { ...SHADOW, blur: -1 }] })).toMatchObject({
      hostileValue: { field: 'shadow.1.blur', reason: 'out-of-range' },
    });
  });
});
