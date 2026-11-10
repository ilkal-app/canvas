import { useEffect, useRef, useState } from 'react';

import { prefersReducedMotionQuery } from '../engine/engine-host-mount-options.js';

import type { CommentData } from './comment-data-context.js';
import type { CommentPlacement } from './comment-placement.js';

/** How long the card takes to close back into its pin, ms (the approved motion spec). */
export const CARD_CLOSE_MS = 120;

/** What a card shows: an open thread, or a placement's first message. */
export interface CardContent {
  /** The open thread's id. */
  readonly selectedId: string | undefined;
  /** The placement being written. */
  readonly placement: CommentPlacement | undefined;
}

/** The card to draw now, and how it moves. */
export interface CardMotion {
  /** What it shows: the open one, or for {@link CARD_CLOSE_MS} the one just closed. */
  readonly content: CardContent | undefined;
  /** Its identity: a placement's pin id or the thread's id; a new one draws a new card. */
  readonly key: string | undefined;
  /** Whether it is closing (drawn for its close animation only, inert). */
  readonly isClosing: boolean;
  /** Whether it replaced another open card (it cross-fades in place, not grows). */
  readonly isSwitch: boolean;
}

/**
 * The card's motion: which card to draw, and whether it opens, switches or closes.
 * A closed card stays drawn for {@link CARD_CLOSE_MS}, inert, so it can shrink back into its
 * pin; with reduced motion it goes at once.
 *
 * @param data - The comments, if any.
 * @param isReducedMotion - Whether the person asked for reduced motion.
 * @returns The card to draw now.
 */
export function useCardMotion(
  data: CommentData | undefined,
  isReducedMotion: () => boolean = prefersReducedMotionQuery,
): CardMotion {
  const open: CardContent | undefined =
    data && (data.placement !== undefined || data.selectedId !== undefined)
      ? { selectedId: data.selectedId, placement: data.placement }
      : undefined;
  const key = open ? (open.placement?.id ?? open.selectedId) : undefined;
  // Whether this card replaced another, settled once per card so its animation never restarts.
  const [entry, setEntry] = useState<{ key: string | undefined; isSwitch: boolean }>({
    key: undefined,
    isSwitch: false,
  });
  const isSwitch =
    entry.key === key ? entry.isSwitch : entry.key !== undefined && key !== undefined;
  if (entry.key !== key) setEntry({ key, isSwitch });
  // The open card, kept for its close animation.
  const last = useRef<{ readonly key: string; readonly content: CardContent }>(undefined);
  const [closing, setClosing] = useState<{ key: string; content: CardContent }>();
  if (open && key !== undefined) {
    last.current = { key, content: open };
    if (closing) setClosing(undefined);
  } else if (last.current) {
    // In the render that closes it, so no frame is committed without the card.
    const previous = last.current;
    last.current = undefined;
    if (!isReducedMotion()) setClosing(previous);
  }
  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(() => {
      setClosing(undefined);
    }, CARD_CLOSE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [closing]);
  if (open && key !== undefined) return { content: open, key, isClosing: false, isSwitch };
  return closing
    ? { content: closing.content, key: closing.key, isClosing: true, isSwitch: false }
    : { content: undefined, key: undefined, isClosing: false, isSwitch: false };
}
