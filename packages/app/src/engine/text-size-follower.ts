import {
  runCommand,
  setTextRunsCommand,
  SYSTEM_ORIGIN,
  type ChangeSet,
  type CommandEnvironment,
  type DocumentStore,
  whenStoreIdle,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import {
  isTextBoxObject,
  layoutContent,
  measuredSize,
  type TextBoxObject,
  type TextLayoutService,
} from '@canvas/tools';

/** How far a stored size may be from the measured one, world units, before it is rewritten. */
const SIZE_TOLERANCE = 0.01;

/** What {@link TextSizeFollower} follows and writes with. */
export interface TextSizeFollowerOptions {
  /** The document. */
  readonly store: DocumentStore;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** Lays text out on the page, as the text tool measures it. */
  readonly layout: TextLayoutService;
  /** The text being edited now, whose size follows a collaborator's change to its content. */
  readonly editedId: () => ObjectId | undefined;
  /**
   * Whether this client may write to the board now; a viewer's writes nothing, its
   * pending measures dropped. Always when absent.
   */
  readonly canWrite?: () => boolean;
}

/** How many keys were made for content JSON cannot write; makes each of those keys unique. */
let unwritableKeys = 0;

/**
 * What a text's size is measured from: its text, runs, alignment and whether it grows with its
 * text, plus its width when that is fixed (a wrap width, not a result). A change that leaves
 * this key alone (a size written by someone else) gives nothing new to measure. Never throws:
 * a value JSON cannot write gives a key no other call gives.
 *
 * @param object - The text or sticky note.
 * @returns The key.
 */
export function textContentKey(object: TextBoxObject): string {
  const width = object.autoWidth ? null : object.width;
  try {
    const { paragraphs } = object;
    return JSON.stringify([
      object.text,
      object.runs,
      object.align,
      object.autoWidth,
      width,
      paragraphs,
    ]);
  } catch {
    // A field a peer chose that JSON cannot write (a bigint, a cycle): content that cannot be
    // compared is always new, so the text is measured again rather than the read failing.
    unwritableKeys += 1;
    return `unwritable:${String(unwritableKeys)}`;
  }
}

/**
 * Keeps text boxes' stored sizes (text objects' and sticky notes') true to their content when a
 * collaborator's change merges with this client's: each client measures only its own edits, so two people typing into one
 * text leave the merged text measured by neither. Followed: the text being edited, and a text
 * whose content this client changed since the last remote change to it (the remote change may
 * be concurrent, a merge). For those, a remote change to the content (see
 * {@link textContentKey}) lays the text out on the page and, when the stored size is off by more
 * than a tolerance, writes the size as one `setTextRuns` with the system origin: no one's undo
 * step. A change that leaves the content as this client last measured it (another client's
 * size) is never re-measured, so two clients whose fonts measure differently write at most once
 * each and then agree on whichever size the document keeps, rather than overwriting each other.
 * Other text trusts the size its writer measured. Written after the change's listeners have run
 * (a command cannot run inside one). Locked text is left as it is, and nothing is written while
 * the person cannot edit (a viewer). Main thread.
 */
export class TextSizeFollower {
  private readonly options: TextSizeFollowerOptions;
  /** The content key each text had when this client last measured it or wrote its content. */
  private readonly measuredKeys = new Map<ObjectId, string>();
  /** Texts whose content this client changed since the last remote change to them. */
  private readonly ownEdits = new Set<ObjectId>();
  private readonly pending = new Set<ObjectId>();
  /** The last editing target reported by the router; undefined between sessions. */
  private editingId: ObjectId | undefined;
  /** Texts this client wrote while the page's fonts were missing, measured when they land. */
  private readonly unmeasured = new Set<ObjectId>();
  private readonly stopListening: () => void;
  private isScheduled = false;
  private isDestroyed = false;

  /**
   * Starts following the document.
   *
   * @param options - The document, environment, layout and the edited text.
   */
  constructor(options: TextSizeFollowerOptions) {
    this.options = options;
    this.stopListening = options.store.subscribe((changes) => {
      this.follow(changes);
    });
  }

  /**
   * Records a text's current content when its editing session starts, even if measured before.
   * Repeated router notifications within that session preserve pending content repairs.
   * A collaborator's later change that leaves the content alone (their size)
   * is not measured and written back.
   *
   * @param id - The text being edited now, if any.
   */
  noteEditing(id: ObjectId | undefined): void {
    if (id === this.editingId) return;
    this.editingId = id;
    if (id === undefined) return;
    const object = this.options.store.get(id);
    if (isTextBoxObject(object)) this.measuredKeys.set(id, textContentKey(object));
  }

  /**
   * Measures texts again whatever their content key, and writes each size that is off: for a
   * text whose size was written before the fonts it needs had loaded. After the listeners, as
   * for a merge.
   *
   * @param ids - The texts.
   */
  remeasure(ids: Iterable<ObjectId>): void {
    for (const id of ids) {
      this.measuredKeys.delete(id);
      this.pending.add(id);
    }
    this.schedule();
  }

  /**
   * Notes a text this client wrote while the page's fonts were missing (its size was left as it
   * was, or is a new box's placeholder), to be measured by {@link TextSizeFollower.fontsLanded}.
   *
   * @param id - The text.
   */
  noteUnmeasured(id: ObjectId): void {
    this.unmeasured.add(id);
  }

  /** The page's fonts have loaded: every text written without them is measured, and written if off. */
  fontsLanded(): void {
    this.remeasure(this.unmeasured);
  }

  /**
   * Stops following the document; a pending measure is dropped.
   *
   */
  destroy(): void {
    this.isDestroyed = true;
    this.pending.clear();
    this.stopListening();
  }

  private follow(changes: ChangeSet): void {
    for (const id of changes.deleted) {
      this.measuredKeys.delete(id);
      this.ownEdits.delete(id);
    }
    if (changes.isLocal) {
      // The system's writes are this follower's own and Yjs's formatting cleanup of a remote
      // change: neither is this client's edit.
      if (changes.origin.kind !== 'system') this.noteOwnEdits(changes);
      return;
    }
    const edited = this.options.editedId();
    for (const id of changes.updated) {
      const isOwnEdit = this.ownEdits.delete(id);
      if (id === edited || isOwnEdit) this.pending.add(id);
    }
    this.schedule();
  }

  /**
   * Records the content this client wrote: it measured it as it wrote.
   *
   * @param changes - A local change set.
   */
  private noteOwnEdits(changes: ChangeSet): void {
    for (const id of [...changes.created, ...changes.updated]) {
      const object = this.options.store.get(id);
      if (!isTextBoxObject(object)) continue;
      const key = textContentKey(object);
      if (this.measuredKeys.get(id) === key) continue;
      this.measuredKeys.set(id, key);
      this.ownEdits.add(id);
    }
  }

  private schedule(): void {
    if (this.pending.size === 0 || this.isScheduled) return;
    this.isScheduled = true;
    queueMicrotask(() => {
      this.flush();
    });
  }

  private flush(): void {
    // Kept while a stepped run holds the store, measured once it is idle.
    // One scheduled flush, until it runs: ids pending meanwhile join it.
    whenStoreIdle(this.options.store, () => {
      this.isScheduled = false;
      if (this.isDestroyed) return;
      const ids = [...this.pending];
      this.pending.clear();
      if (this.options.canWrite?.() === false) return;
      for (const id of ids) this.measure(id);
    });
  }

  /**
   * Writes a text's measured size when its content changed since this client last measured it
   * and the stored size differs.
   *
   * @param id - The object.
   */
  private measure(id: ObjectId): void {
    const { store, environment, layout } = this.options;
    const object = store.get(id);
    if (!isTextBoxObject(object) || object.locked) {
      this.unmeasured.delete(id);
      return;
    }
    const key = textContentKey(object);
    if (this.measuredKeys.get(id) === key) return;
    const laidOut = layoutContent({ layout }, object, object);
    if (laidOut === undefined) {
      this.unmeasured.add(id);
      return;
    }
    this.unmeasured.delete(id);
    this.measuredKeys.set(id, key);
    const size = measuredSize(object, laidOut);
    const isSame =
      Math.abs(size.width - object.width) < SIZE_TOLERANCE &&
      Math.abs(size.height - object.height) < SIZE_TOLERANCE;
    if (isSame) return;
    // The whole value: the paragraph styles go with the text, or setTextRuns clears them.
    const paragraphs =
      object.paragraphs === undefined ? {} : { paragraphs: [...object.paragraphs] };
    const input = { id, text: object.text, runs: [...object.runs], ...paragraphs, size };
    runCommand(store, SYSTEM_ORIGIN, setTextRunsCommand, input, environment);
  }
}
