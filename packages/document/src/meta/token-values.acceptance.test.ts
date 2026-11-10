// Independent acceptance for the token-map door.
import * as encoding from 'lib0/encoding';
import { describe, expect, it, vi } from 'vitest';

import { NO_CLIENT, type ScannedContent, type ScannedItem } from '../assets/update-scan.js';

type Finding = { reason: string; key: string } | undefined;
type Judge = (bytes: Uint8Array, writes: readonly { item: ScannedItem; key: string }[]) => Finding;

async function judge(): Promise<Judge> {
  const module = await vi.importActual<Record<string, unknown>>('./token-values.js').catch(() => {
    throw new Error('missing export: judgeTokenWrites');
  });
  const value = module.judgeTokenWrites;
  if (typeof value !== 'function') throw new Error('missing export: judgeTokenWrites');
  return value as Judge;
}

function itemOf(content: ScannedContent): ScannedItem {
  return {
    client: 1,
    clock: 0,
    length: 1,
    content,
    originClient: NO_CLIENT,
    originClock: 0,
    rightOriginClient: NO_CLIENT,
    rightOriginClock: 0,
    parentName: 'tokens',
    parentClient: NO_CLIENT,
    parentClock: 0,
    parentSub: 'accent.name',
    detail: 0,
  };
}

function jsonBytes(value: unknown): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarString(encoder, JSON.stringify(value));
  return encoding.toUint8Array(encoder);
}

describe('judgeTokenWrites', () => {
  it('accepts plain identity, name and mode values under valid keys', async () => {
    const check = await judge();
    for (const [key, value] of [
      ['accent.identity', { builtin: true, createdBy: 'user:ada', createdAt: 1 }],
      ['accent.name', 'Accent'],
      ['accent.light', [1, 0, 0, 1]],
      ['accent.dark', [0, 0, 1, 1]],
    ] as const)
      expect(check(jsonBytes(value), [{ item: itemOf('json'), key }])).toBeUndefined();
  });

  it('refuses malformed keys and values with specific reasons', async () => {
    const check = await judge();
    expect(check(jsonBytes('Name'), [{ item: itemOf('json'), key: 'bad key.name' }])).toMatchObject(
      { reason: 'not-a-token-key' },
    );
    expect(check(jsonBytes('red'), [{ item: itemOf('json'), key: 'accent.light' }])).toMatchObject({
      reason: 'not-a-token-value',
    });
    expect(
      check(jsonBytes({ builtin: true, createdBy: 7, createdAt: 1 }), [
        { item: itemOf('json'), key: 'accent.identity' },
      ]),
    ).toMatchObject({ reason: 'not-a-token-value' });
    expect(check(new Uint8Array(), [{ item: itemOf('type'), key: 'accent.name' }])).toMatchObject({
      reason: 'not-a-plain-value',
    });
  });
});
