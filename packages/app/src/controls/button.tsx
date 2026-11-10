import type { MouseEvent, ReactElement, ReactNode, Ref } from 'react';

import { Spinner } from '../feedback/spinner.js';

import styles from './button.module.css';
import { notAvailableName } from './not-available.js';

/** A button's kind (the control states sheet, 35:1786): its rows. */
export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Props of {@link Button}. */
export interface ButtonProps {
  /** Its kind; `secondary` when absent. */
  readonly kind?: ButtonKind;
  /** Its words ("Save"). */
  readonly children: ReactNode;
  /** `submit` in a form; `button` when absent. */
  readonly type?: 'button' | 'submit';
  /** Its accessible name, when its words do not name what it acts on ("Remove Grace Hopper"). */
  readonly name?: string | undefined;
  /** Runs it; not called while it is disabled, busy or unavailable. */
  readonly onClick?: (() => void) | undefined;
  /**
   * Whether it is disabled: 38% opacity, no hover, announced as disabled, out of the tab order.
   * Ignored while it is busy, which keeps focus (a caller that disables while it works).
   */
  readonly isDisabled?: boolean | undefined;
  /**
   * While it works, the words that say what is happening ("Saving…"): it shows them after a
   * spinner, is announced busy, keeps focus and takes no second press. Not busy when absent.
   */
  readonly busyLabel?: string | undefined;
  /**
   * Whether its feature exists; true when absent. An unavailable button shows disabled, stays in
   * the focus order (`aria-disabled`), says "<words> — not available yet" in its name and
   * tooltip, and does nothing.
   */
  readonly isAvailable?: boolean | undefined;
  /** The element, to move focus to it. */
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
  /** Placement only (a margin), from the screen that shows it. */
  readonly className?: string | undefined;
  /** What it describes itself by (`aria-describedby`): a tooltip's or a hint's id. */
  readonly describedBy?: string | undefined;
}

/**
 * The shared button of the control states sheet (35:1786; UI-18): primary, secondary, ghost or
 * danger, 32 px tall, with its sheet states. Hover and pressed come from its stylesheet; keyboard
 * focus is the shared 2 px ring outside it; disabled is 38% opacity with no hover, announced as
 * disabled; busy shows a spinner and words that say what is happening ("Saving…"), is
 * `aria-busy` and `aria-disabled` (so focus stays on it) and ignores a second press, a submit
 * included; a button whose feature is not built says so and does nothing.
 *
 * @param props - Its kind, words, state and action.
 * @returns The button.
 */
export function Button(props: ButtonProps): ReactElement {
  const { busyLabel, isAvailable = true } = props;
  const isBusy = busyLabel !== undefined;
  const isHeld = isBusy || !isAvailable;
  const name =
    !isAvailable && typeof props.children === 'string'
      ? notAvailableName(props.name ?? props.children)
      : props.name;
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (isHeld) {
      // A press while busy or unavailable does nothing, a form's submit included.
      event.preventDefault();
      return;
    }
    props.onClick?.();
  };
  return (
    <button
      ref={props.buttonRef}
      type={props.type === 'submit' ? 'submit' : 'button'}
      className={[styles.button, props.className].filter(Boolean).join(' ')}
      data-kind={props.kind ?? 'secondary'}
      aria-label={name}
      title={isAvailable ? undefined : name}
      aria-describedby={props.describedBy}
      aria-busy={isBusy ? true : undefined}
      aria-disabled={isHeld ? true : undefined}
      disabled={props.isDisabled === true && !isBusy}
      onClick={onClick}
    >
      {isBusy ? (
        <>
          <Spinner size={14} />
          {busyLabel}
        </>
      ) : (
        props.children
      )}
    </button>
  );
}
