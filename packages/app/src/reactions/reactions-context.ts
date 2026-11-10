import { createContext, useContext } from 'react';

import type { ReactionEmoji } from '@canvas/schema';

/** How long a reaction shows on the board, ms: it floats up and fades. */
export const REACTION_LIFETIME_MS = 1600;

/** The most reactions shown at once; older ones go first (the fan-out to a large audience). */
export const MAX_SHOWN_REACTIONS = 40;

/** How far "+1" places its reaction from the one it repeats, board units right and up. */
export const REPEAT_OFFSET = 24;

/** A reaction on the board now: the person's own or someone else's. */
export interface ShownReaction {
  /** Unique while shown. */
  readonly id: number;
  /** The emoji. */
  readonly emoji: ReactionEmoji;
  /** Where, board units. */
  readonly x: number;
  /** Where, board units. */
  readonly y: number;
  /** The page it was dropped on. */
  readonly pageId: string;
  /** Whether the person dropped it. */
  readonly isOwn: boolean;
}

/** Where a reaction goes: a board point on a page. */
export interface ReactionPlace {
  /** Across, board units. */
  readonly x: number;
  /** Down, board units. */
  readonly y: number;
  /** The page. */
  readonly pageId: string;
}

/**
 * The board's reactions as the shell's surfaces see them: the dock's Reactions flyout,
 * its emoji armed for a click on the board, and the reactions shown over the canvas.
 */
export interface BoardReactions {
  /** Whether the person may send reactions: an editor or a commenter, never a viewer. */
  readonly canReact: boolean;
  /** Whether the flyout is open. */
  readonly isOpen: boolean;
  /** The emoji a click on the board drops, or null. */
  readonly armed: ReactionEmoji | null;
  /** The last reaction anyone dropped, which "+1" repeats; undefined before the first. */
  readonly last: (ReactionPlace & { readonly emoji: ReactionEmoji }) | undefined;
  /** The reactions shown now, oldest first. */
  readonly shown: readonly ShownReaction[];
  /** Opens or closes the flyout (closing disarms). */
  readonly toggle: () => void;
  /** Closes the flyout and disarms. */
  readonly close: () => void;
  /** Arms an emoji for the next clicks on the board, or disarms with null. */
  readonly arm: (emoji: ReactionEmoji | null) => void;
  /** Drops the armed emoji at a place, if one is armed. */
  readonly drop: (place: ReactionPlace) => void;
  /** Drops the last reaction's emoji again beside it ("+1"), if there was one. */
  readonly repeat: () => void;
  /**
   * Sends an emoji at once at the view's centre: a reaction chosen with the keyboard, which has
   * no press on the board to place it. Nothing until the board layer gives the centre.
   */
  readonly sendAtCentre: (emoji: ReactionEmoji) => void;
  /** Gives where the view's centre is (the board layer), or takes it back with undefined. */
  readonly provideCentre: (centre: (() => ReactionPlace) | undefined) => void;
}

/** The board's reactions; undefined where the board has no relay (a local board). */
export const reactionsContext = createContext<BoardReactions | undefined>(undefined);

/**
 * Reads the board's reactions.
 *
 * @returns Them on a board with a relay, otherwise undefined.
 */
export function useBoardReactions(): BoardReactions | undefined {
  return useContext(reactionsContext);
}
