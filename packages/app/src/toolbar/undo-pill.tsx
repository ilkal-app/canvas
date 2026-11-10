import type { ReactElement } from 'react';

import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { HistoryCommand, ShellAction } from '../state/shell-action.js';

import { actionHint } from './action-hints.js';
import { BOTTOM_CHROME_ATTRIBUTE } from './bottom-chrome.js';
import styles from './dock.module.css';

/** The undo pill's two buttons, in order. */
const HISTORY_BUTTONS: readonly {
  readonly command: HistoryCommand;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { command: 'undo', label: 'Undo', icon: 'undo' },
  { command: 'redo', label: 'Redo', icon: 'redo' },
];

/** Props of {@link UndoPill}. */
export interface UndoPillProps {
  /** The shell's shortcuts, for each button's `aria-keyshortcuts`. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** Receives the history actions. */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * Why editing is refused for now (the live board loading): the pill is then dimmed
   * and its buttons out of reach (a press lands on the pill); nothing if absent.
   */
  readonly refusal?: string | undefined;
}

/**
 * The compact undo pill (the design's "undo"): over the canvas's bottom-left corner,
 * above the compact bottom bar, Undo and Redo as 50 px touch targets with the shared 20 px
 * icons at a 1.5 px stroke; each dispatches the history command the shortcuts do. A press keeps
 * focus where it was (a text edit included). Shown only to a person who can edit; while editing is
 * refused (`refusal`) it is dimmed and out of reach.
 *
 * @param props - The shortcuts and the dispatch.
 * @returns The pill.
 */
export function UndoPill(props: UndoPillProps): ReactElement {
  const { registry, dispatch, refusal } = props;
  const isRefused = refusal !== undefined;
  return (
    <div
      role="group"
      aria-label="History"
      className={styles.undoPill}
      data-dimmed={isRefused ? '' : undefined}
      aria-disabled={isRefused ? true : undefined}
      aria-description={refusal}
      {...{ [BOTTOM_CHROME_ATTRIBUTE]: '' }}
    >
      <div className={styles.contents} inert={isRefused}>
        {HISTORY_BUTTONS.map(({ command, label, icon }) => {
          const action: ShellAction = { type: 'history', command };
          const hint = actionHint(registry, action);
          return (
            <button
              key={command}
              type="button"
              className={styles.pillButton}
              aria-label={label}
              aria-keyshortcuts={hint?.ariaKeyShortcuts}
              title={hint === undefined ? label : `${label} (${hint.label})`}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                dispatch(action);
              }}
            >
              <Icon name={icon} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
