/** Where the boards whose view-only notice showed are kept, one key per board. */
export const VIEW_ONLY_NOTICE_STORAGE_PREFIX = 'canvas.view-only-notice.';

/** The part of `Storage` the memory uses. */
export type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Which boards' view-only notice showed this session: "You can view this board" shows
 * once per board per browser-tab session. Kept in the tab's `sessionStorage`, so a reload does
 * not show it again while a new tab does; and in the page's memory too, for a browser whose
 * storage is blocked (private modes, policies), where it then shows once per page. Main thread.
 */
export class ViewOnlyNoticeMemory {
  readonly #storage: () => NoticeStorage | undefined;
  readonly #shown = new Set<string>();

  /**
   * Remembers in the given storage.
   *
   * @param storage - The storage; the tab's `sessionStorage` (if it can be reached) if absent.
   */
  constructor(storage: () => NoticeStorage | undefined = tabStorage) {
    this.#storage = storage;
  }

  /**
   * Whether the notice already showed for a board this session.
   *
   * @param boardId - The board.
   * @returns True once {@link ViewOnlyNoticeMemory.remember} ran for it.
   */
  hasShown(boardId: string): boolean {
    if (this.#shown.has(boardId)) return true;
    try {
      return (this.#storage()?.getItem(VIEW_ONLY_NOTICE_STORAGE_PREFIX + boardId) ?? null) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Records that the notice showed for a board.
   *
   * @param boardId - The board.
   */
  remember(boardId: string): void {
    this.#shown.add(boardId);
    try {
      this.#storage()?.setItem(VIEW_ONLY_NOTICE_STORAGE_PREFIX + boardId, '1');
    } catch {
      // The page's own memory holds it for this page.
    }
  }
}

/**
 * The tab's session storage, if the page may use it.
 *
 * @returns The storage, or undefined where it is missing or blocked.
 */
function tabStorage(): NoticeStorage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** The page's one memory of view-only notices, which the shell's notice uses. */
export const PAGE_VIEW_ONLY_NOTICES = new ViewOnlyNoticeMemory();
