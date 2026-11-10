import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import type { BoardView } from '../engine/board-view.js';
import { isEditableTarget } from '../focus/editable-target.js';
import { isInteractiveTarget } from '../focus/interactive-target.js';
import { useBoardViewState } from '../hooks/use-board-view-state.js';
import { POPOVER_AVOID_ATTRIBUTE } from '../selection-popover/reserved-zones.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShellState } from '../state/shell-reducer.js';
import {
  dismissWhiteboardHint,
  isWhiteboardHintDismissed,
  whiteboardHintText,
} from '../state/whiteboard-hint.js';

import styles from './whiteboard-hint.module.css';

/** Props of {@link WhiteboardHint}. */
export interface WhiteboardHintProps {
  /** The board on screen, once an engine runs. */
  readonly board: BoardView | undefined;
  /** The shell state: whether the person may edit, the active tool and the search requests. */
  readonly state: Pick<ShellState, 'canEdit' | 'activeTool' | 'boardSearchRequests'>;
  /** Whose keys the hint names. */
  readonly platform: KeyboardPlatform;
}

/**
 * The onboarding hint under a blank floating whiteboard's dock: "Press N for a sticky
 * · Space to pan · ⌘F to search", for a person who can edit, while the board holds nothing and
 * the hint was never dismissed. Its first use dismisses it for good in this browser: a tool
 * chosen, an object created, board search opened or Space held to pan.
 *
 * @param props - The board, the shell state and the platform.
 * @returns The hint, or nothing.
 */
export function WhiteboardHint(props: WhiteboardHintProps): ReactElement | null {
  const { state } = props;
  const [isDismissed, setIsDismissed] = useState(() => isWhiteboardHintDismissed());
  const snapshot = useBoardViewState(props.board);
  const isBlank =
    props.board !== undefined && snapshot.board.references.childrenOf(null).size === 0;
  const isShown = !isDismissed && state.canEdit && isBlank;
  const shownWithRef = useRef<{ tool: string; searches: number } | undefined>(undefined);
  const dismiss = useCallback((): void => {
    dismissWhiteboardHint();
    setIsDismissed(true);
  }, []);
  // What the shell was when the hint first showed: a change of either is its first use.
  if (isShown && shownWithRef.current === undefined) {
    shownWithRef.current = { tool: state.activeTool, searches: state.boardSearchRequests };
  }
  const shownWith = shownWithRef.current;
  const isUsed =
    shownWith !== undefined &&
    !isDismissed &&
    (state.activeTool !== shownWith.tool ||
      state.boardSearchRequests !== shownWith.searches ||
      (props.board !== undefined && !isBlank));
  useEffect(() => {
    if (isUsed) dismiss();
  }, [isUsed, dismiss]);
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== ' ') return;
      // What Space-pan itself takes (engine/space-pan-binding.ts): the real target, past a
      // shadow root, and not a field or a control, where Space types or presses instead.
      const target = event.composedPath()[0] ?? event.target;
      if (!isEditableTarget(target) && !isInteractiveTarget(target)) dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isShown, dismiss]);
  if (!isShown || isUsed) return null;
  return (
    <p className={styles.hint} data-whiteboard-hint="" {...{ [POPOVER_AVOID_ATTRIBUTE]: '' }}>
      {whiteboardHintText(props.platform)}
    </p>
  );
}
