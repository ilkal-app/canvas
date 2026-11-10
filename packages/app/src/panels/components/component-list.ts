import { sortedSiblings, type BoardReader, type ChangeSet } from '@canvas/document';
import {
  comparePages,
  DEFAULT_PAGE,
  rootPageIdOf,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

/** One main in the components panel. */
export interface ComponentListItem {
  /** The main. */
  readonly id: ObjectId;
  /** Its name, or "Component" when it has none. */
  readonly name: string;
  /** The page it is on. */
  readonly pageId: PageId;
  /** That page's name. */
  readonly pageName: string;
  /**
   * A variant set's axes, each its name and values (`state: rest, hover`), axes apart by `; `;
   * absent for a main without axes.
   */
  readonly axes?: string;
}

/**
 * The board's live pages in order, and the first, as a reader gives them.
 *
 * @param board - The whole board.
 * @returns The pages by id with their order, and the first page.
 */
function pagesOf(board: BoardReader): { order: Map<PageId, number>; pages: Page[] } {
  const stored = board.readPages?.();
  const pages = stored === undefined || stored.size === 0 ? [DEFAULT_PAGE] : [...stored.values()];
  pages.sort(comparePages);
  return { order: new Map(pages.map((page, index) => [page.id, index])), pages };
}

/**
 * The components panel's list (ruling 3): every live main on the whole board, the
 * pages in page order and on each page in paint order (bottom first, the board's stacking, a
 * main inside a frame or group where its container paints it), with its page. A retired main
 * and what it holds are left out; an instance's content is its main's and never walked. Cost:
 * the board. Pure.
 *
 * @param board - The whole board, with its pages (`readPages`).
 * @returns The mains.
 */
export function componentListOf(board: BoardReader): ComponentListItem[] {
  const { order, pages } = pagesOf(board);
  const first = pages[0] ?? DEFAULT_PAGE;
  const found: ComponentListItem[] = [];
  const walk = (parentId: ObjectId | null, page: Page | undefined): void => {
    for (const id of sortedSiblings(board, parentId)) {
      const object = board.get(id);
      if (object === undefined || object.type === 'instance') continue;
      if (object.type === 'component' && object.retired) continue;
      const shown = page ?? pages[order.get(rootPageIdOf(object)) ?? -1] ?? first;
      if (object.type === 'component') {
        const name = object.name.trim() || 'Component';
        const axes = object.variantAxes
          ?.map((axis) => `${axis.name}: ${axis.values.join(', ')}`)
          .join('; ');
        found.push({
          id,
          name,
          pageId: shown.id,
          pageName: shown.name,
          ...(axes === undefined || axes === '' ? {} : { axes }),
        });
      }
      walk(id, shown);
    }
  };
  walk(null, undefined);
  // Stable: paint order kept within each page.
  return found.sort((a, b) => (order.get(a.pageId) ?? 0) - (order.get(b.pageId) ?? 0));
}

/**
 * What the list depends on besides new mains: the listed mains and their ancestors (a frame
 * moved to another page takes its mains along). O(listed × depth).
 *
 * @param board - The whole board.
 * @param items - The list.
 * @returns The ids.
 */
export function componentListWatchOf(
  board: BoardReader,
  items: readonly ComponentListItem[],
): ReadonlySet<ObjectId> {
  const watched = new Set<ObjectId>();
  for (const { id } of items) {
    let current: ObjectId | null = id;
    while (current !== null && !watched.has(current)) {
      watched.add(current);
      current = board.get(current)?.parentId ?? null;
    }
  }
  return watched;
}

/**
 * Whether a change set of the whole board may change the components panel's list: it touched
 * a listed main or one of its ancestors (`componentListWatchOf`), made or changed a main, or
 * changed the pages. O(changed ids).
 *
 * @param board - The whole board, after the change.
 * @param changes - The change set.
 * @param listed - What the list depended on before it (`componentListWatchOf`).
 * @returns True when the list should be worked out again.
 */
export function isComponentListChange(
  board: BoardReader,
  changes: ChangeSet,
  listed: ReadonlySet<ObjectId>,
): boolean {
  if (changes.pages !== undefined && changes.pages.length > 0) return true;
  if (changes.deleted.some((id) => listed.has(id))) return true;
  return [changes.created, changes.updated].some((ids) =>
    ids.some((id) => listed.has(id) || board.get(id)?.type === 'component'),
  );
}
