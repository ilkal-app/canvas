import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { MountedEngine } from '../engine/mounted-engine.js';

import type { Thread } from './comment-api.js';
import type { CommentData } from './comment-data-context.js';
import { pinPageOf } from './comment-page-switch.js';

// A board opened on one thread (a comment email's "Open the comment" links to
// `/b/<board>?thread=<id>`): the thread is selected once it is loaded, and its page shown.

/** The address's parameter that names the thread to open. */
export const THREAD_PARAMETER = 'thread';

/**
 * The thread the page was opened with (`?thread=<id>`), read once.
 *
 * @returns Its id, or null.
 */
function useLinkedThread(): string | null {
  const [linked] = useState(() => new URL(location.href).searchParams.get(THREAD_PARAMETER));
  return linked;
}

/**
 * Selects the linked thread once the service's list holds it, once; an id the board does not
 * hold does nothing.
 *
 * @param threads - The board's threads as loaded.
 * @param select - Selects a thread (its card opens).
 */
export function useThreadLinkSelect(
  threads: readonly Thread[],
  select: (id: string) => void,
): void {
  const linked = useLinkedThread();
  const isDoneRef = useRef(false);
  useEffect(() => {
    if (linked === null || isDoneRef.current) return;
    if (!threads.some((thread) => thread.id === linked)) return;
    isDoneRef.current = true;
    select(linked);
  }, [threads, linked, select]);
}

/**
 * The selected thread's state, with the linked thread selected once loaded
 * ({@link useThreadLinkSelect}).
 *
 * @param threads - The board's threads as loaded.
 * @returns The selected thread's id and its setter.
 */
export function useSelectedThread(
  threads: readonly Thread[],
): [string | undefined, Dispatch<SetStateAction<string | undefined>>] {
  const [selectedId, setSelectedId] = useState<string>();
  useThreadLinkSelect(threads, setSelectedId);
  return [selectedId, setSelectedId];
}

/**
 * Shows the linked thread's page when it is selected and its pin is on another page, once, so
 * its card opens beside its pin (as a thread chosen on the panel does).
 *
 * @param engine - The engine, whose pages show a thread's page; absent before it mounts.
 * @param data - The comments.
 */
export function useThreadLinkPage(
  engine: MountedEngine | undefined,
  data: CommentData | undefined,
): void {
  const linked = useLinkedThread();
  const isDoneRef = useRef(false);
  useEffect(() => {
    if (linked === null || isDoneRef.current || data?.selectedId !== linked) return;
    const thread = data.threads.find((each) => each.id === linked);
    const pages = engine?.pages;
    if (thread === undefined || pages === undefined) return;
    isDoneRef.current = true;
    const page = pinPageOf(data, thread);
    if (page !== undefined && page !== pages.current()) pages.show(page);
  }, [engine, data, linked]);
}
