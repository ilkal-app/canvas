import { useId, type ReactElement, type ReactNode } from 'react';

import styles from './tooltip.module.css';

/**
 * Where a tooltip opens from its control: `above`, centred; `above-start` and `above-end`,
 * above it from its start or to its end (a button at a panel's edge, whose centred
 * tooltip would be cut off); `below-end`, under it at its end.
 */
export type TooltipPlacement = 'above' | 'above-start' | 'above-end' | 'below-end';

/** Props of {@link Tooltip}: the Tooltip component's (Figma 35:1769: Text, Key, Show key). */
export interface TooltipProps {
  /** Its words (Text): the control's accessible description. */
  readonly text: string;
  /** The control's shortcut as the platform writes it (Key); shown when present (Show key). */
  readonly shortcut?: string | undefined;
  /**
   * `above`, centred (the dock's); `above-start` or `above-end`, above it from its start or to
   * its end (the inspector's buttons at the panel's edges); `below-end`, under the control at
   * its end (a bar's).
   */
  readonly placement?: TooltipPlacement;
  /**
   * The control, and anything else in its slot (a flyout), given the tooltip's id for its
   * `aria-describedby`.
   */
  readonly children: (tooltipId: string) => ReactNode;
}

/**
 * The shared Tooltip (Figma 35:1769; UI-18): a slot holding a control and its tooltip, the
 * inverse chip of primary ink with the text in the mat's colour and, when given, the shortcut in
 * a mono key. It shows while the slot is hovered and while the control has keyboard focus, not
 * while a menu the control opened is in its slot; its text is the control's accessible
 * description (`aria-describedby`); the key is not, the control carries `aria-keyshortcuts`.
 *
 * @param props - Its words, shortcut, placement and the control.
 * @returns The slot.
 */
export function Tooltip(props: TooltipProps): ReactElement {
  const id = useId();
  return (
    <span className={styles.slot}>
      {props.children(id)}
      <span
        id={id}
        role="tooltip"
        className={styles.tooltip}
        data-placement={props.placement ?? 'above'}
      >
        {props.text}
        {props.shortcut === undefined ? null : (
          <kbd className={styles.key} aria-hidden="true">
            {props.shortcut}
          </kbd>
        )}
      </span>
    </span>
  );
}
