// The differential run of the relay's stamp check fuzz (fix round 2): honest tabs and
// hostile writers send updates to a relay's copy of a board; the relay applies what
// `UpdateStampCheck` accepts; the real `DocumentVersionGuard` then judges the board, and honest
// tabs must never be refused except for a range really missing.
import * as Y from 'yjs';

import { createSeededRandom, type SeededRandom } from '../../z-order/__fixtures__/seeded-random.js';
import { discardPendingUpdates } from '../pending-updates.js';
import { UpdateStampCheck, type StampCheckVerdict } from '../update-stamp-check.js';

import { updateOf, guardProblemOf, relayHolding } from './stamp-check-fixtures.js';
import { HonestTab } from './stamp-fuzz-honest.js';
import { HostileWriter } from './stamp-fuzz-hostile.js';

/** Who sent an update. */
type Source = 'honest' | 'hostile';

/** How many updates of each source got each verdict. */
export type FuzzTally = Record<Source, Record<StampCheckVerdict['kind'], number>>;

/** What a run of one seed found. */
export interface FuzzOutcome {
  /** The first failure, with its seed and step, or undefined. */
  readonly failure: string | undefined;
  /** The verdicts, by source. */
  readonly tally: FuzzTally;
}

/**
 * A new, empty tally.
 *
 * @returns The tally.
 */
export function emptyTally(): FuzzTally {
  const kinds = (): Record<StampCheckVerdict['kind'], number> => ({
    accepted: 0,
    unstamped: 0,
    'invalid-stamp': 0,
    'update-depth-exceeded': 0,
    'too-many-clients': 0,
    undecodable: 0,
    unprovable: 0,
  });
  return { honest: kinds(), hostile: kinds() };
}

/** Thrown inside a run to stop it at its first failure. */
class FuzzFailure extends Error {}

/**
 * One run: a relay's copy of a board, its check, and the clients that write to it.
 */
class FuzzRun {
  readonly #random: SeededRandom;
  readonly #hub = new Y.Doc();
  readonly #check = new UpdateStampCheck(this.#hub);
  readonly #tabs = [new HonestTab('tab-a', 11), new HonestTab('tab-b', 12)];
  readonly #hostiles: HostileWriter[];
  readonly tally = emptyTally();
  #nextClientId = 1_000;
  /** What the current step does, for failure reports. */
  action = 'start';

