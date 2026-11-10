import { describe, expect, it } from 'vitest';

import { isPresencePrincipal, isPresenceState } from './presence-guard.js';

const principal = { id: 'user-1', kind: 'user', name: 'Ada', color: '#1f77b4' };

describe('isPresencePrincipal', () => {
  it('accepts users and agents', () => {
    expect(isPresencePrincipal(principal)).toBe(true);
    expect(isPresencePrincipal({ ...principal, kind: 'agent', name: 'Layout bot' })).toBe(true);
  });

  it('rejects an unknown kind, an empty id and a colour that is not #rrggbb', () => {
    expect(isPresencePrincipal({ ...principal, kind: 'robot' })).toBe(false);
    expect(isPresencePrincipal({ ...principal, id: '' })).toBe(false);
    expect(isPresencePrincipal({ ...principal, color: 'red' })).toBe(false);
    expect(isPresencePrincipal({ ...principal, name: 42 })).toBe(false);
  });
});

describe('isPresenceState', () => {
  it('accepts a state that carries only a principal and a timestamp', () => {
    expect(isPresenceState({ principal, updatedAt: 0 })).toBe(true);
  });

  it('accepts a state with a cursor, a selection and a viewport', () => {
    expect(
      isPresenceState({
        principal,
        cursor: { x: 1, y: 2 },
        selection: ['a'],
        viewport: { x: 0, y: 0, w: 10, h: 10, zoom: 1 },
        updatedAt: 1000,
      }),
    ).toBe(true);
  });

  it('rejects the empty state an awareness instance starts with', () => {
    expect(isPresenceState({})).toBe(false);
    expect(isPresenceState(null)).toBe(false);
  });

  it('rejects a state whose optional fields are malformed', () => {
    expect(isPresenceState({ principal, cursor: { x: Number.NaN, y: 0 }, updatedAt: 0 })).toBe(
      false,
    );
    expect(isPresenceState({ principal, selection: [1], updatedAt: 0 })).toBe(false);
    expect(isPresenceState({ principal, viewport: { x: 0 }, updatedAt: 0 })).toBe(false);
    expect(isPresenceState({ principal, updatedAt: '0' })).toBe(false);
  });
});
