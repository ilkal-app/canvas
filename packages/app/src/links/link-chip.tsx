import { useState, type ReactElement } from 'react';

import { FloatingSheet } from '../controls/floating-sheet.js';
import { LinkEditor } from '../selection-popover/popover-link.js';

import styles from './link-chip.module.css';
import { linkLabelOf } from './link-label.js';
import { openLink } from './open-link.js';

/** Props of {@link LinkChip}. */
export interface LinkChipProps {
  /** The link, as stored. */
  readonly link: string;
  /** Where the chip's top-left corner sits in its layer, CSS px. */
  readonly left: number;
  /** Where the chip's top-left corner sits in its layer, CSS px. */
  readonly top: number;
  /** Whether a finger opened it: its buttons are 44 px. */
  readonly isTouch: boolean;
  /** Copies the link and says so. */
  readonly onCopy: () => void;
  /** Applies an edited link, one undo step; absent for a person who cannot edit (no Edit). */
  readonly onApply?: ((link: string) => void) | undefined;
  /** Removes the link, one undo step; absent for a person who cannot edit (no Remove). */
  readonly onRemove?: (() => void) | undefined;
  /**
   * Whether Remove shows in the row (the editing chip, whose caret sits in the link); else it is
   * in Edit's dialog only, as the owner's mock has it.
   */
  readonly hasRemoveButton?: boolean | undefined;
  /** Closes the chip: Escape, Open, or after an edit. */
  readonly onClose: () => void;
}

/**
 * The chip's row: the address as plain text, Open, Copy, Edit for an editor and, where asked,
 * Remove.
 *
 * @param props - The chip's props, and what Edit does.
 * @param props.chip - The chip's props.
 * @param props.onEdit - Shows the link field in place.
 * @returns The row's contents.
 */
function ChipRow(props: {
  readonly chip: LinkChipProps;
  readonly onEdit: () => void;
}): ReactElement {
  const { link, onApply, onRemove, onClose } = props.chip;
  return (
    <>
      <span className={styles.address} title={link} data-link-chip-address="">
        {linkLabelOf(link)}
      </span>
      <button
        type="button"
        className={styles.action}
        aria-label={`Open ${link}`}
        onClick={() => {
          openLink(link);
          onClose();
        }}
      >
        Open ↗
      </button>
      <button
        type="button"
        className={styles.action}
        aria-label="Copy link"
        onClick={props.chip.onCopy}
      >
        Copy
      </button>
      {onApply === undefined ? null : (
        <button
          type="button"
          className={styles.action}
          aria-label="Edit link"
          onClick={props.onEdit}
        >
          Edit
        </button>
      )}
      {onRemove === undefined || props.chip.hasRemoveButton !== true ? null : (
        <button
          type="button"
          className={styles.action}
          aria-label="Remove link"
          onClick={() => {
            onRemove();
            onClose();
          }}
        >
          Remove
        </button>
      )}
    </>
  );
}

/**
 * The link chip (item 6): a small toolbar under a link with the
 * link's address as plain text (`linkLabelOf`, the whole link as its tooltip), **Open** (a new tab
 * with no opener and no referrer, through `openLink`, which checks the link again), **Copy**,
 * and for a person who can edit **Edit** (the link dialog's field in place, applied by Enter once
 * `normalizeLink` accepts it, with Remove) and, where asked, **Remove** in the row. Opening is
 * always this second, deliberate press: a click or tap on a link only shows the chip, so a
 * mis-tap or a drag never leaves the board. Escape closes it. A finger's chip has 44 px buttons.
 *
 * @param props - The link, where it sits, and what its buttons do.
 * @returns The chip.
 */
export function LinkChip(props: LinkChipProps): ReactElement {
  const { link, onApply, onRemove, onClose } = props;
  const [isEditing, setEditing] = useState(false);
  return (
    <FloatingSheet
      shape={isEditing ? 'stack' : 'toolbar'}
      role={isEditing ? 'dialog' : 'toolbar'}
      label="Link"
      className={styles.chip}
      style={{ left: props.left, top: props.top }}
      dataAttributes={
        props.isTouch ? { 'data-link-chip': '', 'data-touch': '' } : { 'data-link-chip': '' }
      }
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {isEditing && onApply !== undefined && onRemove !== undefined ? (
        <LinkEditor
          link={link}
          hasLink
          onApply={(edited) => {
            onApply(edited);
            onClose();
          }}
          onRemove={() => {
            onRemove();
            onClose();
          }}
        />
      ) : (
        <ChipRow
          chip={props}
          onEdit={() => {
            setEditing(true);
          }}
        />
      )}
    </FloatingSheet>
  );
}
