import {
  createRandomObjectId,
  findCommand,
  runCommand,
  type CommandError,
  type CommandInput,
  type CommandName,
  type CommandResult,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import {
  exportBoard,
  type BoardObject,
  type ObjectId,
  type PortableBoardJson,
  type PrincipalId,
} from '@canvas/schema';

import { importPortableBoard, type ImportOptions, type ImportOutcome } from './portable-import.js';

/**
 * Who a command run through the SDK is attributed to: the person at the board (`user`), or an
 * agent working for them (`agent`), whose changes they can undo.
 */
export type CommandOrigin = 'user' | 'agent';

/** What {@link CanvasDocument.run} is given besides the command and its input. */
export interface RunOptions {
  /** Who the change is attributed to; `user` if absent. */
  readonly origin?: CommandOrigin;
}

/** The objects a change created, updated and deleted, by id. */
export interface ObjectChanges {
  /** Objects added to the board. */
  readonly created: readonly ObjectId[];
  /** Objects whose fields, text or placement changed. */
  readonly updated: readonly ObjectId[];
  /** Objects removed from the board. */
  readonly deleted: readonly ObjectId[];
}

/** The outcome of {@link CanvasDocument.run}. */
export type RunOutcome<Name extends CommandName> =
  | {
      /** The command ran, as one undo step. */
      readonly status: 'applied';
      /** What the command returned. */
      readonly result: CommandResult<Name>;
      /** What it changed. */
      readonly changes: ObjectChanges;
    }
  | {
      /** The command was refused: nothing was written. */
      readonly status: 'rejected';
      /** Every problem found; never empty. */
      readonly errors: readonly CommandError[];
    };

/**
 * A mounted board's document: its objects to read, and the command layer's commands to
 * change it, the same commands the shell, agents and the relay use. There is no other way to
 * write: every change is a command, with its origin.
 */
export interface CanvasDocument {
  /**
   * One object as it is now.
   *
   * @param id - The object's id.
   * @returns The object, frozen, or `undefined` when the board has none by that id.
   */
  get(id: string): BoardObject | undefined;
  /**
   * Every object on the board, on every page, in no particular order.
   *
   * @returns The objects, frozen.
   */
  objects(): readonly BoardObject[];
  /**
   * Runs a command: parses its input, checks it against the board, and applies it in one
   * transaction and one undo step, or refuses it whole.
   *
   * @param command - The command's name (`createObject`, `moveObjects`, `setStyle`, ...).
   * @param input - Its input, as the command's schema takes it.
   * @param options - Who the change is attributed to.
   * @returns What it returned and changed, or why it was refused.
   * @throws {TypeError} When there is no command by that name.
   */
  run<Name extends CommandName>(
    command: Name,
    input: CommandInput<Name>,
    options?: RunOptions,
  ): RunOutcome<Name>;
  /**
   * The board as a portable board document (`exportBoard` of the schema): its pages, colour
   * tokens, named styles and objects, sorted, so the same board gives the same JSON.
   *
   * @returns The document, ready for `JSON.stringify`.
   */
  export(): PortableBoardJson;
  /**
   * Creates a portable board document's objects on the board, as one command: checked and
   * migrated, then created with fresh ids, the references between them kept, in one undo step,
   * or refused whole. The document's own pages, tokens and styles are not created.
   *
   * @param json - The document, parsed (`JSON.parse` of an export).
   * @param options - The page and parent the objects go in, and who the change is attributed to.
   * @returns The new ids and each document id's new id, or why nothing was written (a document
   *   with no objects is `invalid`, as the MCP server's import refuses one).
   */
  import(json: unknown, options?: ImportOptions): ImportOutcome;
}

/** The agent the SDK's agent-origin commands are attributed to. */
const SDK_AGENT = 'agent:sdk' as PrincipalId;

/**
 * The origin a run is attributed to: the board's user, or the SDK's agent operated by them, so
 * the person's undo takes the agent's work back too.
 *
 * @param user - The board's user origin.
 * @param origin - Who the host says made the change.
 * @returns The transaction origin.
 */
function originOf(user: TransactionOrigin, origin: CommandOrigin): TransactionOrigin {
  if (origin === 'user') return user;
  return Object.freeze({ kind: 'agent', principalId: SDK_AGENT, operatorId: user.principalId });
}

/**
 * The document of a board's store.
 *
 * @param store - The board's store.
 * @param user - Who the board's user is (the connection's origin).
 * @returns The document.
 */
export function createCanvasDocument(
  store: DocumentStore,
  user: TransactionOrigin,
): CanvasDocument {
  const environment = { clock: () => Date.now(), createId: createRandomObjectId };
  const document: CanvasDocument = {
    get: (id) => store.get(id as ObjectId),
    objects: () => [...store.read().objects.values()],
    run(command, input, options = {}) {
      const found = findCommand(command);
      if (found === undefined) throw new TypeError(`There is no command named "${command}".`);
      const outcome = runCommand(
        store,
        originOf(user, options.origin ?? 'user'),
        found,
        input,
        environment,
      );
      if (outcome.status === 'rejected') return outcome;
      const { created, updated, deleted } = outcome.changes;
      return {
        status: 'applied',
        result: outcome.result as CommandResult<typeof command>,
        changes: { created, updated, deleted },
      };
    },
    export: () => exportBoard(store.read()),
    import: (json, options) => importPortableBoard(document, json, options),
  };
  return document;
}
