import type { ReactionEmoji } from '@canvas/schema';

/** What a screen reader is told each reaction is. */
const REACTION_NAMES: Readonly<Record<ReactionEmoji, string>> = {
  '👍': 'thumbs up',
  '❤️': 'heart',
  '🎉': 'party popper',
  '👀': 'eyes',
  '🙌': 'raised hands',
  '🤔': 'thinking face',
  '😂': 'tears of joy',
};

/** How many reactions' names a gathered announcement lists before "and more". */
const MAX_NAMED = 3;

/**
 * The shortest time between two announcements of other people's reactions, ms: a
 * burst is told as one count, not read out one by one.
 */
export const REACTION_ANNOUNCE_INTERVAL_MS = 5000;

/**
 * A reaction's name, as a screen reader is told it.
 *
 * @param emoji - The reaction.
 * @returns Its name ("thumbs up").
 */
export function reactionNameOf(emoji: ReactionEmoji): string {
  return REACTION_NAMES[emoji];
}

/**
 * What a screen reader is told of other people's reactions: one is "Someone reacted
 * with thumbs up"; several are their count and their distinct names in the order first seen, at
 * most three, then "and more" ("4 reactions: thumbs up, heart"). Pure.
 *
 * @param emojis - The reactions, oldest first; at least one.
 * @returns The announcement.
 */
export function reactionAnnouncementOf(emojis: readonly ReactionEmoji[]): string {
  const [first] = emojis;
  if (emojis.length === 1 && first !== undefined) {
    return `Someone reacted with ${reactionNameOf(first)}`;
  }
  const names = [...new Set(emojis)].map(reactionNameOf);
  const listed = names.slice(0, MAX_NAMED).join(', ');
  const more = names.length > MAX_NAMED ? ' and more' : '';
  return `${String(emojis.length)} reactions: ${listed}${more}`;
}

/**
 * Throttles the announcements of other people's reactions: after a quiet spell a
 * reaction is told at once and opens an interval of {@link REACTION_ANNOUNCE_INTERVAL_MS}; the
 * reactions within it are gathered and told together when it ends, which opens the next. Pure:
 * the caller keeps the clock and the timer (`nextFlushAt`).
 */
export class ReactionAnnouncementThrottle {
  /** The reactions gathered in the open interval. */
  private gathered: ReactionEmoji[] = [];
  /** When the open interval ends, ms, or `undefined` when quiet. */
  private endsAt: number | undefined;

  /**
   * Takes another person's reaction.
   *
   * @param emoji - The reaction.
   * @param now - The time, ms.
   * @returns The announcement to make now, or `undefined` while an interval gathers it.
   */
  add(emoji: ReactionEmoji, now: number): string | undefined {
    if (this.endsAt !== undefined && now < this.endsAt) {
      this.gathered.push(emoji);
      return undefined;
    }
    // An interval past its end that was never flushed gathers nothing more: it is told first.
    const pending = this.flush(now);
    if (pending !== undefined) {
      this.gathered.push(emoji);
      return pending;
    }
    this.endsAt = now + REACTION_ANNOUNCE_INTERVAL_MS;
    return reactionAnnouncementOf([emoji]);
  }

  /**
   * Ends the open interval once its time is up.
   *
   * @param now - The time, ms.
   * @returns The gathered reactions' announcement, which opens the next interval; `undefined`
   *   before the end, or with nothing gathered (quiet again).
   */
  flush(now: number): string | undefined {
    if (this.endsAt === undefined || now < this.endsAt) return undefined;
    const { gathered } = this;
    this.gathered = [];
    if (gathered.length === 0) {
      this.endsAt = undefined;
      return undefined;
    }
    this.endsAt = now + REACTION_ANNOUNCE_INTERVAL_MS;
    return reactionAnnouncementOf(gathered);
  }

  /**
   * When the open interval ends.
   *
   * @returns The time, ms, or `undefined` when quiet.
   */
  nextFlushAt(): number | undefined {
    return this.endsAt;
  }
}
