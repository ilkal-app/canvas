/**
 * Whether the device has a network, as the platform reports it. The client stops retrying while
 * offline and tries at once when the network returns, instead of waiting out its backoff.
 */
export interface NetworkStatus {
  /**
   * Whether the platform believes the device is online.
   *
   * @returns `false` only when the platform says the device is offline.
   */
  isOnline(): boolean;
  /**
   * Listens for the device going offline or coming back online.
   *
   * @param listener - Called with `true` when back online, `false` when offline.
   * @returns A function that stops listening.
   */
  subscribe(listener: (isOnline: boolean) => void): () => void;
}

/** The parts of `window` (or a worker's global scope) the browser network status reads. */
export interface NetworkStatusHost {
  /** Where `onLine` lives; absent in Node. */
  readonly navigator?: {
    /** `false` when the platform knows the device is offline. */
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the platform's name for it
    readonly onLine?: boolean | undefined;
  };
  /** Registers for `online` and `offline`; absent in Node. */
  addEventListener?: (type: string, listener: () => void) => void;
  /** Unregisters. */
  removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Creates a {@link NetworkStatus} over `navigator.onLine` and the `online` and `offline`
 * events. A host that reports neither (Node, for headless clients) counts as always online;
 * the client's backoff still covers a relay that cannot be reached.
 *
 * @param host - Where to read the status; default `globalThis`.
 * @returns The network status.
 */
export function createBrowserNetworkStatus(host: NetworkStatusHost = globalThis): NetworkStatus {
  return {
    isOnline: () => host.navigator?.onLine !== false,
    subscribe(listener) {
      const onOnline = (): void => {
        listener(true);
      };
      const onOffline = (): void => {
        listener(false);
      };
      host.addEventListener?.('online', onOnline);
      host.addEventListener?.('offline', onOffline);
      return () => {
        host.removeEventListener?.('online', onOnline);
        host.removeEventListener?.('offline', onOffline);
      };
    },
  };
}
