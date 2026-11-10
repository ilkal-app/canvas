// An honest client for the relay's stamp check fuzz (fix round 2): a real store (which
// stamps before it writes), its undo history, and the updates it has made but not yet sent, as
// a tab of the app holds them while offline or between frames.
import * as Y from 'yjs';

import type { ObjectId, PrincipalId } from '@canvas/schema';

import { createHistory, type UndoHistory } from '../../history/undo-manager.js';
import { ADA, fixtureObject, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import { DocumentWriteError } from '../../store/document-write-error.js';
import { internalsOf } from '../../store/internal.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import type { SeededRandom } from '../../z-order/__fixtures__/seeded-random.js';

/** Ada's principal id, whose history the tabs keep. */
const ADA_ID = 'user:ada' as PrincipalId;

/**
 * One honest tab: a store with a fixed Yjs client id, its history, and its unsent updates.
 */
export class HonestTab {
  /** The tab's store. */
  readonly store: YjsDocumentStore;
  /** The tab's name in failure reports. */
  readonly name: string;
  readonly #history: UndoHistory;
  readonly #outbox: Uint8Array[] = [];
  #created = 0;

  /**
   * Opens a tab.
   *
   * @param name - Its name, also the prefix of the ids it creates.
   * @param clientId - Its Yjs client id.
   */
  constructor(name: string, clientId: number) {
    this.name = name;
    this.store = new YjsDocumentStore({ clientId });
    this.#history = createHistory(this.store, ADA_ID);
    this.store.subscribeUpdates(({ update, isLocal }) => {
      if (isLocal) this.#outbox.push(update);
    });
  }

  /**
   * How many updates the tab holds unsent.
   *
   * @returns The count.
   */
  get unsentCount(): number {
    return this.#outbox.length;
  }

  /**
   * Makes one edit, as a person would: creates an object, locks or unlocks one, deletes one,
   * or undoes or redoes a step.
   *
   * @param random - The seeded choices.
   * @returns What it did, for failure reports.
   * @throws {unknown} What the store throws, other than a refused write.
   */
  edit(random: SeededRandom): string {
    const ids = [...this.store.read().objects.keys()];
    const choice = random.below(10);
    if (choice < 4 || ids.length === 0) return this.#create();
    const target = random.pick(ids);
    if (choice < 6) {
      const isLocked = this.store.get(target)?.locked !== true;
      this.#history.stopCapturing();
      try {
        this.store.transact(ADA, (transaction) => {
          transaction.patchObject(target, { locked: isLocked });
        });
      } catch (error) {
        // A hostile writer's value inside the object fails validation: the store writes nothing.
        if (!(error instanceof DocumentWriteError)) throw error;
        return `lock ${target} refused`;
      }
      return `lock ${target}`;
    }
    if (choice < 7) {
      this.#history.stopCapturing();
      this.store.transact(ADA, (transaction) => {
        transaction.deleteObject(target);
      });
      return `delete ${target}`;
    }
    if (choice < 9) return `undo ${String(this.#history.undo())}`;
    return `redo ${String(this.#history.redo())}`;
  }

  /**
   * Takes the tab's oldest unsent update, as the next frame it sends.
   *
   * @returns The update, or undefined when none is unsent.
   */
  takeNext(): Uint8Array | undefined {
    return this.#outbox.shift();
  }

  /**
   * Takes every unsent update as one, as a tab replays its offline edits.
   *
   * @returns The merged update, or undefined when none is unsent.
   */
  takeAllMerged(): Uint8Array | undefined {
    if (this.#outbox.length === 0) return undefined;
    const merged = Y.mergeUpdates(this.#outbox);
    this.#outbox.length = 0;
    return merged;
  }

  /**
   * What the tab sends when it (re)connects: sync step 2 against the hub's state vector. Its
   * unsent updates are in it, so they are dropped.
   *
   * @param hub - The relay's copy of the board.
   * @returns The update.
   */
  syncStep(hub: Y.Doc): Uint8Array {
    this.#outbox.length = 0;
    return this.store.encodeState(Y.encodeStateVector(hub));
  }

  /**
   * Receives what the hub holds that the tab lacks, as the relay's sync reply and broadcasts.
   *
   * @param hub - The relay's copy of the board.
   * @throws {unknown} What the store throws: a `DocumentVersionError` when the hub holds a board
   *   no store opens, which the fuzz reports.
   */
  receive(hub: Y.Doc): void {
    this.store.applyUpdate(Y.encodeStateAsUpdate(hub, this.store.encodeStateVector()), RELAY);
  }

  /**
   * Gives the tab's document a new Yjs client id, as Yjs does when it finds its id in use.
   *
   * @param clientId - The new id.
   */
  changeClientId(clientId: number): void {
    internalsOf(this.store).doc.clientID = clientId;
  }

  /**
   * Creates an object with a new id, at the root.
   *
   * @returns What it did.
   */
  #create(): string {
    this.#created += 1;
    const id = `${this.name}-${String(this.#created)}` as ObjectId;
    this.#history.stopCapturing();
    this.store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('shape-box', 'shape'), id, parentId: null });
    });
    return `create ${id}`;
  }
}
