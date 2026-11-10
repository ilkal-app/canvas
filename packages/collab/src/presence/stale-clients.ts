import type { PresenceClientId } from './presence-state.js';

/**
 * Finds the remote clients that have sent nothing for the whole awareness timeout. A client
 * renews its state at least every half timeout while it is connected, so silence this long
 * means it is gone without having said so (a closed laptop, a lost network).
 *
 * @param lastSeenAtMs - When each remote client was last heard from, in ms; not mutated.
 * @param nowMs - The current time, in ms.
 * @param timeoutMs - How long silence lasts before a client is removed, in ms.
 * @returns The stale clients' ids, in the map's order.
 */
export function findStaleClients(
  lastSeenAtMs: ReadonlyMap<PresenceClientId, number>,
  nowMs: number,
  timeoutMs: number,
): PresenceClientId[] {
  const stale: PresenceClientId[] = [];
  for (const [clientId, seenAtMs] of lastSeenAtMs) {
    if (nowMs - seenAtMs >= timeoutMs) {
      stale.push(clientId);
    }
  }
  return stale;
}

/**
 * How long until the channel sweeps again: its regular interval, or sooner when a client turns
 * stale before that, so a silent peer leaves when the timeout passes rather than up to an
 * interval later (a peer's editing state clears within the timeout). A client's last
 * message only moves later, so a sweep this early never misses one. Pure.
 *
 * @param lastSeenAtMs - When each remote client was last heard from, ms on the local clock.
 * @param nowMs - The current time, ms.
 * @param timeoutMs - How long a silent client stays, ms.
 * @param intervalMs - The regular sweep interval, ms.
 * @returns The delay, ms: from 0 to `intervalMs`.
 */
export function nextSweepDelayMs(
  lastSeenAtMs: ReadonlyMap<PresenceClientId, number>,
  nowMs: number,
  timeoutMs: number,
  intervalMs: number,
): number {
  let delayMs = intervalMs;
  for (const seenAtMs of lastSeenAtMs.values()) {
    delayMs = Math.min(delayMs, Math.max(0, seenAtMs + timeoutMs - nowMs));
  }
  return delayMs;
}
