import {
  runCommand,
  setInstanceOverrideCommand,
  SYSTEM_ORIGIN,
  type ChangeSet,
  type CommandEnvironment,
  type DocumentStore,
  whenStoreIdle,
} from '@canvas/document';
import {
  effectiveOverridesOf,
  isMeasuredSizeCurrent,
  overrideRecordSchema,
  type Board,
  type BoardObject,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';
import {
  BUNDLED_FONTS_FINGERPRINT,
  measureOverrideText,
  MissingFontFileError,
  type FontFaceKey,
  type TextShaping,
} from '@canvas/text';

/** How far a stored size may be from a new measurement before it is written again, world units. */
const SIZE_TOLERANCE = 0.01;

/** What the override size follower reads and writes through. */
export interface OverrideSizeFollowerOptions {
  /** The document. */
  readonly store: DocumentStore;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** Whether this client may write the board now; a viewer never writes. */
  readonly canWrite?: () => boolean;
  /**
   * The shaping sizes are measured with, as MCP measures them: absent, per-codepoint
   * metrics; returning `undefined` (the page's shaper is still loading), nothing is measured
   * yet, and `remeasure` measures once it is there.
   */
  readonly textShaping?: () => TextShaping | undefined;
  /**
   * Called when a measurement needs a face whose file is not loaded; nothing is written for it
   * until `remeasure` finds the file (the page loads the family, then calls `remeasure`).
   */
  readonly onMissingFace?: (face: FontFaceKey) => void;
  /**
   * Subscribes to font loads, after each of which every instance is measured again
   * (`remeasure`); returns the unsubscribe.
   */
  readonly onFontsChanged?: (listener: () => void) => () => void;
}

/**
 * Reads a record defensively: one no reader parses (a peer's raw write) is not measured.
 *
 * @param value - The stored record.
 * @returns The record, or undefined.
 */
function parsedRecord(value: unknown): OverrideRecord | undefined {
  const parsed = overrideRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether a text or sticky in a main is placed by an auto-layout container: one of its ancestors,
 * up to and including the main (or the nested main it is in), has a live auto-layout. Only then
 * does the layout read the size its override measures.
 *
 * @param board - The board.
 * @param source - The source child.
 * @returns Whether a layout reads its size.
 */
function isLaidOut(board: Board, source: BoardObject): boolean {
  const seen = new Set<ObjectId>();
  let parentId = source.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = board.objects.get(parentId);
    if (parent === undefined) return false;
    if (
      (parent.type === 'frame' || parent.type === 'component') &&
      parent.autoLayout !== undefined
    ) {
      return true;
    }
    if (parent.type === 'component') return false;
    parentId = parent.parentId;
  }
  return false;
}

/**
 * The main a stored object belongs to, if any: the nearest component among its ancestors.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The main's id, or undefined.
 */
function mainOf(board: Board, object: BoardObject): ObjectId | undefined {
  const seen = new Set<ObjectId>();
  let current: BoardObject | undefined = object;
  while (current !== undefined && !seen.has(current.id)) {
    if (current.type === 'component') return current.id;
    seen.add(current.id);
    current = current.parentId === null ? undefined : board.objects.get(current.parentId);
  }
  return undefined;
}

/**
 * Whether a store can still be read: a destroyed store throws on every read.
 *
 * @param store - The store.
 * @returns False once it is destroyed.
 */
function isStoreAlive(store: Pick<DocumentStore, 'read'>): boolean {
  try {
    store.read();
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps the text sizes stored in instances' override records true (decision 3): an
 * instance of an auto-layout main lays its overridden text out at the record's `measuredSize`,
 * which every renderer then draws alike. This client measures each text or sticky override a
 * layout reads (`measureOverrideText` of `@canvas/text`, the one MCP's `set_instance_override`
 * uses) when its size is missing, was measured with other fonts (`isMeasuredSizeCurrent` against
 * `BUNDLED_FONTS_FINGERPRINT`), or no longer matches the text: after the instance's records
 * change, its variant presets change, or the main's text changes under an override that only
 * restyles it. It writes only `measuredSize`, into the instance's own record at that path (never
 * a preset), with `SYSTEM_ORIGIN`, so no undo step records it. Every client measures alike, so
 * concurrent writes agree. A viewer writes nothing.
 */
export class OverrideSizeFollower {
  private readonly options: OverrideSizeFollowerOptions;
  /** Instances to measure at the next flush. */
  private readonly pending = new Set<ObjectId>();
  /** What each instance's override was last measured from, by instance and path. */
  private readonly measuredKeys = new Map<string, string>();
  private readonly stopListening: () => void;
  private readonly stopFonts: (() => void) | undefined;
  private isScheduled = false;
  private isDestroyed = false;

  /**
   * Starts following the document and measures every instance once.
   *
   * @param options - The document, environment and write permission.
   */
  constructor(options: OverrideSizeFollowerOptions) {
    this.options = options;
    this.stopListening = options.store.subscribe((changes) => {
      this.follow(changes);
    });
    this.stopFonts = options.onFontsChanged?.(() => {
      // The page's fonts outlive a board: a face can land after the board's store is gone, and
      // then the follower stops rather than read it.
      if (isStoreAlive(options.store)) this.remeasure();
      else this.destroy();
    });
    for (const object of options.store.read().objects.values()) {
      if (object.type === 'instance') this.pending.add(object.id);
    }
    this.schedule();
  }

  /**
   * Measures every instance again, as if each had changed: once a shaper or a font has loaded.
   * A size that is still right is not written.
   */
  remeasure(): void {
    if (this.isDestroyed) return;
    this.measuredKeys.clear();
    for (const object of this.options.store.read().objects.values()) {
      if (object.type === 'instance') this.pending.add(object.id);
    }
    this.schedule();
  }

  /** Stops following the document. */
  destroy(): void {
    this.isDestroyed = true;
    this.pending.clear();
    this.stopListening();
    this.stopFonts?.();
  }

  /**
   * Queues the instances a change can resize: changed instances, and every instance of a main
   * whose content or presets changed.
   *
   * @param changes - The change.
   */
  private follow(changes: ChangeSet): void {
    const { store } = this.options;
    const board = store.read();
    for (const id of changes.deleted) this.forget(id);
    for (const id of [...changes.created, ...changes.updated]) {
      const object = board.objects.get(id);
      if (object === undefined) continue;
      if (object.type === 'instance') {
        this.pending.add(id);
        continue;
      }
      const mainId = mainOf(board, object);
      if (mainId === undefined) continue;
      for (const instanceId of store.references.instancesOf(mainId)) this.pending.add(instanceId);
    }
    this.schedule();
  }

  /**
   * Drops what was measured of a deleted instance.
   *
   * @param id - The deleted object.
   */
  private forget(id: ObjectId): void {
    for (const key of this.measuredKeys.keys()) {
      if (key.startsWith(`${id}\u0001`)) this.measuredKeys.delete(key);
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
      for (const id of ids) {
        const board = this.options.store.read();
        const instance = board.objects.get(id);
        if (instance?.type === 'instance' && !instance.locked) this.measure(board, instance);
      }
    });
  }

  /**
   * Measures each text override of an instance that a layout reads, and writes the sizes that
   * changed.
   *
   * @param board - The board.
   * @param instance - The instance.
   */
  private measure(board: Board, instance: InstanceObject): void {
    const records = effectiveOverridesOf(instance, board);
    for (const [path, value] of Object.entries(records)) {
      const record = parsedRecord(value);
      const hasText =
        record?.text !== undefined || record?.runs !== undefined || record?.textStyle !== undefined;
      // A size without text of its own is checked too: a variant switch can take away the preset
      // text it was measured from, leaving the source's text to measure.
      if (record === undefined || (!hasText && record.measuredSize === undefined)) continue;
      const source = board.objects.get(path.split('/').at(-1) as ObjectId);
      if (source?.type !== 'text' && source?.type !== 'sticky') continue;
      if (!isLaidOut(board, source)) continue;
      this.measurePath(board, instance, path, record, source);
    }
  }

  /**
   * An override's size, shaped when the follower shapes.
   *
   * @param board - The board.
   * @param instance - The instance.
   * @param path - The override path.
   * @param own - The instance's own record there.
   * @returns The measurement, or `undefined` when there is none yet: nothing to measure, the
   *   shaper still loading, or a face's file not loaded (`onMissingFace` is told).
   * @throws {Error} What measuring throws, but for a missing font file.
   */
  private measured(
    board: Board,
    instance: InstanceObject,
    path: string,
    own: Partial<OverrideRecord>,
  ): ReturnType<typeof measureOverrideText> {
    const { textShaping, onMissingFace } = this.options;
    const shaping = textShaping?.();
    if (textShaping !== undefined && shaping === undefined) return undefined;
    try {
      return measureOverrideText(board, instance, path, own, shaping);
    } catch (error) {
      if (!(error instanceof MissingFontFileError)) throw error;
      onMissingFace?.(error.face);
      return undefined;
    }
  }

  /**
   * Measures one override and writes its size when the stored one is missing, stale or off.
   *
   * @param board - The board.
   * @param instance - The instance.
   * @param path - The override path.
   * @param record - The instance's effective record there.
   * @param source - The source text or sticky.
   */
  private measurePath(
    board: Board,
    instance: InstanceObject,
    path: string,
    record: OverrideRecord,
    source: Extract<BoardObject, { type: 'text' | 'sticky' }>,
  ): void {
    const cacheKey = `${instance.id}\u0001${path}`;
    const key = JSON.stringify([
      BUNDLED_FONTS_FINGERPRINT,
      record.text,
      record.runs,
      record.textStyle,
      source.text,
      source.runs,
      source.width,
      source.height,
      source.autoWidth,
    ]);
    const isCurrent = isMeasuredSizeCurrent(record, BUNDLED_FONTS_FINGERPRINT);
    if (isCurrent && this.measuredKeys.get(cacheKey) === key) return;
    const own = parsedRecord(instance.overrides[path]) ?? {};
    const measured = this.measured(board, instance, path, own);
    if (measured === undefined) return;
    this.measuredKeys.set(cacheKey, key);
    const stored = record.measuredSize;
    const isSame =
      isCurrent &&
      stored !== undefined &&
      Math.abs(stored.width - measured.measuredSize.width) < SIZE_TOLERANCE &&
      Math.abs(stored.height - measured.measuredSize.height) < SIZE_TOLERANCE;
    if (isSame) return;
    const input = { id: instance.id, path, override: { measuredSize: measured.measuredSize } };
    runCommand(
      this.options.store,
      SYSTEM_ORIGIN,
      setInstanceOverrideCommand,
      input,
      this.options.environment,
    );
  }
}
