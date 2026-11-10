import { describe, expect, it, vi } from 'vitest';

import type { CollabStatus } from './collab-client-options.js';
import { CollabStatusHolder } from './collab-status-holder.js';

const INITIAL: CollabStatus = {
  state: 'connecting',
  lastSyncedAt: undefined,
  pendingUpdateCount: 0,
  isReadOnly: false,
  isAcknowledged: false,
  rejectionReason: undefined,
};

describe('CollabStatusHolder without a derive function', () => {
  it('applies a change as given: the default derive adds no fields', () => {
    const holder = new CollabStatusHolder(INITIAL);
    const listener = vi.fn();
    holder.subscribe(listener);
    holder.update({ pendingUpdateCount: 3 });
    expect(holder.current).toEqual({ ...INITIAL, pendingUpdateCount: 3 });
    expect(Object.isFrozen(holder.current)).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith(holder.current);
  });

  it('does not notify for a change that leaves the status as it was', () => {
    const holder = new CollabStatusHolder(INITIAL);
    const before = holder.current;
    const listener = vi.fn();
    holder.subscribe(listener);
    holder.update({ pendingUpdateCount: 0 });
    expect(holder.current).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('moves the connection state through the state machine', () => {
    const holder = new CollabStatusHolder(INITIAL);
    holder.transition('synced');
    expect(holder.current.state).toBe('connected');
  });
});

describe('CollabStatusHolder with a derive function', () => {
  it('merges derived fields into every update, and once when it is installed', () => {
    const holder = new CollabStatusHolder(INITIAL);
    holder.deriveWith((status) => ({ isAcknowledged: status.state === 'connected' }));
    expect(holder.current.isAcknowledged).toBe(false);
    holder.transition('synced');
    expect(holder.current).toMatchObject({ state: 'connected', isAcknowledged: true });
  });

  it('stops notifying a listener that unsubscribed, and every listener after clear', () => {
    const holder = new CollabStatusHolder(INITIAL);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = holder.subscribe(first);
    holder.subscribe(second);
    stopFirst();
    holder.update({ isReadOnly: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    holder.clear();
    holder.update({ isReadOnly: false });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
