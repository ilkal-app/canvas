import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, mergeGroup, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The door judges writes into the `tokens` map by key shape (`judgeTokenWrites`), and a
// token reference in a fill, background, stroke or a container's colour mode in a style group.

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

const tokenWrite = (key: string, value: unknown) =>
  verdictOf((objects, doc) => {
    doc.getMap('tokens').set(key, value);
  });

describe('the door on the tokens map', () => {
  it.each([
    ['brand.identity', { builtin: false, createdBy: 'agent:scout', createdAt: 1 }],
    ['accent.identity', { builtin: true, createdBy: null, createdAt: 0 }],
    ['brand.name', 'x'.repeat(40)],
    ['brand.light', [1, 0, 0, 1]],
    ['accent.dark', [0, 0, 0, 0.5]],
  ])('accepts valid key %s', (key, value) => {
    expect(tokenWrite(key, value)).toEqual({ kind: 'accepted' });
  });

  it.each([
    ['brand.identity', { builtin: true, createdBy: null, createdAt: 0 }, 'not-a-token-value'],
    ['accent.identity', { builtin: false, createdBy: null, createdAt: 0 }, 'not-a-token-value'],
    ['brand.identity', { builtin: false, createdBy: 'nobody', createdAt: 0 }, 'not-a-token-value'],
    [
      'brand.identity',
      { builtin: false, createdBy: null, createdAt: 0, x: 1 },
      'not-a-token-value',
    ],
    ['brand.name', 'x'.repeat(41), 'not-a-token-value'],
    ['brand.name', '   ', 'not-a-token-value'],
    ['brand.light', [1, 0, 0], 'not-a-token-value'],
    ['brand.dark', [2, 0, 0, 1], 'not-a-token-value'],
    ['brand.extra', true, 'not-a-token-key'],
    ['bad id.name', 'x', 'not-a-token-key'],
  ])('refuses hostile token write %s %j', (key, value, reason) => {
    expect(tokenWrite(key, value)).toEqual({
      kind: 'accepted',
      hostileValue: expect.objectContaining({ reason, tokenKey: key }) as unknown,
    });
  });

  it('accepts token references and colour modes in style groups, refuses malformed ones', () => {
    const style = (value: Readonly<Record<string, unknown>>) =>
      verdictOf((objects) => {
        mergeGroup(objects, 'shape-box', 'style', value);
      });
    expect(style({ fill: { token: 'brand' } })).toEqual({ kind: 'accepted' });
    expect(style({ stroke: { color: { token: 'ink' }, width: 2 } })).toEqual({ kind: 'accepted' });
    expect(style({ fill: { token: 'bad id' } })).toMatchObject({
      hostileValue: { field: 'fill.token', reason: 'out-of-range' },
    });
    expect(style({ fill: { token: 'x', type: 'linear' } })).toMatchObject({
      hostileValue: { field: 'fill', reason: 'not-a-record' },
    });
    expect(style({ colorMode: 'dim' })).toMatchObject({
      hostileValue: { field: 'colorMode', reason: 'out-of-range' },
    });
  });
});
