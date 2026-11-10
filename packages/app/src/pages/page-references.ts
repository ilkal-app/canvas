// The board's references as one page sees them: only objects shown on it,
// which during a sliced switch are only the objects announced so far.
import type { BoardReferences } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

/** What a page's references read from the page-scoped store. */
export interface PageReferenceView {
  /** Whether an object is shown on the page: on it, and announced. */
  readonly isShown: (id: ObjectId) => boolean;
  /** The page's root objects, worked out once per change. */
  readonly rootIds: () => ReadonlySet<ObjectId>;
  /** Whether a sliced switch is under way, so a shown parent may have children not shown yet. */
  readonly isSwitching: () => boolean;
}

/**
 * The board's references as the page shown sees them.
 *
 * @param references - The whole board's.
 * @param view - What the page shows.
 * @returns The page's references.
 */
export function pageReferences(
  references: BoardReferences,
  view: PageReferenceView,
): BoardReferences {
  const { isShown } = view;
  const shown = (ids: ReadonlySet<ObjectId>): ReadonlySet<ObjectId> =>
    new Set([...ids].filter((id) => isShown(id)));
  return {
    childrenOf: (parentId) => {
      if (parentId === null) return view.rootIds();
      if (!isShown(parentId)) return new Set();
      const children = references.childrenOf(parentId);
      return view.isSwitching() ? shown(children) : children;
    },
    topChildOf: (parentId) => references.topChildOf(parentId),
    connectorsAttachedTo: (objectId) => shown(references.connectorsAttachedTo(objectId)),
    instancesOf: (mainId) => shown(references.instancesOf(mainId)),
    commentsAnchoredTo: (objectId) => shown(references.commentsAnchoredTo(objectId)),
  };
}
