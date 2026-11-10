import { useContext, useEffect, useRef, type RefObject } from 'react';

import { commentDataContext } from '../comments/comment-data-context.js';

/**
 * Focuses the field after the commit's other effects, the card's own focus among them.
 *
 * @param fieldRef - The search field.
 */
function focusSoon(fieldRef: RefObject<HTMLInputElement | null>): void {
  queueMicrotask(() => {
    fieldRef.current?.focus();
  });
}

/** Hands focus back to the field around a go to a comment thread. */
export interface SearchFieldFocus {
  /**
   * Follows a go to a result: for a comment thread, focus comes back to the field once that
   * thread is the selected one, unless the go gives up.
   *
   * @param threadId - The thread gone to; none for an object.
   * @param going - The go, settling true once there.
   */
  follow(threadId: string | undefined, going: Promise<boolean>): void;
}

/**
 * Where focus goes in the search sheet: into the field when it opens and on each mod+f
 * request; and back to the field when a comment result opens its thread, whose card takes focus
 * as it opens (`CommentDialog`). Focus returns, after the card's own effect, once the thread
 * gone to is the selected one: at once when it already was, never when the go gave up or
 * another thread was selected first, so it cannot take focus from a later, unrelated card.
 *
 * @param fieldRef - The search field.
 * @param focusRequest - Changes when focus should move into the field again.
 * @returns The way to follow a go.
 */
export function useSearchFieldFocus(
  fieldRef: RefObject<HTMLInputElement | null>,
  focusRequest: number,
): SearchFieldFocus {
  const selectedId = useContext(commentDataContext)?.selectedId;
  const selected = useRef(selectedId);
  const awaited = useRef<string | undefined>(undefined);
  selected.current = selectedId;
  useEffect(() => {
    fieldRef.current?.focus();
  }, [fieldRef, focusRequest]);
  useEffect(() => {
    if (awaited.current === undefined) return;
    if (awaited.current === selectedId) focusSoon(fieldRef);
    awaited.current = undefined;
  }, [selectedId, fieldRef]);
  return {
    follow: (threadId, going) => {
      if (threadId !== undefined && threadId === selected.current) focusSoon(fieldRef);
      else if (threadId !== undefined) awaited.current = threadId;
      void going.then((isThere) => {
        if (!isThere && awaited.current === threadId) awaited.current = undefined;
      });
    },
  };
}
