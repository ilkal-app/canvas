import { SYSTEM_ORIGIN, type DocumentStore } from '@canvas/document';

import type { CollabStatus, CollabStatusListener } from '../client/collab-client-options.js';

import { buildRecoveryCandidate } from './cache-recovery-candidate.js';
import type { DocumentCacheBinding } from './document-cache-binding.js';
import type { CapturedRecovery, DocumentCache } from './document-cache.js';

/** Observable retained-cache recovery; original bytes are never retired automatically. */
export interface CacheRecoveryState {
  /** Waiting for authenticated sync, replaying, finished with retained bytes, or failed. */
  readonly phase: 'waiting' | 'recovering' | 'retained' | 'failed';
  /** Whole original records that could not be replayed. */
  readonly unresolvedRecordCount: number;
}

/** The narrow client lifecycle used by recovery. */
export interface RecoveryConnection {
  /** Current authenticated connection state. */
  readonly status: CollabStatus;
  /**
   * Observes connection changes.
   *
   * @param listener - Receives the latest state.
   * @returns Stops observing.
   */
  subscribe(listener: CollabStatusListener): () => void;
}

/** Inputs retained for one automatic reopen recovery. */
export interface CacheRecoveryOptions {
  /** The fresh live store; its identity is never replaced. */
  readonly store: DocumentStore;
  /** The durable, generation-aware device cache. */
  readonly cache: DocumentCache;
  /** The board's cache key. */
  readonly boardId: string;
  /** Flushes all observed live updates before capturing persistence identities. */
  readonly binding: DocumentCacheBinding;
  /** Whether this open refused the active generation itself. */
  readonly isReplacementRequired: boolean;
  /** Reports persistence or candidate failures without deleting their source. */
  readonly onError: (error: unknown) => void;
}

/**
 * Recovers whole provable records after a fresh authenticated sync, publishing durability
 * before replay. Failed and mixed records remain exportable through every future reopen.
 */
export class CacheRecovery {
  readonly #options: CacheRecoveryOptions;
  #state: CacheRecoveryState = Object.freeze({ phase: 'waiting', unresolvedRecordCount: 0 });
  #isDestroyed = false;
  #isPublished = false;
  readonly #listeners = new Set<() => void>();

  /**
   * Creates one reopen recovery controller.
   *
   * @param options - The fresh store and durable generation boundaries.
   */
  constructor(options: CacheRecoveryOptions) {
    this.#options = options;
    this.#isPublished = !options.isReplacementRequired;
  }

  /**
   * Current observable recovery status.
   *
   * @returns Current recovery status.
   */
  get state(): CacheRecoveryState {
    return this.#state;
  }
  /**
   * Reports whether recovery is still working.
   *
   * @returns Whether sendable recovery work is not yet settled.
   */
  get isPending(): boolean {
    return this.#state.phase === 'waiting' || this.#state.phase === 'recovering';
  }
  /**
   * Reports whether durability has moved to a clean generation.
   *
   * @returns Whether compaction may use the new active generation.
   */
  get isPublished(): boolean {
    return this.#isPublished;
  }

  /**
   * Observes changes to retained-content reporting.
   *
   * @param listener - Receives state transitions.
   * @returns Unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Exports original source records; no deletion or acknowledgement is implied.
   *
   * @returns All retained sources, or the still-active source before publication.
   */
  async exportSources(): Promise<readonly CapturedRecovery[]> {
    const { cache, boardId } = this.#options;
    const storage = cache.recovery;
    if (storage === undefined) return [];
    // Capture before reading archives: publication can finish between these awaits and
    // rebind the connection. A pre-publication source must survive that transition.
    const source = this.#isPublished ? undefined : await storage.capture(boardId);
    const retained = await storage.retained(boardId);
    return source === undefined ||
      retained.some(({ generation }) => generation === source.generation)
      ? retained
      : [...retained, source];
  }

  /**
   * Waits for authenticated current state, without blocking createCollabClient on transport.
   *
   * @param client - The client whose fresh board is the recovery reference.
   * @param changed - Refreshes derived acknowledgement after recovery changes state.
   * @returns Stops the in-flight recovery and listener.
   */
  attach(client: RecoveryConnection, changed: () => void): () => void {
    const stop = client.subscribe((status) => {
      if (status.state !== 'connected' || this.#state.phase !== 'waiting') return;
      this.#setState('recovering', 0);
      void this.#run(client).catch(this.#options.onError).finally(changed);
    });
    return () => {
      this.#isDestroyed = true;
      stop();
      this.#listeners.clear();
    };
  }

  /**
   * Runs the durable publication and replay sequence.
   *
   * @param client - Its current status fences asynchronous publication and replay.
   */
  async #run(client: RecoveryConnection): Promise<void> {
    const { cache, boardId, store, binding } = this.#options;
    try {
      const storage = cache.recovery;
      if (storage === undefined) throw new Error('This cache cannot retain recovery generations.');
      await binding.flush();
      const captured = await storage.capture(boardId);
      const sources = [...(await storage.retained(boardId)), captured];
      const manualCount = sources
        .filter(({ replayPolicy }) => replayPolicy === 'manual')
        .reduce(
          (sum, { board }) => sum + board.updates.length + (board.snapshot === undefined ? 0 : 1),
          0,
        );
      const records = sources
        .filter(({ replayPolicy }) => replayPolicy !== 'manual')
        .flatMap(({ board }) =>
          board.snapshot === undefined ? [...board.updates] : [board.snapshot, ...board.updates],
        );
      if (this.#hasStopped()) return;
      this.#setState('recovering', records.length + manualCount);
      if (client.status.isReadOnly) {
        this.#setState('retained', records.length + manualCount);
        return;
      }
      const candidate = buildRecoveryCandidate(store.encodeState(), records);
      if (candidate.updates.length === 0 && this.#isPublished) {
        this.#setState('retained', candidate.unresolved.length + manualCount);
        return;
      }
      if (client.status.state !== 'connected')
        throw new Error('Recovery lost its authenticated connection.');
      if (!(await storage.publish(boardId, captured, candidate.snapshot)))
        throw new Error('Recovery source changed; reopen to retry without losing retained edits.');
      this.#isPublished = true;
      if (this.#hasStopped()) return;
      if (!this.#canReplay(client)) throw new Error('Recovery connection changed before replay.');
      for (const update of candidate.updates) store.applyUpdate(update, SYSTEM_ORIGIN);
      this.#setState('retained', candidate.unresolved.length + manualCount);
    } catch (error: unknown) {
      if (!this.#isDestroyed) this.#setState('failed', this.#state.unresolvedRecordCount);
      throw error;
    }
  }

  /**
   * Reads lifecycle state again after asynchronous cache work.
   *
   * @returns Whether this controller has been destroyed.
   */
  #hasStopped(): boolean {
    return this.#isDestroyed;
  }

  /**
   * Rechecks transport permission after durable publication.
   *
   * @param client - The live connection.
   * @returns Whether replay is currently permitted.
   */
  #canReplay(client: RecoveryConnection): boolean {
    return client.status.state === 'connected' && !client.status.isReadOnly;
  }

  /**
   * Publishes a new recovery status.
   *
   * @param phase - New phase.
   * @param count - Whole unresolved records.
   */
  #setState(phase: CacheRecoveryState['phase'], count: number): void {
    this.#state = Object.freeze({ phase, unresolvedRecordCount: count });
    for (const listener of [...this.#listeners]) listener();
  }
}
