import { useCallback, useEffect, useRef, useState } from 'react';

import type { NoticeOutline } from '../notices/notice-outline.js';

/** A notice the shell shows, numbered so that the same message shown again is new. */
export interface ShellNotice {
  /** What it says. */
  readonly message: string;
  /** Increases by one with every notice shown, starting at 1. */
  readonly sequence: number;
  /** A button beside the message (go to the page objects were moved to); none if absent. */
  readonly action?: NoticeAction;
  /** Objects outlined while it shows (X2); none if absent. */
  readonly outline?: NoticeOutline;
}

/** A notice's button: what it says and what it does. */
export interface NoticeAction {
  /** Its label. */
  readonly label: string;
  /** Runs it; the notice is then hidden. */
  readonly run: () => void;
}

/** What {@link useNotice} gives the shell. */
export interface NoticeBinding {
  /** The notice to show, or undefined when there is none. */
  readonly notice: ShellNotice | undefined;
  /** Shows a sentence, with a button and an outline if given, replacing the one shown. */
  readonly show: (message: string, action?: NoticeAction, outline?: NoticeOutline) => void;
  /** Hides the notice shown (its Dismiss button, its time running out). */
  readonly dismiss: () => void;
}

/** A notice as the hook keeps it: with the canvas action it was shown for. */
interface HeldNotice extends ShellNotice {
  readonly actionSequence: number | undefined;
}

/**
 * The shell's one notice: a sentence saying why an action did nothing
 * (grouping objects with different parents, objects an order command left out), that a
 * command was refused, or what the clipboard could not do. Every notice arrives through the
 * mount's `onNotice` and this `show`; the `Notice` component shows it in its `role="status"`
 * region, hides it after its time, and calls `dismiss`. The next canvas action clears it too,
 * unless it was shown for that action. Main thread.
 *
 * @param actionSequence - The shell's latest canvas action's `sequence`.
 * @returns The notice, and the functions that show and hide one.
 */
export function useNotice(actionSequence: number | undefined): NoticeBinding {
  const [held, setHeld] = useState<HeldNotice>();
  const actionSequenceRef = useRef(actionSequence);
  const noticeSequenceRef = useRef(0);
  useEffect(() => {
    actionSequenceRef.current = actionSequence;
  });
  const show = useCallback((message: string, action?: NoticeAction, outline?: NoticeOutline) => {
    noticeSequenceRef.current += 1;
    const sequence = noticeSequenceRef.current;
    const actionSequence = actionSequenceRef.current;
    setHeld({
      message,
      sequence,
      actionSequence,
      ...(action === undefined ? {} : { action }),
      ...(outline === undefined ? {} : { outline }),
    });
  }, []);
  const dismiss = useCallback(() => {
    setHeld(undefined);
  }, []);
  const isCurrent = held !== undefined && held.actionSequence === actionSequence;
  const notice = isCurrent
    ? {
        message: held.message,
        sequence: held.sequence,
        ...(held.action === undefined ? {} : { action: held.action }),
        ...(held.outline === undefined ? {} : { outline: held.outline }),
      }
    : undefined;
  return { notice, show, dismiss };
}
