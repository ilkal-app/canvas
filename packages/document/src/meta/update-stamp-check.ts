import type * as Y from 'yjs';

import { UpdateDepthError } from '../assets/update-depth.js';
import { scanUpdate } from '../assets/update-scan.js';

import { META_MAP_NAME } from './document-meta.js';
import { judgeFacilitationWrites } from './facilitation-values.js';
import { judgeFieldWrites, type HostileValue } from './field-values.js';
import { judgePageWrites } from './page-values.js';
import { addStampWriters } from './stamp-writers.js';
import { judgeStyleWrites } from './style-values.js';
import { judgeTokenWrites } from './token-values.js';
import { countUpdateClients, MAX_UPDATE_CLIENTS } from './update-client-bound.js';
import { readUpdateStamps, type StampReading } from './update-stamp-reading.js';

/** The scan keeps every struct: the check replays Yjs's integration of them all. */
const EVERY_STRUCT = { shouldKeepEveryStruct: true } as const;

/**
 * The most structs one check takes, as Yjs's integration takes them (each once, plus once more
 * per dependency followed): about ten times the items of a 50k-object board's whole state
 * (374k), so a check stays within a small multiple of what Yjs spends applying such an update.
 * Past it the update is unprovable.
 */
export const MAX_STAMP_CHECK_STEPS = 4_000_000;

/**
 * Why an update could not be proven safe; see {@link UpdateStampCheck}: a client's own earlier
 * clocks are missing (`clock-gap`), a neighbour or parent of another client is
 * (`missing-dependency`), the work ceiling was hit, or the bytes cannot be read, or would make
 * Yjs throw part way (`unreadable-update`).
 */
export type UnprovableCause =
  'clock-gap' | 'missing-dependency' | 'work-ceiling' | 'unreadable-update';

/** The check's answer for one update. */
export type StampCheckVerdict =
  | {
      /**
       * More clients than `MAX_UPDATE_CLIENTS`, refused before any replay: an
       * honest writer never sends so many, and a hostile one can stack their structs.
       */
      readonly kind: 'too-many-clients';
      /** Empty: the bound applies to the whole update. */
      readonly writers: readonly number[];
    }
  | {
      /** Plain values exceed the supported nesting bound: refuse without retrying. */
      readonly kind: 'update-depth-exceeded';
      /** Empty: the depth limit applies to the whole update. */
      readonly writers: readonly number[];
    }
  | {
      /**
       * Every object entry's writer stamped, and every stamp is acceptable: apply it, unless the
       * door check of its values found one out of range (`hostileValue`, part 1).
       */
      readonly kind: 'accepted';
      /**
       * The first value the update writes into an object that is not finite or is out of the
       * range a renderer draws within (`drawableValuesReason` in `@canvas/schema`): the relay
       * refuses the update. Absent when every judged value is in range, and on a durable
       * history replay, which judges no value.
       */
      readonly hostileValue?: HostileValue;
      /**
       * How many values have an older layout's shape than the board's (a whole `points` pair on
       * a board of layout 2 or above), in range: counted, not refused. Absent for none.
       */
      readonly layoutShapedWrites?: number;
      /**
       * Where the update's values Yjs cannot decode would land (JSON, an embed or a
       * format whose text does not parse, which makes `Y.applyUpdate` throw before it applies
       * anything): `nowhere` (in an object deleted since, at clocks the board holds, or removed
       * by the update itself) or `on-board`. The relay never hands such bytes to Yjs. Absent for
       * none.
       */
      readonly undecodable?: 'nowhere' | 'on-board';
    }
  | {
      /**
       * Values Yjs cannot decode, in an update the check would not accept anyway:
       * refuse, for good, without decoding it.
       */
      readonly kind: 'undecodable';
      /** Empty: it applies to the whole update. */
      readonly writers: readonly number[];
    }
  | {
      /** Writers that give object entries without ever stamping: refuse, for good. */
      readonly kind: 'unstamped';
      /** Their Yjs client ids, ascending. */
      readonly writers: readonly number[];
    }
  | {
      /** Writers of a stamp the relay refuses (`isAcceptableStamp`): refuse, for good. */
      readonly kind: 'invalid-stamp';
      /** Their Yjs client ids, ascending. */
      readonly writers: readonly number[];
    }
  | {
      /** The update may give unstamped object entries and the check cannot tell: not yet. */
      readonly kind: 'unprovable';
      /** What the check could not see. */
      readonly cause: UnprovableCause;
      /** The writers concerned, ascending; empty for the whole update. */
      readonly writers: readonly number[];
    };

