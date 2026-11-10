import type { ReactElement } from 'react';

import type { IconName } from '../../icons/icon-paths.js';
import { Icon } from '../../icons/icon.js';
import { ROVING_ITEM_ATTRIBUTE } from '../use-roving-focus.js';

import styles from './panel-controls.module.css';

/** The roving-focus mark every panel item carries (`useRovingFocus`). */
export const PANEL_ITEM = { [ROVING_ITEM_ATTRIBUTE]: '' } as const;

/**
 * A tool panel's 28 px icon button (the design's SHAPES and CONNECTOR cards): pressed while its
 * choice is the panel's, one of the panel's roving items. A mouse press keeps focus where it was.
 *
 * @param props - Its name, icon, state and handler.
 * @param props.label - Its accessible name and tooltip.
 * @param props.icon - Its icon.
 * @param props.isPressed - Whether its choice is the panel's.
 * @param props.onSelect - Chooses it.
 * @returns The button.
 */
export function PanelIconButton(props: {
  readonly label: string;
  readonly icon: IconName;
  readonly isPressed: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.isPressed}
      {...PANEL_ITEM}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={props.onSelect}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/**
 * A tool panel's divider between groups.
 *
 * @returns The divider.
 */
export function PanelDivider(): ReactElement {
  return <span className={styles.divider} aria-hidden="true" data-panel-divider="" />;
}
