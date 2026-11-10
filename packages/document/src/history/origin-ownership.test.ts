import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { SYSTEM_ORIGIN, type TransactionOrigin } from '../origin/transaction-origin.js';

import { isOwnedBy } from './origin-ownership.js';

const ADA = 'user:ada' as PrincipalId;
const BOB = 'user:bob' as PrincipalId;
const SCOUT = 'agent:scout' as PrincipalId;

describe('isOwnedBy', () => {
  it("owns the user's own changes", () => {
    expect(isOwnedBy({ kind: 'user', principalId: ADA }, ADA)).toBe(true);
  });

  it("does not own another user's changes", () => {
    expect(isOwnedBy({ kind: 'user', principalId: BOB }, ADA)).toBe(false);
  });

  it('owns the changes of an agent the user operates', () => {
    const origin: TransactionOrigin = { kind: 'agent', principalId: SCOUT, operatorId: ADA };
    expect(isOwnedBy(origin, ADA)).toBe(true);
  });

  it('does not own the changes of an agent another user operates, or of an unoperated agent', () => {
    expect(isOwnedBy({ kind: 'agent', principalId: SCOUT, operatorId: BOB }, ADA)).toBe(false);
    expect(isOwnedBy({ kind: 'agent', principalId: SCOUT }, ADA)).toBe(false);
  });

  it('does not treat an agent principal as the owner of its own changes', () => {
    expect(isOwnedBy({ kind: 'agent', principalId: SCOUT, operatorId: ADA }, SCOUT)).toBe(false);
  });

  it('never owns undo or system changes, so undo steps are not captured again', () => {
    expect(isOwnedBy({ kind: 'undo', principalId: ADA }, ADA)).toBe(false);
    expect(isOwnedBy({ kind: 'undo', principalId: SCOUT, operatorId: ADA }, ADA)).toBe(false);
    expect(isOwnedBy(SYSTEM_ORIGIN, ADA)).toBe(false);
  });

  it("never owns what is not an origin (Yjs's own transactions carry null)", () => {
    expect(isOwnedBy(null, ADA)).toBe(false);
    expect(isOwnedBy(undefined, ADA)).toBe(false);
    expect(isOwnedBy('user:ada', ADA)).toBe(false);
    expect(isOwnedBy({ principalId: ADA }, ADA)).toBe(false);
  });

  it('owns a keyed agent change only in the history with the same key', () => {
    const keyed: TransactionOrigin = {
      kind: 'agent',
      principalId: SCOUT,
      operatorId: ADA,
      historyKey: 'a',
    };
    expect(isOwnedBy(keyed, ADA, 'a')).toBe(true);
    expect(isOwnedBy(keyed, ADA, 'b')).toBe(false);
    expect(isOwnedBy(keyed, ADA)).toBe(false);
    expect(isOwnedBy(keyed, BOB, 'a')).toBe(false);
  });

  it('owns only changes without a key in an unkeyed history, and no user change in a keyed one', () => {
    expect(isOwnedBy({ kind: 'agent', principalId: SCOUT, operatorId: ADA }, ADA, 'a')).toBe(false);
    expect(isOwnedBy({ kind: 'user', principalId: ADA }, ADA, 'a')).toBe(false);
    expect(isOwnedBy({ kind: 'undo', principalId: ADA }, ADA, 'a')).toBe(false);
  });
});
