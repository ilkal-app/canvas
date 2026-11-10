import type { ChangeSet, DocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

/** One agent's trace sheet: the objects it created since the sheet opened. */
export interface TraceSheet {
  /** The agent, `agent:<id>`: the `createdBy` of every object on the sheet. */
  readonly agentId: PrincipalId;
  /** The objects on the sheet, in the order they arrived; never empty. */
  readonly memberIds: readonly ObjectId[];
}

/** What the tracker reads of the board: objects and their change sets. */
export type TraceSheetSource = Pick<DocumentStore, 'get' | 'subscribe'>;

/**
 * Whether a principal is an agent: `agent:<id>`.
 *
 * @param principalId - The principal, as `createdBy` holds it.
 * @returns True for an agent.
 */
function isAgent(principalId: string): principalId is PrincipalId {
  return principalId.startsWith('agent:');
}

/**
 * The person's trace sheets (option A of 2026-10-05): one per agent that creates
 * objects on the board while the person has it open, holding the objects whose `createdBy` is
 * that agent and that arrived since the sheet opened. Only creations that arrive from the relay
 * count (an agent's commands always do), and only once the tracker is armed (`arm`), after the
 * board's first sync, so what was on the board when the person opened it never lands on a
 * sheet. A member someone deletes leaves its sheet, and a sheet left empty closes. The sheets are
 * the person's own view, never written to the document: Keep and Lift off close one (`close`).
 * Main thread.
 */
export class TraceSheetTracker {
  private readonly source: TraceSheetSource;
  private readonly members = new Map<PrincipalId, Set<ObjectId>>();
  private readonly listeners = new Set<() => void>();
  private readonly stop: () => void;
  private snapshot: readonly TraceSheet[] = [];
  private isArmed = false;

  /**
   * Starts following the board; nothing is tracked until `arm`.
   *
   * @param source - The board.
   */
  constructor(source: TraceSheetSource) {
    this.source = source;
    this.stop = source.subscribe((changes) => {
      this.follow(changes);
    });
  }

  /** Starts tracking: creations from here on land on sheets. Idempotent. */
  arm(): void {
    this.isArmed = true;
  }

  /**
   * The open sheets, in the order they opened.
   *
   * @returns The same array until a sheet opens, closes or its members change.
   */
  sheets(): readonly TraceSheet[] {
    return this.snapshot;
  }

  /**
   * Calls `listener` after every change of the sheets, and after any change set that changed a
   * member (its bounds may have moved).
   *
   * @param listener - Called with no arguments.
   * @returns A function that unsubscribes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Closes an agent's sheet (Keep, or after Lift off). The agent's next creation opens a new one.
   *
   * @param agentId - The agent.
   */
  close(agentId: PrincipalId): void {
    if (!this.members.delete(agentId)) return;
    this.publish();
  }

  /** Stops following the board. */
  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  private follow(changes: ChangeSet): void {
    let isChanged = false;
    for (const id of changes.deleted) {
      for (const [agentId, ids] of this.members) {
        if (!ids.delete(id)) continue;
        isChanged = true;
        if (ids.size === 0) this.members.delete(agentId);
      }
    }
    if (this.isArmed && !changes.isLocal) {
      for (const id of changes.created) {
        const createdBy = this.source.get(id)?.createdBy;
        if (createdBy === undefined || !isAgent(createdBy)) continue;
        const ids = this.members.get(createdBy) ?? new Set<ObjectId>();
        this.members.set(createdBy, ids.add(id));
        isChanged = true;
      }
    }
    if (isChanged) {
      this.publish();
    } else if (changes.updated.some((id) => this.isMember(id))) {
      this.notify();
    }
  }

  private isMember(id: ObjectId): boolean {
    for (const ids of this.members.values()) if (ids.has(id)) return true;
    return false;
  }

  private publish(): void {
    this.snapshot = [...this.members].map(([agentId, ids]) => ({
      agentId,
      memberIds: [...ids],
    }));
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
