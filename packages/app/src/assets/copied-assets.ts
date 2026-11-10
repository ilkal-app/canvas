import type { AssetId } from '@canvas/schema';

/** The `localStorage` key the record of copied assets is kept under, as JSON. */
export const COPIED_ASSETS_STORAGE_KEY = 'canvas.copied-assets';

/**
 * How many (asset, board) pairs the record keeps in all: the pairs of the copy just made, whole,
 * and the most recent of the older ones. A board holds at most 5,000 objects to copy, and a
 * bound of a few hundred would let a copy of a full board evict its own images.
 */
export const MAX_COPIED_ASSETS = 2000;

/**
 * How many distinct images one copy may record. A copy of more is recorded not at all (a paste
 * of it across boards is refused with the copy-again notice), so no one copy, however large, can
 * push out every other pair, and a copy is never recorded in part.
 */
export const MAX_ASSETS_PER_COPY = MAX_COPIED_ASSETS;

/**
 * The longest board id the record stores: a longer one is not recorded (a copy from such a board
 * cannot be pasted onto another), so that what the record writes is always within what it reads.
 */
export const MAX_BOARD_ID_LENGTH = 128;

/** How much stored content is read: more (in characters) is ignored as not written by this page. */
export const MAX_STORED_CHARACTERS = 1024 * 1024;

/** How many stored entries are read: a list of more is ignored as not written by this page. */
export const MAX_STORED_ENTRIES = 4000;

/** How long a copy is trusted, ms: 24 hours. */
export const COPIED_ASSET_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead of the clock an entry's time may be before it is not trusted, ms. A person's
 * clock can be set back; a time far in the future is not one this page wrote.
 */
const MAX_CLOCK_SKEW_MS = 60 * 1000;

/** The part of `Storage` the record uses, so tests pass a map. */
export type CopiedAssetsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** What a `CopiedAssets` works over. */
export interface CopiedAssetsOptions {
  /**
   * The storage now, or `undefined` where there is none. Called at every read and write, so a
   * storage that becomes unavailable is noticed. The page's `localStorage` if absent.
   */
  readonly storage?: () => CopiedAssetsStorage | undefined;
  /** The time now, ms since the epoch; `Date.now` if absent. */
  readonly now?: () => number;
}

/** One copy the record remembers: an image's asset, the board it was copied from, and when. */
interface CopiedAsset {
  /** The image's asset. */
  readonly assetId: string;
  /** The board the copy was made on. */
  readonly boardId: string;
  /** When, ms since the epoch. */
  readonly copiedAt: number;
}

/**
 * The page's `localStorage`, or undefined where there is none or reading it throws (a sandboxed
 * frame, storage disabled).
 *
 * @returns The storage, or undefined.
 */
function pageStorage(): CopiedAssetsStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reads one stored entry, or nothing when it is not one this record writes.
 *
 * @param value - The parsed JSON of one entry.
 * @returns The entry, or an empty list.
 */
function entryOf(value: unknown): CopiedAsset[] {
  if (typeof value !== 'object' || value === null) return [];
  const { assetId, boardId, copiedAt } = value as Record<string, unknown>;
  const isValid =
    typeof assetId === 'string' &&
    assetId !== '' &&
    typeof boardId === 'string' &&
    boardId !== '' &&
    boardId.length <= MAX_BOARD_ID_LENGTH &&
    typeof copiedAt === 'number' &&
    Number.isFinite(copiedAt);
  return isValid ? [{ assetId, boardId, copiedAt }] : [];
}

/**
 * What this browser has copied images from: for each copied asset, the board it was
 * copied from and when, in `localStorage`, which the app's tabs share (a copy in one tab can be
 * pasted in another; the record is read afresh at every use, and no `BroadcastChannel` is
 * needed). A paste links an image across boards only for a pair found here, never on the
 * clipboard's claim alone: any web page can write the clipboard, but only this origin can write
 * this record.
 *
 * It holds no token, no bytes and no URL, and proves nothing to the service, whose own checks
 * are unchanged. It keeps at most `MAX_COPIED_ASSETS` pairs: those of a copy are always
 * kept whole (a copy of more than `MAX_ASSETS_PER_COPY` images is not recorded), and older
 * ones are evicted oldest first. It trusts a pair for `COPIED_ASSET_MAX_AGE_MS`, and reads
 * no more than `MAX_STORED_CHARACTERS` characters or `MAX_STORED_ENTRIES` entries. Content that cannot be read is ignored, and a
 * storage that is missing or refuses trusts nothing: fail closed, never throw. A script of this
 * origin could write the record; that is outside its threat (a hostile page of another origin).
 * Main thread.
 */
