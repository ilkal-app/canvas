// The stamp check's replay of Yjs's integration as it was before (at 0fa53e08), kept
// only as a test oracle: its set-aside removed each stacked client from the list of clients
// left with a filter per stacked item (as Yjs's `addStackToRestSS` does), quadratic in the
// stack. `update-integration.equivalence.test.ts` holds the linear replay to it on random
// updates. The stacked-work property also uses it as a bounded quadratic negative control;
// nothing else may import it. Delete it when the replay next follows a Yjs upgrade.
import * as Y from 'yjs';

import { findScannedItem, isScannedItemWhollyDeleted } from '../../assets/scanned-item-lookup.js';
import { NO_CLIENT, type ScannedItem, type UpdateScan } from '../../assets/update-scan.js';
import { COLLECTED, HeldStructs, type FoundStruct, type Landing } from '../held-structs.js';
import type { HoldBackCause, IntegrationReplay } from '../update-integration.js';

/** A client's structs as Yjs reads them, and the next to take. */
interface StructTarget {
  i: number;
  refs: readonly ScannedItem[];
}

/**
 * A struct Yjs would not find (it throws), or an item Yjs would place where no replica loading
 * the same structs later places it.
 */
const MALFORMED = 'malformed';

/**
 * Tells whether two items sit in the same list: the same parent and key.
 *
 * @param first - One item's landing.
 * @param second - The other's.
 * @returns True when they share parent and key.
 */
function isSamePlace(first: Landing, second: Landing): boolean {
  return first.parent === second.parent && first.parentSub === second.parentSub;
}

/**
 * Replays Yjs's integration of one scanned update into one document (before).
 */
class IntegrationReplayer {
  readonly #doc: Y.Doc;
  readonly #scan: UpdateScan;
  readonly #maxSteps: number;
  readonly #targets = new Map<number, StructTarget>();
  #ids: number[] = [];
  readonly #stack: ScannedItem[] = [];
  readonly #states = new Map<number, number>();
  readonly #initialStates = new Map<number, number>();
  readonly #landings = new Map<ScannedItem, Landing>();
  readonly #heldBack = new Map<number, HoldBackCause>();
  readonly #held: HeldStructs;
  #steps = 0;
  #isMalformed = false;

  /**
   * Prepares a replay.
   *
   * @param doc - The document; read, never changed.
   * @param scan - The update, scanned with `shouldKeepEveryStruct`.
   * @param maxSteps - The work ceiling, in structs taken.
   */
  constructor(doc: Y.Doc, scan: UpdateScan, maxSteps: number) {
    this.#doc = doc;
    this.#held = new HeldStructs(doc);
    this.#scan = scan;
    this.#maxSteps = maxSteps;
  }

  /**
   * Runs the replay: `integrateStructs`, step for step.
   *
   * @returns What Yjs would do.
   */
  replay(): IntegrationReplay {
    for (const [client, refs] of this.#scan.items) {
      if (refs.length > 0) this.#targets.set(client, { i: 0, refs });
    }
    this.#ids = [...this.#targets.keys()].sort((first, second) => first - second);
    let current = this.#nextTarget();
    let head = current === undefined ? undefined : current.refs[current.i++];
    while (head !== undefined && !this.#isMalformed) {
      this.#steps += 1;
      if (this.#steps > this.#maxSteps) break;
      const next = this.#step(head);
      if (next !== undefined) {
        head = next;
        continue;
      }
      head = this.#stack.pop();
      if (head === undefined && current !== undefined && current.i < current.refs.length) {
        head = current.refs[current.i++];
      } else if (head === undefined) {
        current = this.#nextTarget();
        head = current === undefined ? undefined : current.refs[current.i++];
      }
    }
    return {
      landings: this.#landings,
      heldBack: this.#heldBack,
      initialStates: this.#initialStates,
      isMalformed: this.#isMalformed,
      isExhausted: this.#steps > this.#maxSteps,
    };
  }

  /**
   * Takes one struct as `integrateStructs` does: skips a skipped range, sets aside a client
   * whose clocks leave a gap, follows a missing dependency into its client's structs, or
   * integrates.
   *
   * @param head - The struct.
   * @returns The struct to take next when a dependency is followed; else undefined.
   */
  #step(head: ScannedItem): ScannedItem | undefined {
    if (head.content === 'skip') return undefined;
    const offset = this.#state(head.client) - head.clock;
    if (offset < 0) {
      this.#stack.push(head);
      this.#setAsideStack('clock-gap');
      return undefined;
    }
    const missing = this.#missingClient(head);
    if (missing !== undefined) {
      this.#stack.push(head);
      const target = this.#targets.get(missing) ?? { i: 0, refs: [] };
      if (target.refs.length === target.i) {
        this.#setAsideStack('missing-dependency');
        return undefined;
      }
      return target.refs[target.i++];
    }
    // Yjs resolves the neighbours of a struct it already holds too, and throws the same way.
    const landing = head.content === 'gc' ? COLLECTED : this.#landingOf(head);
    if (landing === MALFORMED || !this.#isSound(head, offset, landing)) {
      this.#isMalformed = true;
    } else if (offset === 0 || offset < head.length) {
      this.#landings.set(head, landing);
      this.#states.set(head.client, head.clock + head.length);
    }
    return undefined;
  }

