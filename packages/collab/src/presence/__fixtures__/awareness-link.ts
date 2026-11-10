import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { Awareness } from 'y-protocols/awareness';

/** A one-way in-process link between two awareness instances; stands in for the relay. */
export interface AwarenessLink {
  /** How many encoded awareness messages crossed the link. */
  readonly messageCount: number;
  /** When each message crossed, in ms on the test clock. */
  readonly sentAtMs: readonly number[];
  /** Stops forwarding, as if the sender's connection dropped without a goodbye. */
  cut(): void;
}

interface AwarenessChange {
  readonly added: readonly number[];
  readonly updated: readonly number[];
  readonly removed: readonly number[];
}

/**
 * Forwards every local awareness update of `from` to `to` as an encoded message, the way a
 * provider sends it to the relay and the relay fans it out. Only updates with origin `local`
 * cross, so two links in opposite directions do not echo.
 *
 * @param from - The sending awareness.
 * @param to - The receiving awareness.
 * @param now - Reads the test clock, to time-stamp messages.
 * @returns The link, with its message count.
 */
export function linkAwareness(from: Awareness, to: Awareness, now: () => number): AwarenessLink {
  const sentAtMs: number[] = [];
  const forward = (change: AwarenessChange, origin: unknown): void => {
    if (origin !== 'local') {
      return;
    }
    const clients = [...change.added, ...change.updated, ...change.removed];
    sentAtMs.push(now());
    applyAwarenessUpdate(to, encodeAwarenessUpdate(from, clients), 'link');
  };
  from.on('update', forward);
  return {
    get messageCount() {
      return sentAtMs.length;
    },
    sentAtMs,
    cut: () => {
      from.off('update', forward);
    },
  };
}