  /**
   * Prepares a run.
   *
   * @param seed - The seed of every choice.
   * @param isHostile - Whether hostile writers take part.
   * @throws {Error} When the seeded pending fixture does not create both queues.
   */
  constructor(seed: number, isHostile: boolean) {
    this.#random = createSeededRandom(seed);
    this.#hostiles = isHostile ? [new HostileWriter(77), new HostileWriter(78)] : [];
    // Keep legacy gaps through construction so the first fuzz step exercises a held hub.
    if (seed % 2 === 0) {
      const legacy = new Y.Doc();
      legacy.clientID = 900_000;
      legacy.getText('gap').insert(0, 'missing');
      const pending = updateOf(legacy, () => legacy.getMap('objects').set('unproven', 'old'));
      Y.applyUpdate(this.#hub, pending);
      const deletion = updateOf(legacy, () => {
        legacy.getMap('objects').delete('unproven');
      });
      Y.applyUpdate(this.#hub, deletion);
      if (this.#hub.store.pendingStructs === null || this.#hub.store.pendingDs === null) {
        throw new Error('pending hub fixture must exercise both queues');
      }
      legacy.destroy();
    }
  }

  /** Takes one step: an honest tab's or a hostile writer's. */
  step(): void {
    if (this.#hub.store.pendingStructs !== null) {
      this.action = 'checks and cleans a hub still holding legacy pending structs';
      if (this.#check.check(Uint8Array.of(0, 0)).kind !== 'unprovable') {
        this.#fail('a held hub must refuse unchecked pending release');
      }
      const deletes = this.#hub.store.pendingDs;
      discardPendingUpdates(this.#hub);
      this.#hub.store.pendingDs = deletes;
      return;
    }
    const isHostileTurn = this.#hostiles.length > 0 && this.#random.below(2) === 0;
    if (isHostileTurn) this.#hostileStep(this.#random.pick(this.#hostiles));
    else this.#honestStep(this.#random.pick(this.#tabs));
  }

  /**
   * One honest step: an edit, a frame sent (or lost), offline edits replayed, a reconnect, a
   * sync from the hub, or a new Yjs client id.
   *
   * @param tab - The tab.
   */
  #honestStep(tab: HonestTab): void {
    const choice = this.#random.below(12);
    if (choice < 5) {
      this.action = `${tab.name} ${tab.edit(this.#random)}`;
    } else if (choice < 8) {
      const update = tab.takeNext();
      const isLost = this.#random.below(6) === 0;
      this.action = `${tab.name} ${isLost ? 'loses' : 'sends'} a frame`;
      if (update !== undefined && !isLost) this.#sendHonest(tab, update);
    } else if (choice < 9) {
      this.action = `${tab.name} replays ${String(tab.unsentCount)} offline updates`;
      const update = tab.takeAllMerged();
      if (update !== undefined) this.#sendHonest(tab, update);
    } else if (choice < 10) {
      this.#reconnect(tab);
    } else if (choice < 11) {
      this.action = `${tab.name} receives`;
      this.#receive(tab);
    } else {
      this.#nextClientId += 1;
      this.action = `${tab.name} becomes client ${String(this.#nextClientId)}`;
      tab.changeClientId(this.#nextClientId);
    }
  }

  /**
   * One hostile step: a sync from the hub, or an attack.
   *
   * @param writer - The writer.
   */
  #hostileStep(writer: HostileWriter): void {
    if (this.#random.below(4) === 0) {
      this.action = `client ${String(writer.clientId)} receives`;
      writer.receive(this.#hub);
      return;
    }
    const { update, kind } = writer.attack(this.#random, this.#hub);
    this.action = `client ${String(writer.clientId)} sends ${kind}`;
    this.#offer(update, 'hostile');
  }

  /**
   * Sends an honest tab's update; after a retryable refusal the tab reconnects, as the collab
   * client does on 4425.
   *
   * @param tab - The tab.
   * @param update - The update.
   */
  #sendHonest(tab: HonestTab, update: Uint8Array): void {
    if (this.#offer(update, 'honest').kind !== 'accepted') this.#reconnect(tab);
  }

  /**
   * An honest tab (re)connects: its sync step 2 must be accepted, then it receives the hub.
   *
   * @param tab - The tab.
   */
  #reconnect(tab: HonestTab): void {
    this.action = `${tab.name} reconnects`;
    const verdict = this.#offer(tab.syncStep(this.#hub), 'honest');
    if (verdict.kind !== 'accepted') this.#fail(`an honest resync got ${JSON.stringify(verdict)}`);
    this.#receive(tab);
  }

  /**
   * An honest tab takes in the hub's state; its store must accept it.
   *
   * @param tab - The tab.
   */
  #receive(tab: HonestTab): void {
    try {
      tab.receive(this.#hub);
    } catch (error) {
      this.#fail(`an honest store refused the board: ${String(error)}`);
    }
  }

  /**
   * Offers an update to the relay: checked, then, if accepted, applied to a copy of the hub
   * and judged by the real guard before the hub takes it.
   *
   * @param update - The update.
   * @param source - Who sent it.
   * @returns The verdict.
   */
  #offer(update: Uint8Array, source: Source): StampCheckVerdict {
    const verdict = this.#check.check(update);
    this.tally[source][verdict.kind] += 1;
    const copy = relayHolding(Y.encodeStateAsUpdate(this.#hub));
    try {
      Y.applyUpdate(copy, update);
    } catch (error) {
      if (verdict.kind === 'accepted')
        this.#fail(`Yjs throws on an accepted update: ${String(error)}`);
      return verdict;
    }
    if (verdict.kind === 'accepted') {
      if (copy.store.pendingStructs !== null) this.#fail('an accepted update left structs pending');
      const problem = guardProblemOf(copy);
      if (problem !== undefined) this.#fail(`an accepted update leaves the board ${problem}`);
      Y.applyUpdate(this.#hub, update);
      // A replica loading what the relay stores places every struct afresh.
      const replica = guardProblemOf(relayHolding(Y.encodeStateAsUpdate(this.#hub)));
      if (replica !== undefined) this.#fail(`a replica of the board is ${replica}`);
    } else if (source === 'honest') {
      if (verdict.kind !== 'unprovable') this.#fail(`honest update got ${JSON.stringify(verdict)}`);
      if (copy.store.pendingStructs === null) {
        this.#fail(`honest update held back with nothing missing: ${JSON.stringify(verdict)}`);
      }
    }
    return verdict;
  }

  /**
   * Stops the run.
   *
   * @param message - What went wrong.
   * @throws {FuzzFailure} Always.
   */
  #fail(message: string): never {
    throw new FuzzFailure(message);
  }
}

/**
 * Runs one seed of the stamp check fuzz.
 *
 * @param seed - The seed; the same seed replays the same run.
 * @param steps - How many steps.
 * @param isHostile - Whether hostile writers take part (else honest tabs only).
 * @returns The first failure, if any, with the seed, step and action, and the verdicts.
 * @throws {unknown} What a step throws other than a fuzz failure (a fixture fault).
 */
export function runStampFuzz(seed: number, steps: number, isHostile: boolean): FuzzOutcome {
  const run = new FuzzRun(seed, isHostile);
  for (let step = 0; step < steps; step += 1) {
    try {
      run.step();
    } catch (error) {
      const where = `seed ${String(seed)}, step ${String(step)} (${run.action})`;
      if (error instanceof FuzzFailure) {
        return { failure: `${where}: ${error.message}`, tally: run.tally };
      }
      throw new Error(`${where} threw`, { cause: error });
    }
  }
  return { failure: undefined, tally: run.tally };
}