  /**
   * Tells whether Yjs would keep its lists sound with an item: a live map value spans one clock
   * (Yjs writes each value alone, and merges only deleted ones, which an undo history keeps;
   * split later, a longer live one leaves a live value beside the key's current one, and
   * deleting the map then throws in Yjs's collection), and an item integrated
   * part way continues its held part.
   *
   * @param item - The item.
   * @param offset - How many of its clocks the document holds.
   * @param landing - Where its neighbours put it.
   * @returns True when sound.
   */
  #isSound(item: ScannedItem, offset: number, landing: Landing): boolean {
    // A struct the document already holds whole is skipped, and one Yjs collects links nowhere.
    if (landing.isCollected || (offset > 0 && offset >= item.length)) return true;
    const isDeleted = item.content === 'deleted' || isScannedItemWhollyDeleted(this.#scan, item);
    if (landing.parentSub !== undefined && item.length > 1 && !isDeleted) {
      return false;
    }
    return offset === 0 || this.#continuesHeldPart(item, offset, landing);
  }

  /**
   * Tells whether an item Yjs integrates only past the clocks it already holds lands where its
   * held part does: Yjs links that rest after the held part (`Item.integrate` with an offset)
   * but keeps the parent its neighbours named, so a rest whose neighbours name another place
   * corrupts the document's lists (a later deletion there throws), and one after a collected
   * struct throws. An honest update overlaps the relay's copy only on an item split where the
   * relay's copy ends, which lands where its held part does.
   *
   * @param item - The item.
   * @param offset - How many of its clocks the document holds.
   * @param landing - Where its neighbours put it.
   * @returns True when the rest continues the held part.
   */
  #continuesHeldPart(item: ScannedItem, offset: number, landing: Landing): boolean {
    const held = this.#held.find(item.client, item.clock + offset - 1).landing;
    return !held.isCollected && isSamePlace(held, landing);
  }

  /**
   * The next client whose structs are left, highest id first (`getNextStructTarget`).
   *
   * @returns Its structs, or undefined when every client is done.
   */
  #nextTarget(): StructTarget | undefined {
    for (;;) {
      const client = this.#ids.at(-1);
      if (client === undefined) return undefined;
      const target = this.#targets.get(client);
      if (target !== undefined && target.i < target.refs.length) return target;
      this.#ids.pop();
    }
  }

  /**
   * Sets aside the rest of every stacked client's structs, which Yjs keeps pending
   * (`addStackToRestSS`).
   *
   * @param cause - Why the top of the stack could not be integrated.
   */
  #setAsideStack(cause: HoldBackCause): void {
    for (const item of this.#stack) {
      const target = this.#targets.get(item.client);
      if (target !== undefined) {
        target.i = 0;
        target.refs = [];
        this.#targets.delete(item.client);
      }
      if (!this.#heldBack.has(item.client)) this.#heldBack.set(item.client, cause);
      this.#ids = this.#ids.filter((client) => client !== item.client);
    }
    this.#stack.length = 0;
  }

  /**
   * The client of a neighbour or parent of another client that the document does not hold yet,
   * as `Item.getMissing` checks them (its own client's are not checked: Yjs takes them in order).
   *
   * @param item - The struct.
   * @returns That client, or undefined when nothing is missing.
   */
  #missingClient(item: ScannedItem): number | undefined {
    const dependencies: [number, number][] = [
      [item.originClient, item.originClock],
      [item.rightOriginClient, item.rightOriginClock],
      [item.parentClient, item.parentClock],
    ];
    for (const [client, clock] of dependencies) {
      if (client !== NO_CLIENT && client !== item.client && clock >= this.#state(client)) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Where an item lands (`Item.getMissing`, once nothing is missing): collected when either
   * neighbour is collected; else the parent it names, or its left neighbour's, or its right one's.
   *
   * @param item - The item.
   * @returns The landing, or {@link MALFORMED} when Yjs would not find a struct it names, or its
   *   two neighbours sit in different lists.
   */
  #landingOf(item: ScannedItem): Landing | typeof MALFORMED {
    const left = this.#find(item.originClient, item.originClock);
    const right = this.#find(item.rightOriginClient, item.rightOriginClock);
    if (left === MALFORMED || right === MALFORMED) return MALFORMED;
    if (left?.landing.isCollected === true || right?.landing.isCollected === true) {
      return COLLECTED;
    }
    // Yjs takes the place from the left neighbour. A right one elsewhere is dropped here, but
    // collected later (its list deleted) it collects this item on every replica that loads it
    // afterwards, while this document keeps it: a stamp would then vanish from their chains.
    if (left !== undefined && right !== undefined && !isSamePlace(left.landing, right.landing)) {
      return MALFORMED;
    }
    const neighbour = left ?? right;
    if (neighbour !== undefined) return neighbour.landing;
    const { parentName, parentSub } = item;
    if (parentName !== undefined) {
      return { isCollected: false, parentName, parentSub, parent: parentName };
    }
    const parent = this.#find(item.parentClient, item.parentClock);
    if (parent === MALFORMED) return MALFORMED;
    // A parent that is collected, or holds no type (Yjs reads `content.type`), collects it.
    if (parent?.type === undefined) return COLLECTED;
    return { isCollected: false, parentName: undefined, parentSub, parent: parent.type };
  }

  /**
   * Finds the struct holding an id, as Yjs's store would at this point of the replay: the
   * document's for clocks it held before, the update's integrated ones after.
   *
   * @param client - The id's client, or {@link NO_CLIENT} for none.
   * @param clock - The id's clock.
   * @returns The struct, undefined for no id, or {@link MALFORMED} when nothing holds it.
   */
  #find(client: number, clock: number): FoundStruct | undefined | typeof MALFORMED {
    if (client === NO_CLIENT) return undefined;
    if (clock < this.#initialState(client)) return this.#held.find(client, clock);
    const item = findScannedItem(this.#scan, client, clock);
    const landing = item === undefined ? undefined : this.#landings.get(item);
    if (item === undefined || landing === undefined) return MALFORMED;
    const isType = !landing.isCollected && item.content === 'type';
    return { landing, type: isType ? item : undefined };
  }

  /**
   * A client's state (next clock) now: the document's, raised by what the replay integrated.
   *
   * @param client - The client.
   * @returns The state.
   */
  #state(client: number): number {
    return this.#states.get(client) ?? this.#initialState(client);
  }

  /**
   * A client's state in the document before the update, read once.
   *
   * @param client - The client.
   * @returns The state.
   */
  #initialState(client: number): number {
    let state = this.#initialStates.get(client);
    if (state === undefined) {
      state = Y.getState(this.#doc.store, client);
      this.#initialStates.set(client, state);
    }
    return state;
  }
}

/**
 * The pre- replay (quadratic set-aside), for comparison with `replayIntegration` only.
 *
 * @param doc - The document the update is bound for; read, never changed.
 * @param scan - The update, scanned with `shouldKeepEveryStruct`.
 * @param maxSteps - The work ceiling, in structs taken.
 * @returns What Yjs would do.
 */
export function replayIntegrationEagerly(
  doc: Y.Doc,
  scan: UpdateScan,
  maxSteps: number,
): IntegrationReplay {
  return new IntegrationReplayer(doc, scan, maxSteps).replay();
}
