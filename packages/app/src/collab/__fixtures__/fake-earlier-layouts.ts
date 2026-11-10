import type {
  CachedBoard,
  DocumentCache,
  EarlierLayoutBoard,
  EarlierLayoutCaches,
  StrandedEdits,
} from '@canvas/collab';

import type { StrandedEditsSource } from '../board-connection.js';

/** Earlier writer layouts' copies of boards, in memory: what an IndexedDB cache finds. */
export class FakeEarlierLayouts implements EarlierLayoutCaches {
  readonly writerLayoutVersion: number;
  readonly #copies = new Map<number, Map<string, CachedBoard>>();

  constructor(writerLayoutVersion: number) {
    this.writerLayoutVersion = writerLayoutVersion;
  }

  put(layoutVersion: number, boardId: string, board: CachedBoard): void {
    const boards = this.#copies.get(layoutVersion) ?? new Map<string, CachedBoard>();
    boards.set(boardId, board);
    this.#copies.set(layoutVersion, boards);
  }

  find(boardId: string): Promise<readonly EarlierLayoutBoard[]> {
    const found = [...this.#copies.entries()]
      .sort(([first], [second]) => first - second)
      .flatMap(([layoutVersion, boards]) => {
        const board = boards.get(boardId);
        return board === undefined
          ? []
          : [
              {
                source: `fake:layout:${String(layoutVersion)}`,
                layoutVersion,
                board,
                updateKeys: [...board.updates.keys()],
                snapshotVersion: board.snapshot === undefined ? undefined : 1,
                isPreLayoutCache: false,
              },
            ];
      });
    return Promise.resolve(found);
  }

  delete(boardId: string, copy: EarlierLayoutBoard): Promise<void> {
    this.#copies.get(copy.layoutVersion)?.delete(boardId);
    return Promise.resolve();
  }
}

/**
 * A cache with earlier layouts beside it, as the IndexedDB cache has.
 *
 * @param cache - The current cache.
 * @param earlierLayouts - Its earlier layouts.
 * @returns The cache.
 */
export function withEarlierLayouts(
  cache: DocumentCache,
  earlierLayouts: EarlierLayoutCaches,
): DocumentCache {
  return {
    earlierLayouts,
    load: (boardId) => cache.load(boardId),
    append: (boardId, update) => cache.append(boardId, update),
    compact: (boardId, snapshot) => cache.compact(boardId, snapshot),
    delete: (boardId) => cache.delete(boardId),
    close: () => {
      cache.close();
    },
  };
}

/** A layout carry-over whose stranded edits the test sets. */
export class FakeCarryOver implements StrandedEditsSource {
  stranded: readonly StrandedEdits[] = [];
  readonly dismissed: string[] = [];
  readonly #listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dismiss(source: string): Promise<void> {
    this.dismissed.push(source);
    this.set(this.stranded.filter((edits) => edits.source !== source));
    return Promise.resolve();
  }

  set(stranded: readonly StrandedEdits[]): void {
    this.stranded = stranded;
    for (const listener of this.#listeners) listener();
  }
}
