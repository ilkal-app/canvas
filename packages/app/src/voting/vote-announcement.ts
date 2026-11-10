import { votesWord, type RankedSticky } from './vote-board.js';

/** What a screen reader is told first of a revealed vote. */
const REVEALED = 'Vote results are in.';

/**
 * A revealed vote's top sticky as a screen reader is told it: "Top sticky: Idea, 3 votes."
 * Pure.
 *
 * @param top - The top sticky.
 * @returns The sentence.
 */
function topStickyAnnouncementOf(top: RankedSticky): string {
  return `Top sticky: ${top.label}, ${votesWord(top.count)}.`;
}

/**
 * What a screen reader is told when a vote's results are revealed: "Vote results are
 * in. Top sticky: Idea, 3 votes.", or "Vote results are in." with no voted sticky. Pure.
 *
 * @param ranked - The vote's ranked stickies, most votes first.
 * @returns The announcement.
 */
export function voteRevealAnnouncementOf(ranked: readonly RankedSticky[]): string {
  const [top] = ranked;
  return top === undefined ? REVEALED : `${REVEALED} ${topStickyAnnouncementOf(top)}`;
}
