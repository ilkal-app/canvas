import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { DEFAULT_TIMER_DURATION_MS } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import { useToast } from '../feedback/toast-region.js';
import { useBoardViewState } from '../hooks/use-board-view-state.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';
import { sectionNameOf, voteScopeOf } from '../voting/vote-board.js';
import { useBoardVote } from '../voting/vote-context.js';

import styles from './facilitate-card.module.css';
import {
  createTimerChime,
  readTimerMuted,
  writeTimerMuted,
  type TimerChime,
} from './timer-chime.js';
import { formatTimerClock, parseTimerDuration } from './timer-clock.js';
import { useBoardTimer, type BoardTimerSource } from './use-board-timer.js';
import { VoteSection } from './vote-section.js';

/** What the card says when the board timer runs out. */
export const TIMER_RUN_OUT_MESSAGE = 'Time’s up';

/**
 * The attribute the selection popover keeps clear of (`POPOVER_AVOID_ATTRIBUTE`): the
 * card carries it so a popover never opens over it.
 */
const POPOVER_AVOID = { 'data-popover-avoid': '' } as const;

/** Props of {@link FacilitateCard}. */
export interface FacilitateCardProps {
  /** The board's store, the person's origin and the relay's clock. */
  readonly source: BoardTimerSource;
  /** Whether the person may change the timer: the owner and editors. */
  readonly canEdit: boolean;
  /** The device's storage, for the chime's mute; none where it cannot be read. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  /** Makes the chime; the page's own Web Audio chime if absent. */
  readonly createChime?: (() => TimerChime) | undefined;
  /**
   * The board on screen: a frame selected in it is the section a vote started then covers;
   * the whole board if absent.
   */
  readonly board?: BoardView | undefined;
}

/**
 * The section a dot vote started now would cover: the one selected frame, and its name.
 *
 * @param view - The board on screen, if any.
 * @returns The section, or undefined for the whole board.
 */
function useVoteScope(
  view: BoardView | undefined,
): { readonly id: string; readonly name: string } | undefined {
  const { board, selectedIds } = useBoardViewState(view);
  const id = voteScopeOf(board, selectedIds);
  const name = id === null ? undefined : sectionNameOf(board, id);
  return id === null || name === undefined ? undefined : { id, name };
}

/**
 * The page's chime: gestures on its window, its Web Audio, where there is any.
 *
 * @returns The chime.
 */
function pageChime(): TimerChime {
  const audio = typeof AudioContext === 'undefined' ? undefined : () => new AudioContext();
  return createTimerChime({ target: window, createAudio: audio });
}

/**
 * One of the card's 28 px icon buttons.
 *
 * @param props - Its icon, name, state and action.
 * @param props.icon - What it shows.
 * @param props.label - Its name.
 * @param props.isPressed - Whether it is on (`aria-pressed`); not a toggle if absent.
 * @param props.isExpanded - What it opens is open (`aria-expanded`), if it opens something.
 * @param props.isDisabled - Whether it is disabled.
 * @param props.onClick - Its action.
 * @returns The button.
 */
function CardButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly isPressed?: boolean;
  readonly isExpanded?: boolean;
  readonly isDisabled?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.isPressed}
      aria-expanded={props.isExpanded}
      disabled={props.isDisabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/**
 * What the card does when the timer it watched runs out: a toast, and the chime unless muted.
 *
 * @param isMuted - Whether this device muted the chime.
 * @param makeChime - Makes the chime.
 * @returns The handler of a run-out, and the toast to render (none inside a toast region).
 */
function useRunOutAlerts(
  isMuted: boolean,
  makeChime: () => TimerChime,
): { readonly onRunOut: () => void; readonly toast: ReactElement | null } {
  const [runOuts, setRunOuts] = useState(0);
  const chime = useRef<TimerChime | undefined>(undefined);
  useEffect(() => {
    chime.current = makeChime();
    return () => {
      chime.current?.dispose();
    };
  }, [makeChime]);
  const mutedRef = useRef(isMuted);
  mutedRef.current = isMuted;
  const toast = useToast(
    runOuts === 0
      ? undefined
      : {
          kind: 'info',
          message: TIMER_RUN_OUT_MESSAGE,
          label: 'Timer',
          key: String(runOuts),
          onDismiss: () => {
            setRunOuts(0);
          },
        },
  );
  const onRunOut = (): void => {
    setRunOuts((count) => count + 1);
    if (!mutedRef.current) chime.current?.play();
  };
  return { onRunOut, toast };
}

/**
 * The Facilitate card (the design board's Whiteboard page): floating at the canvas's
 * bottom right under the floating chrome, with the board's shared timer. Its head
 * names it, mutes the chime on this device and collapses it to the head (the time left beside
 * the name while there is a timer). The timer row shows the time left by the relay's clock and
 * the duration: the owner and editors start, pause, resume and reset it, and click the time to
 * set the duration while it is not running (minutes, `m:ss` or `h:mm:ss`; Enter or leaving sets
 * it, Escape keeps the old one). When a timer the card watched runs out it says so in a toast
 * and chimes, after a gesture on the page and unless muted. Everyone sees the same time. Below
 * 768 px wide it starts collapsed, a pill over the canvas's bottom-right corner level
 * with the undo pill, its buttons 48 px targets.
 *
 * @param props - The timer's source, who may change it, the storage and the chime.
 * @returns The card.
 */
export function FacilitateCard(props: FacilitateCardProps): ReactElement {
  const { storage } = props;
  // On a phone a pill beside the undo pill, until expanded.
  const isCompact = useIsMobileSite();
  const [isCollapsed, setIsCollapsed] = useState(isCompact);
  const [isMuted, setIsMuted] = useState(() => readTimerMuted(storage));
  const { onRunOut, toast } = useRunOutAlerts(isMuted, props.createChime ?? pageChime);
  const state = useBoardTimer(props.source, onRunOut);
  const [draftMs, setDraftMs] = useState(DEFAULT_TIMER_DURATION_MS);
  const durationMs = state.timer?.durationMs ?? draftMs;
  const leftMs = state.remainingMs ?? durationMs;
  const vote = useBoardVote();
  const scope = useVoteScope(props.board);
  const isTimerRunning = state.timer?.status === 'running' && leftMs > 0;
  return (
    <section
      className={styles.card}
      aria-label="Facilitate"
      {...POPOVER_AVOID}
      {...(isCompact ? { 'data-compact': '', [BOTTOM_CHROME_ATTRIBUTE]: '' } : {})}
      {...(isCollapsed ? { 'data-collapsed': '' } : {})}
    >
      <div className={[styles.row, styles.head].join(' ')}>
        <Icon name="timer" />
        <span className={styles.title}>Facilitate</span>
        {isCollapsed && state.timer !== undefined && (
          <span className={styles.collapsedTime}>{formatTimerClock(leftMs)}</span>
        )}
        <span className={styles.spacer} />
        <CardButton
          icon={isMuted ? 'sound-off' : 'sound'}
          label="Mute the timer’s sound"
          isPressed={isMuted}
          onClick={() => {
            writeTimerMuted(storage, !isMuted);
            setIsMuted(!isMuted);
          }}
        />
        <CardButton
          icon={isCollapsed ? 'plus' : 'zoom-out'}
          label={isCollapsed ? 'Expand Facilitate' : 'Collapse Facilitate'}
          isExpanded={!isCollapsed}
          onClick={() => {
            setIsCollapsed(!isCollapsed);
          }}
        />
      </div>
      {!isCollapsed && (
        <TimerRow
          state={state}
          durationMs={durationMs}
          leftMs={leftMs}
          canEdit={props.canEdit}
          onDraft={setDraftMs}
        />
      )}
      {!isCollapsed && vote !== undefined && (
        <VoteSection vote={vote} scope={scope} timeLeftMs={isTimerRunning ? leftMs : undefined} />
      )}
      {toast}
    </section>
  );
}

/**
 * The card's timer row: the time left (or its duration field), the duration, play or pause, and
 * reset.
 *
 * @param props - The timer, its duration and time left, who may change it, and where a duration
 *   set with no timer goes.
 * @param props.state - The timer and its runner.
 * @param props.durationMs - Its duration, or the one a new timer will have.
 * @param props.leftMs - Its time left.
 * @param props.canEdit - Whether the person may change it.
 * @param props.onDraft - Receives a duration set while there is no timer.
 * @returns The row.
 */
function TimerRow(props: {
  readonly state: ReturnType<typeof useBoardTimer>;
  readonly durationMs: number;
  readonly leftMs: number;
  readonly canEdit: boolean;
  readonly onDraft: (ms: number) => void;
}): ReactElement {
  const { state, durationMs, leftMs, canEdit } = props;
  const { timer, run } = state;
  const isRunning = timer?.status === 'running' && leftMs > 0;
  const isPaused = timer?.status === 'paused';
  const playLabel = isRunning
    ? 'Pause the timer'
    : isPaused
      ? 'Resume the timer'
      : 'Start the timer';
  return (
    <div className={[styles.row, styles.timer].join(' ')}>
      <TimeOrField
        leftMs={leftMs}
        isDone={timer?.status === 'running' && leftMs === 0}
        canSet={canEdit && !isRunning}
        onSet={(ms) => {
          if (timer === undefined) props.onDraft(ms);
          else run({ kind: 'set-duration', durationMs: ms });
        }}
      />
      <span className={styles.of}>of {formatTimerClock(durationMs)}</span>
      <span className={styles.spacer} />
      <CardButton
        icon={isRunning ? 'pause' : 'play'}
        label={playLabel}
        isPressed={isRunning}
        isDisabled={!canEdit}
        onClick={() => {
          run(
            isRunning
              ? { kind: 'pause' }
              : isPaused
                ? { kind: 'resume' }
                : { kind: 'start', durationMs },
          );
        }}
      />
      <CardButton
        icon="close"
        label="Reset the timer"
        isDisabled={!canEdit || timer === undefined || timer.status === 'idle'}
        onClick={() => {
          run({ kind: 'reset' });
        }}
      />
    </div>
  );
}

/**
 * The time left, which the owner and editors click to set the duration while the timer is not
 * running; the field in its place while they do.
 *
 * @param props - The time, whether it ran out, whether it may be set, and where a duration goes.
 * @param props.leftMs - The time left, in ms.
 * @param props.isDone - Whether a running timer ran out.
 * @param props.canSet - Whether the person may set the duration now.
 * @param props.onSet - Receives a duration a person set, in ms.
 * @returns The time or the field.
 */
function TimeOrField(props: {
  readonly leftMs: number;
  readonly isDone: boolean;
  readonly canSet: boolean;
  readonly onSet: (ms: number) => void;
}): ReactElement {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const shown = formatTimerClock(props.leftMs);
  if (draft === undefined || !props.canSet) {
    return (
      <button
        type="button"
        className={styles.time}
        aria-label={`${shown} left${props.canSet ? ', set the duration' : ''}`}
        data-state={props.isDone ? 'done' : undefined}
        disabled={!props.canSet}
        onClick={() => {
          setDraft(shown);
        }}
      >
        {shown}
      </button>
    );
  }
  const parsed = parseTimerDuration(draft);
  const commit = (): void => {
    if (parsed !== undefined) props.onSet(parsed);
    setDraft(undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (isImeKey(event.nativeEvent)) return;
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') {
      event.stopPropagation();
      setDraft(undefined);
    }
  };
  return (
    <input
      className={styles.durationField}
      aria-label="Timer duration"
      aria-invalid={parsed === undefined}
      autoFocus
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  );
}
