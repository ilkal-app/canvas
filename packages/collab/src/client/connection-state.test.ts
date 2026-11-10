import { describe, expect, it } from 'vitest';

import {
  CONNECTION_EVENTS,
  CONNECTION_STATES,
  nextConnectionState,
  type ConnectionEvent,
  type ConnectionState,
} from './connection-state.js';

function run(from: ConnectionState, events: readonly ConnectionEvent[]): ConnectionState[] {
  const visited: ConnectionState[] = [];
  let state = from;
  for (const event of events) {
    state = nextConnectionState(state, event);
    visited.push(state);
  }
  return visited;
}

describe('nextConnectionState', () => {
  it('connects on the first sync and reconnects after losing the connection', () => {
    expect(run('connecting', ['synced', 'lost', 'attempt', 'lost', 'attempt', 'synced'])).toEqual([
      'connected',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'connected',
    ]);
  });

  it('retries a first connection that fails as reconnecting', () => {
    expect(run('connecting', ['attempt', 'lost', 'attempt'])).toEqual([
      'connecting',
      'reconnecting',
      'reconnecting',
    ]);
  });

  it('goes offline from any live state and connects afresh when back online', () => {
    for (const state of ['connecting', 'connected', 'reconnecting'] as const) {
      expect(run(state, ['offline', 'lost', 'attempt', 'synced', 'online'])).toEqual([
        'offline',
        'offline',
        'offline',
        'offline',
        'connecting',
      ]);
    }
  });

  it('stays unauthorized once the relay refuses the token, whatever happens next', () => {
    expect(run('connecting', ['rejected'])).toEqual(['unauthorized']);
    expect(run('reconnecting', ['rejected', ...CONNECTION_EVENTS])).toEqual(
      Array.from({ length: CONNECTION_EVENTS.length + 1 }, () => 'unauthorized'),
    );
  });

  it('turns outdated from every state but unauthorized, and stays outdated whatever happens', () => {
    for (const state of ['connecting', 'connected', 'reconnecting', 'offline'] as const) {
      expect(nextConnectionState(state, 'outdated')).toBe('outdated');
    }
    expect(nextConnectionState('unauthorized', 'outdated')).toBe('unauthorized');
    expect(run('connected', ['outdated', ...CONNECTION_EVENTS])).toEqual(
      Array.from({ length: CONNECTION_EVENTS.length + 1 }, () => 'outdated'),
    );
  });

  it('ignores online while already connecting, connected or reconnecting', () => {
    for (const state of ['connecting', 'connected', 'reconnecting'] as const) {
      expect(nextConnectionState(state, 'online')).toBe(state);
    }
  });

  it('keeps a connected client connected on a further sync', () => {
    expect(nextConnectionState('connected', 'synced')).toBe('connected');
  });

  it('answers every state and event with a state', () => {
    for (const state of CONNECTION_STATES) {
      for (const event of CONNECTION_EVENTS) {
        expect(CONNECTION_STATES).toContain(nextConnectionState(state, event));
      }
    }
  });
});
