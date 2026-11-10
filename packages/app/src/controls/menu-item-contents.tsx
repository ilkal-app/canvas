import type { ReactElement } from 'react';

import { Icon } from '../icons/icon.js';

import type { MenuItemEntry } from './menu.js';
import styles from './menu.module.css';

/** What a menu row shows. */
interface MenuItemContentsProps {
  /** The entry. */
  readonly entry: MenuItemEntry;
  /** The menu's variant. */
  readonly variant: 'default' | 'compact';
  /** Whether it opens a submenu (a › at the end). */
  readonly hasSubmenu: boolean;
}

/**
 * A menu row's contents: in a compact menu a check column first; the label; the meta (a
 * shortcut, a value, a submenu's ›) at the end; and for a checkbox of the default menu, its
 * check after the meta while on, so its label starts where every label starts.
 *
 * @param props - The entry, the variant and whether it opens a submenu.
 * @returns The row's contents.
 */
export function MenuItemContents(props: MenuItemContentsProps): ReactElement {
  const { entry, variant, hasSubmenu } = props;
  const isCompact = variant === 'compact';
  return (
    <>
      {isCompact ? (
        <span className={styles.check}>
          {entry.isChecked === true ? <Icon name="check" /> : null}
        </span>
      ) : null}
      {/* Typeahead reads the label alone, not the meta. */}
      <span className={styles.label} style={entry.labelStyle} data-menu-label="">
        {entry.label}
      </span>
      {entry.meta === undefined && !hasSubmenu ? null : (
        <span className={styles.meta}>
          {[entry.meta, hasSubmenu ? '›' : undefined].filter(Boolean).join(' ')}
        </span>
      )}
      {!isCompact && entry.kind === 'checkbox' && entry.isChecked === true ? (
        <span className={styles.check}>
          <Icon name="check" />
        </span>
      ) : null}
    </>
  );
}
