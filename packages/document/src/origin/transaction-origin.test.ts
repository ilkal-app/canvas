import { describe, expect, it } from 'vitest';

import { parseTransactionOrigin, SYSTEM_ORIGIN } from './transaction-origin.js';

describe('parseTransactionOrigin', () => {
  it('accepts a user, an agent with its operator, an undo and the system', () => {
    expect(parseTransactionOrigin({ kind: 'user', principalId: 'user:ada' }).kind).toBe('user');
    expect(
      parseTransactionOrigin({ kind: 'agent', principalId: 'agent:bot', operatorId: 'user:ada' })
        .operatorId,
    ).toBe('user:ada');
    expect(parseTransactionOrigin({ kind: 'undo', principalId: 'user:ada' }).kind).toBe('undo');
    expect(parseTransactionOrigin({ kind: 'system', principalId: 'system' })).toEqual(
      SYSTEM_ORIGIN,
    );
  });

  it('returns a frozen copy, so a change set can hand the origin to every listener', () => {
    const input = { kind: 'user', principalId: 'user:ada' } as const;
    const origin = parseTransactionOrigin(input);
    expect(Object.isFrozen(origin)).toBe(true);
    expect(origin).not.toBe(input);
  });

  it('rejects a principal that does not match the kind', () => {
    expect(() => parseTransactionOrigin({ kind: 'user', principalId: 'agent:bot' })).toThrow(
      RangeError,
    );
    expect(() => parseTransactionOrigin({ kind: 'agent', principalId: 'user:ada' })).toThrow(
      RangeError,
    );
    expect(() => parseTransactionOrigin({ kind: 'system', principalId: 'user:ada' })).toThrow(
      RangeError,
    );
    expect(() => parseTransactionOrigin({ kind: 'undo', principalId: 'system' })).toThrow(
      RangeError,
    );
  });

  it('lets a demo board visitor name a person’s origin, and no other', () => {
    expect(parseTransactionOrigin({ kind: 'user', principalId: 'demo:v-1' })).toEqual({
      kind: 'user',
      principalId: 'demo:v-1',
    });
    expect(() => parseTransactionOrigin({ kind: 'agent', principalId: 'demo:v-1' })).toThrow(
      RangeError,
    );
    expect(() => parseTransactionOrigin({ kind: 'system', principalId: 'demo:v-1' })).toThrow(
      RangeError,
    );
  });

  it('rejects an operator on a user or system origin, and an operator that is not a user', () => {
    expect(() =>
      parseTransactionOrigin({ kind: 'user', principalId: 'user:ada', operatorId: 'user:bob' }),
    ).toThrow(RangeError);
    expect(() =>
      parseTransactionOrigin({ kind: 'agent', principalId: 'agent:bot', operatorId: 'agent:x' }),
    ).toThrow(RangeError);
  });

  it('makes an undo origin act for the user who undoes, with no operator', () => {
    expect(() => parseTransactionOrigin({ kind: 'undo', principalId: 'agent:bot' })).toThrow(
      RangeError,
    );
    expect(() =>
      parseTransactionOrigin({ kind: 'undo', principalId: 'user:ada', operatorId: 'user:ada' }),
    ).toThrow(RangeError);
  });

  it('rejects an unknown kind and a malformed principal id', () => {
    expect(() => parseTransactionOrigin({ kind: 'remote', principalId: 'system' })).toThrow(
      RangeError,
    );
    expect(() => parseTransactionOrigin({ kind: 'user', principalId: 'user: ada' })).toThrow(
      RangeError,
    );
    expect(() => parseTransactionOrigin(null)).toThrow(RangeError);
    expect(() =>
      parseTransactionOrigin({ kind: 'user', principalId: 'user:ada', note: 'x' }),
    ).toThrow(RangeError);
  });

  it("keeps an agent origin's history key, and refuses a malformed key or one on another kind", () => {
    const keyed = parseTransactionOrigin({
      kind: 'agent',
      principalId: 'agent:bot',
      operatorId: 'user:ada',
      historyKey: 'Sub_agent-1',
    });
    expect(keyed).toEqual({
      kind: 'agent',
      principalId: 'agent:bot',
      operatorId: 'user:ada',
      historyKey: 'Sub_agent-1',
    });
    expect(Object.isFrozen(keyed)).toBe(true);
    expect(
      parseTransactionOrigin({ kind: 'agent', principalId: 'agent:bot', historyKey: 'a' }),
    ).toEqual({ kind: 'agent', principalId: 'agent:bot', historyKey: 'a' });
    expect(parseTransactionOrigin({ kind: 'agent', principalId: 'agent:bot' })).not.toHaveProperty(
      'historyKey',
    );
    for (const historyKey of ['', 'a b', 'a.b', 'é', 'a'.repeat(65), 7, null]) {
      expect(() =>
        parseTransactionOrigin({ kind: 'agent', principalId: 'agent:bot', historyKey }),
      ).toThrow(RangeError);
    }
    expect(
      parseTransactionOrigin({
        kind: 'agent',
        principalId: 'agent:bot',
        historyKey: 'a'.repeat(64),
      }).historyKey,
    ).toHaveLength(64);
    for (const origin of [
      { kind: 'user', principalId: 'user:ada' },
      { kind: 'undo', principalId: 'user:ada' },
      { kind: 'system', principalId: 'system' },
    ]) {
      expect(() => parseTransactionOrigin({ ...origin, historyKey: 'a' })).toThrow(RangeError);
    }
  });
});