/** The accepted verdict. */
const ACCEPTED: StampCheckVerdict = Object.freeze({ kind: 'accepted' });

/** The verdict on an update of more clients than the bound. */
const TOO_MANY_CLIENTS: StampCheckVerdict = Object.freeze({
  kind: 'too-many-clients',
  writers: Object.freeze([]),
});

/** The verdict on bytes the check cannot read, or that would make Yjs throw part way. */
const UNREADABLE: StampCheckVerdict = Object.freeze({
  kind: 'unprovable',
  cause: 'unreadable-update',
  writers: Object.freeze([]),
});

/** The verdict on values Yjs cannot decode in an update the check would not accept. */
const UNDECODABLE: StampCheckVerdict = Object.freeze({
  kind: 'undecodable',
  writers: Object.freeze([]),
});

/**
 * Sorts a set of client ids.
 *
 * @param writers - The ids.
 * @returns Them, ascending.
 */
function ascending(writers: Iterable<number>): number[] {
  return [...writers].sort((first, second) => first - second);
}

/**
 * Checks updates bound for one board's document before they are applied, for a relay
 * that must not apply, broadcast or persist what the clients' stores would refuse. It is the
 * store's per-writer rule (`document-version-guard.ts`) read from the update's bytes: an object
 * entry (any live item under a key of the top-level `objects` map, a plain value as much as a
 * `Y.Map`: `isObjectEntry`, shared with the guard) is fine when its writer stamped,
 * in the document already (deleted stamps count) or in the same update. The relay also refuses
 * a stamp that is malformed or lowers the board's layout (`isAcceptableStamp`).
 *
 * The update is scanned without decoding content (`scanUpdate`), and Yjs's integration of it is
 * replayed on the scan (`replayIntegration`), so the check counts what Yjs applies, where Yjs
 * puts it, one step per struct, bounded by `maxSteps`. A stamp in the update counts only when
 * Yjs adds it now, at a clock the document did not hold, under `meta`/`document` (both its
 * neighbours are items Yjs finds, not collected ones), and before every object entry of its
 * writer in the update: Yjs takes a client's structs in clock order, so whatever would stop the
 * stamp stops those objects too. A writer whose object entries Yjs applies without such a stamp
 * or one in the document is `unstamped`. The relay applies only what the check proves; what it
 * cannot prove is `unprovable`, never accepted:
 * - an update Yjs would keep partly pending (a gap in a client's clocks, a skipped range of a
 *   merged update, a neighbour or parent nobody sent): what is pending is applied later,
 *   unchecked, once another update fills the gap, and that update may hold different structs at
 *   the same clocks;
 * - a check past its work ceiling, bytes the scan cannot read, or structs that would make Yjs
 *   throw part way.
 *
 * Live admission first refuses an update of more than `MAX_UPDATE_CLIENTS` clients
 * (`too-many-clients`), before scanning it; durable history is not bounded. Last, an
 * update it would accept has its values judged (part 1, live admission only): the
 * accepted verdict names the first value written into an object that a renderer could not draw
 * (`hostileValue`), and counts writes of an older layout's shape (`layoutShapedWrites`).
 *
 * The client is expected to reconnect and send the update again with what it lacked.
 */
export class UpdateStampCheck {
  readonly #doc: Y.Doc;
  readonly #maxSteps: number;
  readonly #isHistoricalReplay: boolean;
  readonly #stampedWriters = new Set<number>();

  /**
   * Checks updates for one document.
   *
   * @param doc - The board's document, which the updates will be applied to; never changed.
   * @param maxSteps - The work ceiling per update ({@link MAX_STAMP_CHECK_STEPS} by default).
   * @param isHistoricalReplay - Only for durable history: permit supported older stamps whose log order may differ from acceptance order; the caller must preserve the highest layout. Never enable for live admission.
   */
  constructor(doc: Y.Doc, maxSteps = MAX_STAMP_CHECK_STEPS, isHistoricalReplay = false) {
    this.#doc = doc;
    this.#maxSteps = maxSteps;
    this.#isHistoricalReplay = isHistoricalReplay;
  }