export class CopiedAssets {
  private readonly storage: () => CopiedAssetsStorage | undefined;
  private readonly now: () => number;

  /**
   * Makes a record over a storage and a clock.
   *
   * @param options - The storage and the clock; the page's `localStorage` and `Date.now` if
   *   absent.
   */
  constructor(options: CopiedAssetsOptions = {}) {
    this.storage = options.storage ?? pageStorage;
    this.now = options.now ?? Date.now;
  }

  /**
   * Remembers that images were copied from a board, as the newest entries, all of them (never
   * part of a copy); a pair already held is renewed, and the oldest other pairs are evicted to
   * keep `MAX_COPIED_ASSETS`. Nothing is written for no assets, none of a copy of more
   * than `MAX_ASSETS_PER_COPY` images, and none from a board whose id is longer than
   * `MAX_BOARD_ID_LENGTH` (nor anything over `MAX_STORED_CHARACTERS`). A storage that refuses is ignored (the pair is then
   * not trusted).
   *
   * @param assetIds - The copied images' assets.
   * @param boardId - The board they were copied from.
   */
  record(assetIds: readonly AssetId[], boardId: string): void {
    const renewed = new Set(assetIds);
    if (renewed.size === 0 || renewed.size > MAX_ASSETS_PER_COPY) return;
    if (boardId.length > MAX_BOARD_ID_LENGTH) return;
    try {
      const copiedAt = this.now();
      const kept = this.read().filter(
        (entry) => entry.boardId !== boardId || !renewed.has(entry.assetId as AssetId),
      );
      const added = [...renewed].map((assetId) => ({ assetId, boardId, copiedAt }));
      const room = MAX_COPIED_ASSETS - added.length;
      const entries = [...kept.slice(Math.max(0, kept.length - room)), ...added];
      // Never write more than `read` accepts: else the older pairs go, or, when the copy alone
      // is over the limit, nothing is written and the record stays as it was.
      let text = JSON.stringify(entries);
      if (text.length > MAX_STORED_CHARACTERS) text = JSON.stringify(added);
      if (text.length > MAX_STORED_CHARACTERS) return;
      this.storage()?.setItem(COPIED_ASSETS_STORAGE_KEY, text);
    } catch {
      // A full or disabled storage only means the copy is not remembered.
    }
  }

  /**
   * Tells whether this browser copied every one of the images from the board, within the age
   * limit.
   *
   * @param assetIds - The images' assets.
   * @param boardId - The board a paste's clipboard names as their source.
   * @returns Whether every (asset, board) pair is in the record.
   */
  wasCopiedFrom(assetIds: readonly AssetId[], boardId: string): boolean {
    const copied = new Set(
      this.read().flatMap((entry) => (entry.boardId === boardId ? [entry.assetId] : [])),
    );
    return assetIds.every((assetId) => copied.has(assetId));
  }

  /**
   * The stored entries that can be trusted now, oldest first: those that are well formed, not
   * older than the age limit and not from the future. Empty when the storage is missing, throws
   * or holds something else.
   *
   * @returns The entries.
   */
  private read(): CopiedAsset[] {
    try {
      const text = this.storage()?.getItem(COPIED_ASSETS_STORAGE_KEY) ?? '[]';
      if (text.length > MAX_STORED_CHARACTERS) return [];
      const stored: unknown = JSON.parse(text);
      if (!Array.isArray(stored) || stored.length > MAX_STORED_ENTRIES) return [];
      const now = this.now();
      return (stored as unknown[])
        .flatMap(entryOf)
        .filter(
          ({ copiedAt }) =>
            now - copiedAt <= COPIED_ASSET_MAX_AGE_MS && copiedAt - now <= MAX_CLOCK_SKEW_MS,
        );
    } catch {
      return [];
    }
  }
}

/** The page's record of its own copies, shared by every shell and, through storage, every tab. */
export const PAGE_COPIED_ASSETS = new CopiedAssets();
