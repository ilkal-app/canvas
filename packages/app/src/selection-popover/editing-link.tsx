import { useCallback, useRef, useState, type ReactElement } from 'react';

import { AnchoredPopover } from '../controls/anchored-popover.js';
import { focusTextEditor } from '../focus/text-bar-target.js';
import { Icon } from '../icons/icon.js';
import chipStyles from '../links/link-chip.module.css';
import { linkLabelOf } from '../links/link-label.js';
import { openLink } from '../links/open-link.js';
import { LINK_SHORTCUT, useLinkShortcut } from '../links/use-link-shortcut.js';
import { MIXED } from '../panels/controls/mixed-value.js';
import { detectKeyboardPlatform } from '../shortcuts/keyboard-platform.js';

import type { PopoverStyleControlsProps } from './popover-controls.js';
import { LinkEditor } from './popover-link.js';
import popoverStyles from './selection-popover.module.css';

/**
 * The link the edited text's selection shares: a style without a `link` key is mixed
 * (`commonStyle` drops a field that differs), one whose `link` is undefined has none.
 *
 * @param style - The selection's shared style, if known.
 * @returns The link, `undefined` for none, or {@link MIXED}.
 */
function sharedLinkOf(
  style: Readonly<Record<string, unknown>> | undefined,
): string | undefined | typeof MIXED {
  if (style === undefined || !('link' in style)) return MIXED;
  return typeof style.link === 'string' ? style.link : undefined;
}

/**
 * Whether a key comes from the edited text's own input (the hidden textarea), where the link
 * shortcut is the editing popover's.
 *
 * @param target - The key's target.
 * @returns True for the text editor's input.
 */
function isTextEditorInput(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches('textarea[data-text-input]');
}

/**
 * The link chip in the editing popover's row: while the caret, or the whole selection,
 * is inside one link, its address as plain text with Open (a new tab, no opener or referrer),
 * Edit (the Link dialog) and Remove (the whole link, one undo step).
 *
 * @param props - The link and what Edit and Remove do.
 * @param props.link - The link.
 * @param props.onEdit - Opens the Link dialog.
 * @param props.onRemove - Removes the link.
 * @returns The chip.
 */
function EditingLinkChip(props: {
  readonly link: string;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}): ReactElement {
  const { link } = props;
  return (
    <span
      className={chipStyles.inlineChip}
      data-editing-link-chip=""
      role="group"
      aria-label="Link"
    >
      <span className={chipStyles.address} title={link} data-link-chip-address="">
        {linkLabelOf(link)}
      </span>
      <button
        type="button"
        className={chipStyles.action}
        aria-label={`Open ${link}`}
        onClick={() => {
          openLink(link);
        }}
      >
        Open ↗
      </button>
      <button
        type="button"
        className={chipStyles.action}
        aria-label="Edit link"
        onClick={props.onEdit}
      >
        Edit
      </button>
      <button
        type="button"
        className={chipStyles.action}
        aria-label="Remove link"
        onClick={props.onRemove}
      >
        Remove
      </button>
    </span>
  );
}

/**
 * The editing popover's Link:'s link button for the selected characters
 * rather than the object. A 28 px button named "Link", "Link: <the link>" or "Link: Mixed"
 * opens the same dialog (`LinkEditor`): an address applied by Enter once `normalizeLink`
 * accepts it, the shared destination as text with Open, and Remove for a range with any link.
 * It restyles the selected range (`{ link }`, or `{ link: null }` to remove), one undo step; at
 * a caret it sets the link for the text typed next, or with the caret inside a link changes that
 * whole link. ⌘K (Ctrl+K) opens it from the text. While the caret or the
 * selection is inside one link, the link chip follows the button (`EditingLinkChip`). Closing
 * gives the keyboard back to the text.
 *
 * @param props - The popover's style controls.
 * @param props.controls - The edited text's style and how to change it.
 * @returns The button and, while open, its dialog.
 */
export function EditingLinkButton(props: {
  readonly controls: PopoverStyleControlsProps;
}): ReactElement {
  const { controls } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => {
    setOpen(true);
  }, []);
  useLinkShortcut(open, isTextEditorInput);
  const shared = sharedLinkOf(controls.textStyle?.style);
  const link = shared === MIXED ? undefined : shared;
  const name = shared === MIXED ? 'Link: Mixed' : link === undefined ? 'Link' : `Link: ${link}`;
  const close = (): void => {
    setOpen(false);
    if (buttonRef.current !== null) focusTextEditor(buttonRef.current);
  };
  const restyle = (value: string | null): void => {
    controls.onTextStyle?.({ kind: 'style', patch: { link: value } });
    close();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={popoverStyles.iconButton}
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-pressed={shared === MIXED ? 'mixed' : link !== undefined}
        aria-keyshortcuts={LINK_SHORTCUT[detectKeyboardPlatform(navigator.userAgent)]}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <Icon name="link" />
      </button>
      {link === undefined || isOpen ? null : (
        <EditingLinkChip
          link={link}
          onEdit={open}
          onRemove={() => {
            restyle(null);
          }}
        />
      )}
      <AnchoredPopover
        anchor={buttonRef}
        isOpen={isOpen}
        label="Link"
        role="dialog"
        shape="stack"
        side="bottom"
        align="start"
        gap={12}
        onClose={close}
      >
        <LinkEditor
          // A fresh field each time it opens: the range, and its link, change while it is shut.
          key={`${String(isOpen)}|${link ?? ''}`}
          link={link}
          hasLink={shared !== undefined}
          onApply={restyle}
          onRemove={() => {
            restyle(null);
          }}
        />
      </AnchoredPopover>
    </>
  );
}
