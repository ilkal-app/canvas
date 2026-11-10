// A person's board and an agent working on it from a client of its own, linked by hand as the
// relay would link them: what the agent creates reaches the person's store as a remote update
// (`isLocal` false), as an MCP agent's commands do. With a fake connection the shell reads.
import {
  createObjectsCommand,
  createRandomObjectId,
  moveObjectsCommand,
  parseTransactionOrigin,
  runCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type {
  BoardConnectionStatus,
  CollaboratorSummary,
} from '../../collab/board-connection-status.js';
import type { BoardConnection } from '../../collab/board-connection.js';

/** Ada, the person whose shell shows the sheets. */
export const ADA_ORIGIN: TransactionOrigin = parseTransactionOrigin({
  kind: 'user',
  principalId: 'user:ada',
});

/** Atlas, an agent Ada operates, as presence shows it. */
export const ATLAS: CollaboratorSummary = {
  principalId: 'atlas',
  kind: 'agent',
  name: 'Atlas',
  color: '#c15f3c',
};

const ENVIRONMENT = { clock: () => 1_770_000_000_000, createId: createRandomObjectId };

/** A board connection whose status the test sets. */
export class FakeConnection implements BoardConnection {
  readonly store: YjsDocumentStore;
  readonly origin = ADA_ORIGIN;
  #status: BoardConnectionStatus = {
    boardId: 'board-1',
    state: 'connecting',
    isLocalOnly: false,
    isSavedOnDevice: true,
    pendingUpdateCount: 0,
    isAcknowledged: false,
    isReadOnly: false,
    rejectionReason: undefined,
    collaborators: [ATLAS],
    strandedEdits: [],
  };
  readonly #listeners = new Set<() => void>();

  /**
   * Wraps a store.
   *
   * @param store - The person's store.
   */
  constructor(store: YjsDocumentStore) {
    this.store = store;
  }

  status(): BoardConnectionStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Changes the status and tells the listeners.
   *
   * @param change - The fields that change.
   */
  set(change: Partial<BoardConnectionStatus>): void {
    this.#status = { ...this.#status, ...change };
    for (const listener of [...this.#listeners]) listener();
  }

  dismissStrandedEdits(): void {
    // Nothing is stranded.
  }

  destroy(): void {
    // The test owns the store.
  }
}

/** The person's board, an agent's client beside it, and the connection. */
export interface AgentBoard {
  readonly person: YjsDocumentStore;
  readonly agent: YjsDocumentStore;
  readonly connection: FakeConnection;
  /**
   * Creates rectangles as an agent, in its client, and delivers them to the person.
   *
   * @param xs - Each rectangle's left edge, board units; 100 × 60 at y 0.
   * @param agentId - The agent's bare id; `atlas` if absent.
   * @returns Their ids.
   */
  agentCreates(xs: readonly number[], agentId?: string): ObjectId[];
  /**
   * Moves an object as the person, in the person's store, and delivers it to the agent.
   *
   * @param id - The object.
   */
  personMoves(id: ObjectId): void;
}

/**
 * Sends one store what another lacks, as the relay would: a remote update.
 *
 * @param from - The store that has the updates.
 * @param to - The store that receives them.
 */
function deliver(from: YjsDocumentStore, to: YjsDocumentStore): void {
  to.applyUpdate(from.encodeState(to.encodeStateVector()), SYSTEM_ORIGIN);
}

/**
 * A board for trace sheet tests.
 *
 * @returns The board.
 */
export function createAgentBoard(): AgentBoard {
  const person = new YjsDocumentStore();
  const agent = new YjsDocumentStore();
  const connection = new FakeConnection(person);
  return {
    person,
    agent,
    connection,
    agentCreates: (xs, agentId = 'atlas') => {
      const origin = parseTransactionOrigin({
        kind: 'agent',
        principalId: `agent:${agentId}`,
        operatorId: 'user:ada',
      });
      const objects = xs.map((x) => ({
        type: 'shape' as const,
        x,
        y: 0,
        width: 100,
        height: 60,
        kind: 'rectangle' as const,
        stroke: null,
        fill: [1, 1, 1, 1] as [number, number, number, number],
        cornerRadius: 0,
        sides: 4,
        label: null,
      }));
      const outcome = runCommand(agent, origin, createObjectsCommand, { objects }, ENVIRONMENT);
      if (outcome.status !== 'applied') throw new Error('the agent could not create');
      deliver(agent, person);
      return [...outcome.result.ids];
    },
    personMoves: (id) => {
      const moves = [{ id, by: { x: 0, y: 40 } }];
      runCommand(person, ADA_ORIGIN, moveObjectsCommand, { moves }, ENVIRONMENT);
      deliver(person, agent);
    },
  };
}
