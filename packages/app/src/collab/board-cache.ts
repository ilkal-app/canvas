import { openIndexedDbCache, type DocumentCache } from '@canvas/collab';

/**
 * Opens the device's board cache: the collab package's IndexedDB cache under its default
 * namespace (`DEFAULT_CACHE_DATABASE_NAME`) and this build's writer-layout suffix,
 * where every board is keyed by its id. The relay
 * path (through the collab client) and the local board both use it, so a board edited without
 * the relay is the same cached board the relay path opens later. None where the platform has
 * no IndexedDB. Main thread.
 *
 * Keyed by board id only, deliberately while identities are per-tab guests: on a shared browser
 * profile, edits one guest made offline are restored into the next person's store for that board
 * and sent to the relay over that person's connection. When sign-in exists this must change (a
 * cache keyed by board and principal, or offline edits held until the same principal returns).
 *
 * @returns The cache, or `undefined`.
 * @throws {DOMException} When IndexedDB refuses to open the database (as a rejection).
 */
export function openDefaultBoardCache(): Promise<DocumentCache | undefined> {
  return typeof indexedDB === 'undefined' ? Promise.resolve(undefined) : openIndexedDbCache();
}

/**
 * Opens a board cache, reporting a failure (private browsing, a blocked or full database) and
 * going on without one: the board is then only in memory.
 *
 * @param open - Opens the cache; {@link openDefaultBoardCache} when absent.
 * @param report - Receives the failure.
 * @returns The cache, or `undefined`.
 */
export async function openBoardCacheOrNone(
  open: (() => Promise<DocumentCache | undefined>) | undefined,
  report: (error: unknown) => void,
): Promise<DocumentCache | undefined> {
  try {
    return await (open ?? openDefaultBoardCache)();
  } catch (error: unknown) {
    report(error);
    return undefined;
  }
}
