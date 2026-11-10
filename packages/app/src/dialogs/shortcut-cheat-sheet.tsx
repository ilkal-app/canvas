import { Fragment, type ReactElement } from 'react';

import { whiteboardSheetOf } from '../keymap/whiteboard-sheet.js';
import {
  listShortcuts,
  matchShortcut,
  type ShortcutRegistry,
} from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import { ChordKeycaps } from './chord-keycaps.js';
import { Dialog } from './dialog.js';
import styles from './shortcut-cheat-sheet.module.css';

/** Props of {@link ShortcutCheatSheet}. */
export interface ShortcutCheatSheetProps {
  /** The shortcuts to list. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** Called when the person dismisses the sheet. */
  readonly onClose: () => void;
  /**
   * Which sheet: every shortcut by category (`classic`, the default), or a floating whiteboard's
   * (`whiteboard`): its tools in the dock's order, Pan's Space hold, no design tools.
   */
  readonly layout?: 'classic' | 'whiteboard' | undefined;
}

/**
 * The keyboard shortcut cheat sheet: a modal dialog
 * ({@link Dialog}) listing every registered shortcut by category, chords shown the platform's
 * way. Focus moves into the dialog on open, stays inside it, and returns where it was on close.
 * Escape, the cheat sheet shortcut itself (`?`) and a click on the backdrop close it.
 *
 * @param props - The shortcuts and the close handler.
 * @returns The dialog and its backdrop.
 */
export function ShortcutCheatSheet(props: ShortcutCheatSheetProps): ReactElement {
  const { registry, onClose } = props;
  const groups =
    props.layout === 'whiteboard'
      ? whiteboardSheetOf(listShortcuts(registry), registry.platform)
      : listShortcuts(registry);
  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={onClose}
      isCloseKey={(event) => matchShortcut(event, registry)?.action.type === 'toggleCheatSheet'}
    >
      {/* Focusable so keyboard users can scroll a long list. */}
      <div className={styles.groups} tabIndex={0}>
        {groups.map((group) => (
          <section key={group.category} aria-label={group.label}>
            <h3 className={styles.groupTitle}>{group.label}</h3>
            <dl className={styles.list}>
              {group.entries.map((entry) => (
                <div key={entry.id} className={styles.row}>
                  <dt className={styles.description}>{entry.description}</dt>
                  <dd className={styles.chords}>
                    {entry.parsedChords.map((chord, index) => (
                      <Fragment key={index}>
                        {index > 0 && <span>or</span>}
                        <ChordKeycaps chord={chord} platform={registry.platform} />
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
