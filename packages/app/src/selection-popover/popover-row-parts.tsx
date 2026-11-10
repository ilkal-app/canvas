import type { ReactElement } from 'react';

import { notAvailableName } from '../controls/not-available.js';
import { emphasisOf } from '../editing/text-bar-model.js';
import type { TextStyleChange, TextStyleContext } from '../engine/text-style-types.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { useBoardVote } from '../voting/vote-context.js';

import styles from './selection-popover.module.css';

/**
 * A 1 × 20 px hairline between the popover's groups (frame A).
 *
 * @returns The rule.
 */
export function Divider(): ReactElement {
  return <span className={styles.divider} aria-hidden="true" data-popover-divider="" />;
}

/**
 * The text row's Bold and Italic toggles (the TEXT card): pressed as the selected text
 * is, "mixed" where it differs; each press is one toggle of the whole selection, as mod+b and
 * mod+i do.
 *
 * @param props - The selected text's style and the handler.
 * @param props.textStyle - The engine's view of the selected text.
 * @param props.onTextStyle - Applies a text style change.
 * @returns The two toggles.
 */
export function EmphasisToggles(props: {
  readonly textStyle: TextStyleContext | undefined;
  readonly onTextStyle: ((change: TextStyleChange) => void) | undefined;
}): ReactElement {
  const emphasis = emphasisOf(props.textStyle?.style ?? {});
  return (
    <>
      <button
        type="button"
        className={styles.glyphButton}
        data-glyph="bold"
        aria-label="Bold"
        aria-pressed={emphasis.bold}
        onClick={() => {
          props.onTextStyle?.({ kind: 'toggleBold' });
        }}
      >
        B
      </button>
      <button
        type="button"
        className={styles.glyphButton}
        data-glyph="italic"
        aria-label="Italic"
        aria-pressed={emphasis.italic}
        onClick={() => {
          props.onTextStyle?.({ kind: 'toggleItalic' });
        }}
      >
        I
      </button>
    </>
  );
}

/**
 * A control the design shows that is not built yet (the owner's rule for unbuilt features,
 * 2026-10-05): its icon at 38%, named and titled "… — not available yet", and doing nothing.
 *
 * @param props - Its name and icon.
 * @param props.label - Its name.
 * @param props.icon - Its icon.
 * @returns The button.
 */
export function NotYetButton(props: {
  readonly label: string;
  readonly icon: IconName;
}): ReactElement {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={notAvailableName(props.label)}
      title={notAvailableName(props.label)}
      aria-disabled="true"
    >
      <Icon name={props.icon} />
    </button>
  );
}

/**
 * The sticky row's Vote while no dot vote is open: disabled, with the reason as its
 * tooltip. While a vote is open and the person can vote, the popover's own Vote (
 * `vote-button.tsx`) takes its place, so this one draws nothing then.
 *
 * @returns The button, or nothing during a vote.
 */
export function VoteButton(): ReactElement | null {
  const vote = useBoardVote();
  if (vote?.canVote === true && vote.session?.status === 'open') return null;
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label="Vote"
      aria-disabled="true"
      title="Vote works only during a dot vote"
    >
      <Icon name="vote" />
    </button>
  );
}

/**
 * An icon button of the popover row: named by its action, disabled by `aria-disabled`
 * (it stays focusable and says why in its tooltip), pressed where it is a toggle.
 *
 * @param props - Its name, icon, state and action.
 * @param props.label - Its name.
 * @param props.icon - Its icon.
 * @param props.onPress - Runs when it is pressed while enabled.
 * @param props.isDisabled - Whether it does nothing now.
 * @param props.isPressed - Its toggle state; absent for a plain button.
 * @param props.title - Its tooltip, if not its name.
 * @returns The button.
 */
export function RowButton(props: {
  readonly label: string;
  readonly icon: IconName;
  readonly onPress: () => void;
  readonly isDisabled?: boolean | undefined;
  readonly isPressed?: boolean | undefined;
  readonly title?: string | undefined;
}): ReactElement {
  const isDisabled = props.isDisabled === true;
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={props.label}
      aria-pressed={props.isPressed}
      aria-disabled={isDisabled ? true : undefined}
      title={props.title ?? props.label}
      onClick={() => {
        if (!isDisabled) props.onPress();
      }}
    >
      <Icon name={props.icon} />
    </button>
  );
}
