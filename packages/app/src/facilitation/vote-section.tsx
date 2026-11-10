import type { ReactElement } from 'react';

import { Button } from '../controls/button.js';
import { Icon } from '../icons/icon.js';
import type { VoteSession } from '../voting/vote-api.js';
import { votesWord } from '../voting/vote-board.js';
import { DEFAULT_VOTES_PER_PERSON, votesLeftIn, type BoardVote } from '../voting/vote-context.js';

import { formatTimerClock } from './timer-clock.js';
import styles from './vote-section.module.css';

/**
 * A vote's name in the card: "Dot vote · 3 each".
 *
 * @param votesPerPerson - Each person's votes.
 * @returns The words.
 */
export function voteTitleOf(votesPerPerson: number): string {
  return `Dot vote · ${String(votesPerPerson)} each`;
}

/**
 * How far a vote is: every vote cast against every vote there is to cast, 0 to 1.
 *
 * @param session - The session.
 * @returns The share cast.
 */
export function voteProgressOf(session: VoteSession): number {
  const total = session.eligibleVoterCount * session.votesPerPerson;
  return total === 0 ? 0 : Math.min(session.castCount / total, 1);
}

/**
 * A revealed vote's top stickies: each one's rank, label and votes.
 *
 * @param props - The vote.
 * @param props.vote - The board's vote.
 * @returns The list, or nothing with no voted sticky left.
 */
function RankedList(props: { readonly vote: BoardVote }): ReactElement | null {
  const ranked = props.vote.ranked ?? [];
  if (ranked.length === 0) return null;
  return (
    <ol className={styles.ranked} aria-label="Top stickies">
      {ranked.map((sticky) => (
        <li key={sticky.id} className={styles.rank} data-vote-rank={sticky.id}>
          <span className={styles.rankLabel}>{sticky.label}</span>
          <span className={styles.rankCount}>{votesWord(sticky.count)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The voting cursor's toggle: on, a press on a sticky votes for it and ⌥ takes one back.
 *
 * @param props - The vote.
 * @param props.vote - The board's vote.
 * @returns The toggle, or nothing where the provider has no cursor.
 */
function CursorToggle(props: { readonly vote: BoardVote }): ReactElement | null {
  const { vote } = props;
  const { setCursorOn } = vote;
  if (setCursorOn === undefined) return null;
  const isOn = vote.isCursorOn === true;
  return (
    <button
      type="button"
      className={styles.cursor}
      aria-label="Vote with clicks"
      aria-pressed={isOn}
      title="Vote with clicks: click a sticky to vote, ⌥-click to take one back (Esc stops)"
      data-vote-cursor-toggle=""
      onClick={() => {
        setCursorOn(!isOn);
      }}
    >
      <Icon name="vote" />
    </button>
  );
}

/**
 * The live vote's panel: its name and the time left on the board timer while it runs (else the
 * person's votes left), its section, the progress, the count, the voting cursor and End (Close
 * once the results show, with the top stickies above).
 *
 * @param props - The vote, the session and the timer's time left.
 * @param props.vote - The board's vote.
 * @param props.session - Its current session.
 * @param props.timeLeftMs - The running board timer's time left, if one runs.
 * @returns The panel.
 */
function VotePanel(props: {
  readonly vote: BoardVote;
  readonly session: VoteSession;
  readonly timeLeftMs: number | undefined;
}): ReactElement {
  const { vote, session, timeLeftMs } = props;
  const isRevealed = session.status === 'revealed';
  const total = session.eligibleVoterCount * session.votesPerPerson;
  const left = vote.canVote && !isRevealed ? `${String(votesLeftIn(session))} left` : undefined;
  const isTimed = timeLeftMs !== undefined && !isRevealed;
  const cast = `${String(session.castCount)} of ${String(total)} cast`;
  return (
    <div className={styles.panel} role="group" aria-label="Dot vote" data-vote-panel="">
      <div className={styles.head}>
        <span className={styles.label}>{voteTitleOf(session.votesPerPerson)}</span>
        {isTimed ? (
          <span className={styles.left} aria-label="Time left" data-vote-time-left="">
            {formatTimerClock(timeLeftMs)}
          </span>
        ) : (
          left !== undefined && <span className={styles.left}>{left}</span>
        )}
      </div>
      {vote.sectionName !== undefined && (
        <span className={styles.scope} data-vote-scope="">
          <Icon name="section" />
          {`In ${vote.sectionName}`}
        </span>
      )}
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Votes cast"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(session.castCount, total)}
      >
        <div
          className={styles.done}
          style={{ width: `${String(voteProgressOf(session) * 100)}%` }}
        />
      </div>
      {isRevealed && <RankedList vote={vote} />}
      <div className={styles.actions}>
        <span className={styles.count}>
          {isRevealed
            ? 'Results shown'
            : isTimed && left !== undefined
              ? `${cast} · ${left}`
              : cast}
        </span>
        {vote.canVote && !isRevealed && <CursorToggle vote={vote} />}
        {vote.canVote && (
          <Button kind="primary" className={styles.button} onClick={vote.finish}>
            {isRevealed ? 'Close' : 'End'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Props of {@link VoteSection}. */
export interface VoteSectionProps {
  /** The board's vote. */
  readonly vote: BoardVote;
  /** The running board timer's time left, which the live panel shows; none if absent. */
  readonly timeLeftMs?: number | undefined;
  /**
   * The section Start would scope a vote to (the one selected frame) and its name;
   * the whole board if absent.
   */
  readonly scope?: { readonly id: string; readonly name: string } | undefined;
}

/**
 * The Facilitate card's dot vote (the design's frames A and B), under a rule: with no
 * vote, the vote icon, "Dot vote · 3 each" and Start for the owner and editors (nothing for
 * anyone else), a vote in the selected section when one is; while one is current, its
 * panel. End reveals a hidden vote's results to everyone with the top stickies; Close, once they
 * show, ends it and keeps them on the board. A refused action says why beneath.
 *
 * @param props - The board's vote, the timer's time left and the section Start would take.
 * @returns The section, or null when there is nothing to show the person.
 */
export function VoteSection(props: VoteSectionProps): ReactElement | null {
  const { vote, scope } = props;
  const { session } = vote;
  if (session === null && !vote.canVote) return null;
  return (
    <div className={styles.section} data-vote-section="">
      <div className={styles.rule} aria-hidden="true" />
      {session === null ? (
        <div className={styles.idle}>
          <Icon name="vote" />
          <span className={styles.label}>{voteTitleOf(DEFAULT_VOTES_PER_PERSON)}</span>
          <span className={styles.spacer} />
          <Button
            className={styles.button}
            name={scope === undefined ? 'Start a dot vote' : `Start a dot vote in ${scope.name}`}
            onClick={() => {
              vote.start(scope?.id ?? null);
            }}
          >
            Start
          </Button>
        </div>
      ) : (
        <VotePanel vote={vote} session={session} timeLeftMs={props.timeLeftMs} />
      )}
      {session === null && scope !== undefined && (
        <span className={styles.scope} data-vote-scope="">
          <Icon name="section" />
          {`In ${scope.name}`}
        </span>
      )}
      {vote.notice !== undefined && (
        <p className={styles.notice} role="status">
          {vote.notice}
        </p>
      )}
    </div>
  );
}
