import { useEffect, useRef, useState } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import type { ShellAction } from '../state/shell-action.js';

/** The query parameter of a link to an object: the object's id. */
export const OBJECT_PARAMETER = 'object';

/** What the person is told once a link to an object is on the clipboard. */
export const OBJECT_LINK_COPIED_MESSAGE = 'Link copied';

/** What the person is told when the clipboard refused the link. */
export const OBJECT_LINK_FAILED_MESSAGE = 'The link could not be copied.';

/**
 * A link to an object on the board: the board's address with `object=<id>` set, its
 * other parameters (the page shown) kept, and its fragment dropped, since the fragment carries
 * a share link's secret, which a copied link must never hold. Pure.
 *
 * @param href - The board's address.
 * @param id - The object.
 * @returns The link.
 */
export function objectLinkOf(href: string, id: string): string {
  const url = new URL(href);
  url.searchParams.set(OBJECT_PARAMETER, id);
  url.hash = '';
  return url.href;
}

/**
 * Copies a link to an object (the selection's Copy link to object) and says so.
 *
 * @param id - The object.
 * @param notify - Shows the shell's notice.
 * @param writeText - Writes the clipboard; the browser's if absent.
 */
export async function copyObjectLink(
  id: ObjectId,
  notify: (message: string) => void,
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
): Promise<void> {
  try {
    await writeText(objectLinkOf(location.href, id));
    notify(OBJECT_LINK_COPIED_MESSAGE);
  } catch {
    notify(OBJECT_LINK_FAILED_MESSAGE);
  }
}

/**
 * Opens a link to an object: when the page was opened with `object=<id>`, once that
 * object is on the board (now, or when the document has loaded it), shows its page, selects it
 * and zooms to it (`goToMain`), once. An id the board never holds does nothing.
 *
 * @param view - The board as the shell sees it; none before the engine mounts.
 * @param dispatch - The shell's dispatch.
 */
export function useObjectLinkOpen(
  view: BoardView | undefined,
  dispatch: (action: ShellAction) => void,
): void {
  const [linked] = useState(() => new URL(location.href).searchParams.get(OBJECT_PARAMETER));
  const isDoneRef = useRef(false);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);
  useEffect(() => {
    if (view === undefined || linked === null || isDoneRef.current) return;
    const id = linked as ObjectId;
    const whole = view.definitions ?? view.board;
    const reveal = (): boolean => {
      if (isDoneRef.current || whole.get(id) === undefined) return false;
      isDoneRef.current = true;
      dispatchRef.current({ type: 'component', command: 'goToMain', id });
      return true;
    };
    if (reveal()) return;
    const subscribe = view.subscribeDefinitions?.bind(view) ?? view.subscribe.bind(view);
    const unsubscribe = subscribe(() => {
      if (reveal()) unsubscribe();
    });
    return unsubscribe;
  }, [view, linked]);
}
