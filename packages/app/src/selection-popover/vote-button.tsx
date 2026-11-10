import type { ReactElement } from 'react';

import type { BoardObject } from '@canvas/schema';

import { Icon } from '../icons/icon.js';
import { useBoardVote, votesLeftIn } from '../voting/vote-context.js';

import styles from './selection-popover.module.css';

/**
 * The vote button's name: what it does and the person's votes left.
 *
 * @param left - Their votes left.
 * @returns The name.
 */
export function voteButtonNameOf(left: number): string {
  if (left === 0) return 'Vote for this sticky (no votes left)';
  return `Vote for this sticky (${String(left)} ${left === 1 ? 'vote' : 'votes'} left)`;
}

/** The vote button's name on a sticky outside the vote's section. */
export const OUTSIDE_SECTION_NAME = 'Only stickies in the vote’s section count';

/**
 * The popover's vote button on a sticky (the design's frame A, before Comment): while a
 * vote is open, casts one of the person's votes for the primary selected sticky, which its dots
 * then show. Only for the owner and editors (commenters and viewers do not vote), and disabled
 * once their votes are used, or on a sticky outside the vote's section.
 *
 * @param props - The selection.
 * @param props.selection - The selected objects, primary first.
 * @returns The button, or nothing when there is no open vote or the primary is not a sticky.
 */
export function VoteButton(props: {
  readonly selection: readonly BoardObject[];
}): ReactElement | null {
  const vote = useBoardVote();
  const primary = props.selection[0];
  const session = vote?.session;
  if (vote === undefined || !vote.canVote || session?.status !== 'open') return null;
  if (primary?.type !== 'sticky') return null;
  const left = votesLeftIn(session);
  const isInScope = vote.isInScope?.(primary.id) ?? true;
  const name = isInScope ? voteButtonNameOf(left) : OUTSIDE_SECTION_NAME;
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={name}
      title={name}
      disabled={left === 0 || !isInScope}
      data-vote-button=""
      onClick={() => {
        vote.cast(primary.id);
      }}
    >
      <Icon name="vote" />
    </button>
  );
}