  /**
   * Checks one update. Never throws: bytes it cannot read are `unprovable`.
   *
   * @param update - A Yjs update (format v1): a sync step 2 or a live update; not mutated.
   * @returns The verdict.
   */
  check(update: Uint8Array): StampCheckVerdict {
    if (this.#doc.store.pendingStructs !== null) {
      return { kind: 'unprovable', cause: 'missing-dependency', writers: [] };
    }
    let reading: StampReading;
    try {
      if (!this.#isHistoricalReplay && countUpdateClients(update) > MAX_UPDATE_CLIENTS) {
        return TOO_MANY_CLIENTS;
      }
      const scan = scanUpdate(update, new Set(), EVERY_STRUCT);
      reading = readUpdateStamps(this.#doc, update, scan, this.#maxSteps, this.#isHistoricalReplay);
    } catch (error) {
      if (error instanceof UpdateDepthError) return { kind: 'update-depth-exceeded', writers: [] };
      return UNREADABLE;
    }
    const verdict = this.#verdictOf(update, reading);
    if (reading.undecodable === 'none') return verdict;
    return verdict.kind === 'accepted'
      ? { ...verdict, undecodable: reading.undecodable }
      : UNDECODABLE;
  }

  /**
   * The verdict on what the replay read, before the values Yjs cannot decode are counted.
   *
   * @param update - The update.
   * @param reading - What the replay read from it.
   * @returns The verdict.
   */
  #verdictOf(update: Uint8Array, reading: StampReading): StampCheckVerdict {
    if (reading.isMalformed) return UNREADABLE;
    if (reading.isExhausted) return { kind: 'unprovable', cause: 'work-ceiling', writers: [] };
    if (reading.invalidStampWriters.size > 0) {
      return { kind: 'invalid-stamp', writers: ascending(reading.invalidStampWriters) };
    }
    // Yjs applies these writers' objects now; a stamp counts only if it comes first.
    const unstamped = [...reading.objectClocks]
      .filter(([writer, objectClock]) => {
        const stampClock = reading.stampClocks.get(writer);
        return (stampClock === undefined || stampClock > objectClock) && !this.#hasStamped(writer);
      })
      .map(([writer]) => writer);
    if (unstamped.length > 0) return { kind: 'unstamped', writers: ascending(unstamped) };
    if (reading.heldBack.size > 0) {
      const causes = new Set(reading.heldBack.values());
      const cause = causes.has('clock-gap') ? 'clock-gap' : 'missing-dependency';
      return { kind: 'unprovable', cause, writers: ascending(reading.heldBack.keys()) };
    }
    return this.#judgeValues(update, reading);
  }

  /**
   * The door check of an update the stamp check accepts (part 1): the values it writes
   * into objects, read from the same replay, judged by the ranges a renderer draws within, and
   * the values it writes into the pages map, judged by key shape, and into the colour
   * tokens map likewise, the named style maps and the facilitation map.
   *
   * @param update - The update.
   * @param reading - What the replay read from it.
   * @returns The accepted verdict, with the first refused value and the layout-shaped writes.
   */
  #judgeValues(update: Uint8Array, reading: StampReading): StampCheckVerdict {
    const {
      fieldWrites,
      pageWrites,
      tokenWrites,
      styleWrites,
      facilitationWrites,
      identityWrites,
    } = reading;
    const isWritingNothingJudged =
      fieldWrites.length === 0 &&
      pageWrites.length === 0 &&
      tokenWrites.length === 0 &&
      styleWrites.length === 0 &&
      facilitationWrites.length === 0 &&
      identityWrites.size === 0;
    if (isWritingNothingJudged) return ACCEPTED;
    const judged = judgeFieldWrites(
      this.#doc,
      update,
      fieldWrites,
      reading.board,
      identityWrites,
      reading.stampedLayout,
    );
    const hostileValue =
      judged.hostileValue ??
      judgePageWrites(update, pageWrites) ??
      judgeTokenWrites(update, tokenWrites) ??
      judgeStyleWrites(update, styleWrites) ??
      judgeFacilitationWrites(update, facilitationWrites);
    const { layoutShapedWrites } = judged;
    if (hostileValue === undefined && layoutShapedWrites === 0) return ACCEPTED;
    return {
      kind: 'accepted',
      ...(hostileValue === undefined ? {} : { hostileValue }),
      ...(layoutShapedWrites === 0 ? {} : { layoutShapedWrites }),
    };
  }

  /**
   * Tells whether a writer stamped the document: remembered, else read from its stamp chain.
   *
   * @param writer - The Yjs client id.
   * @returns True when it stamped.
   */
  #hasStamped(writer: number): boolean {
    if (this.#stampedWriters.has(writer)) return true;
    addStampWriters(this.#doc.getMap<unknown>(META_MAP_NAME), this.#stampedWriters);
    return this.#stampedWriters.has(writer);
  }
}
