import { useEffect, useRef, type ReactElement } from 'react';

import { notAvailableName } from '../controls/not-available.js';

import styles from './toast.module.css';

/** A toast's kind (Figma 35:1785, Kind): its dot is neutral, the live colour or the red pencil. */
export type ToastKind = 'info' | 'success' | 'error';

/** A toast's action (Figma 35:1785, Action): a text button after its message. */
export interface ToastAction {
  /** Its words ("Retry", "Undo", "Why?"). */
  readonly label: string;
  /** Runs it; never called while it is unavailable. */
  readonly onAction: () => void;
  /**
   * Whether its feature exists; true when absent. An unavailable action is shown `aria-disabled`
   * (so it stays in the focus order), says "<label> — not available yet" in its name and
   * tooltip, and does nothing (the owner's 2026-10-05 rule for unbuilt features).
   */
  readonly isAvailable?: boolean | undefined;
}

/**
 * A toast's surface: the sheet (Figma 35:1785), or `inverse`, the action fill with the action
 * ink, no dot and no Dismiss button, its action in the hand's amber (home's "moved to Trash"
 * toast, frame H4). An inverse toast still goes with Escape and its time.
 */
export type ToastTone = 'sheet' | 'inverse';

/** What a toast shows: the Toast component's props (Figma 35:1785). */
export interface ToastContent {
  /** Its kind (Kind). */
  readonly kind: ToastKind;
  /** Its sentence (Message). */
  readonly message: string;
  /** Its action, if any (Action; Has action is whether there is one). */
  readonly action?: ToastAction | undefined;
  /** Whether it goes by itself after {@link TOAST_DURATION_MS}; else it stays until dismissed. */
  readonly isTimed?: boolean | undefined;
  /** Its surface; the sheet if absent. */
  readonly tone?: ToastTone | undefined;
}

/** Props of {@link Toast}. */
export interface ToastProps {
  /** The live region it speaks through: `status` for what was done, `alert` for why not. */
  readonly role: 'status' | 'alert';
  /** What it shows, or undefined while there is nothing. */
  readonly toast: ToastContent | undefined;
  /** Takes it away (its Dismiss, and the time running out); no Dismiss when absent. */
  readonly onDismiss?: (() => void) | undefined;
  /**
   * The live region's accessible name ("Notice", "Board access"), so a screen reader and a test
   * can tell one region from another; unnamed if absent.
   */
  readonly label?: string | undefined;
}

/**
 * A toast's action button: plain, or, when its feature is not built, disabled and saying so.
 *
 * @param props - The action.
 * @param props.action - The action.
 * @returns The button.
 */
function ToastActionButton(props: { readonly action: ToastAction }): ReactElement {
  const { action } = props;
  if (action.isAvailable === false) {
    const name = notAvailableName(action.label);
    return (
      <button
        type="button"
        className={styles.action}
        aria-disabled="true"
        aria-label={name}
        title={name}
      >
        {action.label}
      </button>
    );
  }
  return (
    <button type="button" className={styles.action} onClick={action.onAction}>
      {action.label}
    </button>
  );
}

/** How long a timed toast shows, ms (D-TOAST: Info and Success go after 4 s). */
export const TOAST_DURATION_MS = 4000;

/**
 * One toast, the shared Toast component (Figma 35:1785; UI-18): an 8 px dot of its kind, the
 * message, an optional action (shown disabled, "not available yet", when its feature is not
 * built) and Dismiss, on the sheet with the float shadow (or, `inverse`, on the action fill with
 * no dot and no Dismiss button). Its live region (`role` status or
 * alert) stays in the page, empty while there is nothing to say, so a screen reader announces
 * each message as it arrives, and holds only the message: the buttons sit beside it. A timed
 * toast goes after {@link TOAST_DURATION_MS}; an error stays until dismissed or acted on.
 *
 * @param props - Its region, content and dismiss handler.
 * @returns The toast.
 */
export function Toast(props: ToastProps): ReactElement {
  const { role, toast, onDismiss } = props;
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  const timedMessage = toast?.isTimed === true ? toast.message : undefined;
  useEffect(() => {
    if (timedMessage === undefined) return undefined;
    const timer = setTimeout(() => {
      dismissRef.current?.();
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [timedMessage, toast]);
  const isInverse = toast?.tone === 'inverse';
  return (
    <div className={styles.toast} data-kind={toast?.kind} data-tone={toast?.tone}>
      {toast === undefined || isInverse ? null : <span className={styles.dot} aria-hidden="true" />}
      <div role={role} aria-label={props.label} className={styles.message}>
        {toast === undefined ? null : toast.message}
      </div>
      {toast?.action === undefined ? null : <ToastActionButton action={toast.action} />}
      {toast === undefined || onDismiss === undefined || isInverse ? null : (
        <button
          type="button"
          className={styles.action}
          aria-label={`Dismiss: ${toast.message}`}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
