import { describe, expect, it, vi } from 'vitest';

import { createBrowserNetworkStatus, type NetworkStatusHost } from './network-status.js';

class FakeHost extends EventTarget implements NetworkStatusHost {
  navigator = { onLine: true as boolean | undefined };
}

describe('createBrowserNetworkStatus', () => {
  it('reads navigator.onLine, and treats a host that does not say as online', () => {
    const host = new FakeHost();
    const status = createBrowserNetworkStatus(host);
    expect(status.isOnline()).toBe(true);
    host.navigator.onLine = false;
    expect(status.isOnline()).toBe(false);
    host.navigator.onLine = undefined;
    expect(status.isOnline()).toBe(true);
    expect(createBrowserNetworkStatus({}).isOnline()).toBe(true);
  });

  it('reports the online and offline events until unsubscribed', () => {
    const host = new FakeHost();
    const listener = vi.fn();
    const unsubscribe = createBrowserNetworkStatus(host).subscribe(listener);
    host.dispatchEvent(new Event('offline'));
    host.dispatchEvent(new Event('online'));
    unsubscribe();
    host.dispatchEvent(new Event('offline'));
    expect(listener.mock.calls).toEqual([[false], [true]]);
  });

  it('never reports on a host without events (Node)', () => {
    const unsubscribe = createBrowserNetworkStatus({}).subscribe(() => undefined);
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });
});
