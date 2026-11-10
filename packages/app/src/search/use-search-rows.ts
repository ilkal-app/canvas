import { useContext } from 'react';

import type { SearchGroup, SearchHit } from '@canvas/document';
import type { PageId } from '@canvas/schema';

import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import type { BoardView } from '../engine/board-view.js';
import type { IconName } from '../icons/icon-paths.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import type { ShellAction } from '../state/shell-action.js';

import { pinFrameOf, pinPlaceOf } from './comment-place.js';
import { commentAge, searchComments, type CommentHit } from './comment-search.js';
import { groupSearchHits } from './search-results.js';
import { useBoardSearch } from './use-board-search.js';

/** One result row of the sheet: an object or a comment. */
export interface ResultRow {
  /** Unique among the rows. */
  readonly key: string;
  /** Its glyph. */
  readonly icon: IconName;
  /** Its label: the matching text, or the comment's author and message. */
  readonly text: string;
  /** Its meta at the right: the object's section, or the comment's age. */
  readonly meta: string | undefined;
  /** The comment thread it is, whose card takes focus as it opens; none for an object. */
  readonly threadId: string | undefined;
  /** Goes to it; settles true once there, false when it gave up (a pin gone, a newer page). */
  readonly go: () => Promise<boolean>;
}

/** A group of rows under its head ("Comments · 1"). */
export interface ResultGroup {
  /** Unique among the groups. */
  readonly key: SearchGroup | 'comments';
  /** The head's name. */
  readonly title: string;
  /** Its rows. */
  readonly rows: readonly ResultRow[];
}

/** Each object group's row glyph (frame B: icon/sticky, icon/text; a section is a frame). */
const GROUP_ICONS: Readonly<Record<SearchGroup, IconName>> = {
  stickies: 'note',
  text: 'text',
  sections: 'section',
};

/** What the rows come from and go through. */
export interface SearchRowsSource {
  /** The engine's board view. */
  readonly view: BoardView | undefined;
  /** The board's pages. */
  readonly pages: PageNavigation | undefined;
  /** The shell's dispatch: going to an object, framing a pin. */
  readonly dispatch: (action: ShellAction) => void;
}

/** What the person asked for. */
export interface SearchRowsQuery {
  /** The query. */
  readonly query: string;
  /** The page searched, or undefined for every page. */
  readonly pageId: PageId | undefined;
  /** Whether resolved comment threads are searched too. */
  readonly shouldIncludeResolved: boolean;
}

/**
 * Goes to a comment result: shows its pin's page when another is shown, frames the pin, then
 * selects the thread, whose card opens at the pin. A page switch can be overtaken (the
 * pages keep only the latest request), so after it the go goes on only if its page is the one
 * shown and its pin is still there, framed where it is now. The board menu's "Unread comments"
 * goes to a thread this way too.
 *
 * @param hit - The result.
 * @param comments - The board's comments.
 * @param source - The pages and the dispatch.
 * @returns True once the thread is selected; false when the go gave up.
 */
export async function goToComment(
  hit: Pick<CommentHit, 'threadId' | 'pinId'>,
  comments: CommentData,
  source: Pick<SearchRowsSource, 'pages' | 'dispatch'>,
): Promise<boolean> {
  const placeNow = () => {
    // The thread's own pin, as the list now has it; its document pin by id otherwise.
    const thread = comments.threads.find((entry) => entry.id === hit.threadId) ?? {
      pinId: hit.pinId,
    };
    return pinPlaceOf(comments.connection.store.read(), thread);
  };
  let place = placeNow();
  if (place === undefined) return false;
  const { pages } = source;
  if (pages !== undefined && pages.current() !== place.pageId) {
    const pageId = place.pageId;
    pages.show(pageId);
    await pages.whenShown?.();
    place = placeNow();
    if (pages.current() !== pageId || place?.pageId !== pageId) return false;
  }
  source.dispatch({ type: 'frame', bounds: pinFrameOf(place.point) });
  comments.select(hit.threadId);
  return true;
}

/**
 * The comment results of a query: none without comments (outside a signed-in board), the
 * threads on the page searched otherwise.
 *
 * @param comments - The board's comments, if any.
 * @param search - The query, the page and whether resolved threads count.
 * @returns The results.
 */
function commentHitsOf(
  comments: CommentData | undefined,
  search: SearchRowsQuery,
): readonly CommentHit[] {
  if (comments === undefined || search.query.trim() === '') return [];
  const { pageId } = search;
  const board = pageId === undefined ? undefined : comments.connection.store.read();
  return searchComments(comments.threads, search.query, {
    shouldIncludeResolved: search.shouldIncludeResolved,
    isShown:
      board === undefined
        ? undefined
        : (pinId) => {
            // The thread's own pin, as the list has it; a pin id is one thread's.
            const thread = comments.threads.find((entry) => entry.pinId === pinId) ?? { pinId };
            return pinPlaceOf(board, thread)?.pageId === pageId;
          },
  });
}

/**
 * The search sheet's rows: the board's objects (`SearchIndex`, grouped stickies, text,
 * sections) and then, on a signed-in board, its comment threads (`searchComments`), each with
 * the way to go to it.
 *
 * @param source - The board, its pages and the dispatch.
 * @param search - The query, the page and whether resolved threads count.
 * @returns The groups, how many rows they hold, whether the board has comments to search, and
 *   the object results (which the canvas outlines).
 */
export function useSearchRows(
  source: SearchRowsSource,
  search: SearchRowsQuery,
): {
  readonly groups: readonly ResultGroup[];
  readonly count: number;
  readonly hasComments: boolean;
  readonly objectHits: readonly SearchHit[];
} {
  const comments = useContext(commentDataContext);
  const hits = useBoardSearch(source.view, search.query, search.pageId);
  const groups: ResultGroup[] = groupSearchHits(hits).map((group) => ({
    key: group.group,
    title: group.title,
    rows: group.hits.map((hit) => ({
      key: hit.id,
      icon: GROUP_ICONS[hit.group],
      text: hit.text,
      meta: hit.sectionName,
      threadId: undefined,
      go: () => {
        source.dispatch({ type: 'component', command: 'goToMain', id: hit.id });
        return Promise.resolve(true);
      },
    })),
  }));
  const commentHits = commentHitsOf(comments, search);
  if (comments !== undefined && commentHits.length > 0) {
    const now = Date.now();
    groups.push({
      key: 'comments',
      title: 'Comments',
      rows: commentHits.map((hit) => ({
        key: `comment:${hit.threadId}`,
        icon: 'comment',
        text: hit.text,
        meta: commentAge(hit.createdAt, now),
        threadId: hit.threadId,
        go: () => goToComment(hit, comments, source),
      })),
    });
  }
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return { groups, count, hasComments: comments !== undefined, objectHits: hits };
}
