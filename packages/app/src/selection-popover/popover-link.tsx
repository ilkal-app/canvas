import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { normalizeLink, type BoardObject, type ObjectId, type StyleRun } from '@canvas/schema';
import { linkSpansOf } from '@canvas/tools';

import { AnchoredPopover } from '../controls/anchored-popover.js';
import { Icon } from '../icons/icon.js';
import { linkOf } from '../links/link-at.js';
import { openLink } from '../links/open-link.js';
import { LINK_SHORTCUT, useLinkShortcut } from '../links/use-link-shortcut.js';
import { commonValue, MIXED } from '../panels/controls/mixed-value.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import { detectKeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { CharacterRange } from '../state/beside-shell-action.js';
import type { ShellAction } from '../state/shell-action.js';

import styles from './popover-link.module.css';
import popoverStyles from './selection-popover.module.css';

/** What the field says when what was typed is no link. */
export const LINK_INVALID_MESSAGE =
  'Use an http, https or mailto address without a user name or password.';

/** How many run links the Link dialog lists at most (item 12). */
export const MAX_RUN_LINKS = 5;

/** One link on the selected texts' runs, and every range that carries it. */
export interface RunLinkEntry {
  /** The link. */
  readonly link: string;
  /** The ranges that carry it, by object. */
  readonly ranges: ReadonlyMap<ObjectId, readonly CharacterRange[]>;
}

/**
 * The runs of the text an object draws, which may carry run links: a text's or note's, or a
 * shape's or connector's label.
 *
 * @param object - The object.
 * @returns The runs, or none when it draws no text.
 */
function drawnRunsOf(object: BoardObject): readonly StyleRun[] {
  if (object.type === 'text' || object.type === 'sticky') return object.runs;
  if ((object.type === 'shape' || object.type === 'connector') && object.label !== null) {
    return object.label.runs;
  }
  return [];
}

/**
 * The links on the selected texts', notes' and labels' runs (item 12), in reading order,
 * each once with every range that carries it, at most {@link MAX_RUN_LINKS}: only links
 * `normalizeLink` leaves unchanged, the ones `openLink` opens. Pure.
 *
 * @param selection - The selected objects.
 * @returns The links and their ranges.
 */
export function runLinkEntriesOf(selection: readonly BoardObject[]): readonly RunLinkEntry[] {
  const entries = new Map<string, Map<ObjectId, CharacterRange[]>>();
  for (const object of selection) {
    for (const span of linkSpansOf(drawnRunsOf(object))) {
      if (normalizeLink(span.link) !== span.link) continue;
      const known = entries.get(span.link);
      if (known === undefined && entries.size === MAX_RUN_LINKS) continue;
      const ranges = known ?? new Map<ObjectId, CharacterRange[]>();
      entries.set(span.link, ranges);
      const range = { start: span.start, end: span.end };
      ranges.set(object.id, [...(ranges.get(object.id) ?? []), range]);
    }
  }
  return [...entries].map(([link, ranges]) => ({ link, ranges }));
}

/**
 * The links on the selected texts' runs (item 12): `runLinkEntriesOf`'s links. Pure.
 *
 * @param selection - The selected objects.
 * @returns The links.
 */
export function runLinksOf(selection: readonly BoardObject[]): readonly string[] {
  return runLinkEntriesOf(selection).map((entry) => entry.link);
}

/**
 * One link in the Link dialog's list (item 12): its destination as plain text
 * over Open (as {@link openLink} opens it), Copy, and Edit and Remove, which relink every range
 * that carries it, one undo step across every text.
 *
 * @param props - The link and the dispatcher.
 * @param props.entry - The link and its ranges.
 * @param props.dispatch - Runs a shell action.
 * @returns The row.
 */
function RunLinkRow(props: {
  readonly entry: RunLinkEntry;
  readonly dispatch: (action: ShellAction) => void;
}): ReactElement {
  const { entry, dispatch } = props;
  const { link } = entry;
  const [isEditing, setEditing] = useState(false);
  const [isCopied, setCopied] = useState(false);
  const relink = (value: string | null): void => {
    const targets = [...entry.ranges].map(([id, ranges]) => ({ id, ranges }));
    dispatch({ type: 'relinkText', targets, from: link, link: value });
    setEditing(false);
  };
  return (
    <li className={styles.runLink}>
      <p className={styles.destination} data-run-link-destination="">
        {link}
      </p>
      {isEditing ? (
        <LinkEditor
          link={link}
          hasLink
          onApply={relink}
          onRemove={() => {
            relink(null);
          }}
        />
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            aria-label={`Open ${link}`}
            onClick={() => {
              openLink(link);
            }}
          >
            Open link
          </button>
          <button
            type="button"
            className={styles.action}
            aria-label={`Copy ${link}`}
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
              });
            }}
          >
            {isCopied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className={styles.action}
            aria-label={`Edit ${link}`}
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className={styles.action}
            aria-label={`Remove ${link}`}
            onClick={() => {
              relink(null);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The selected texts' and notes' run links in the Link dialog (item 12): each
 * as a {@link RunLinkRow}. A touch screen has no ⌘-click, so this is one way a run's link is
 * followed there; the link chip is the other.
 *
 * @param props - The links and the dispatcher.
 * @param props.entries - The links, from {@link runLinkEntriesOf}.
 * @param props.dispatch - Runs a shell action.
 * @returns The list, or nothing without links.
 */
function RunLinks(props: {
  readonly entries: readonly RunLinkEntry[];
  readonly dispatch: (action: ShellAction) => void;
}): ReactElement | null {
  if (props.entries.length === 0) return null;
  return (
    <ul className={styles.runLinks} aria-label="Links in the text">
      {props.entries.map((entry) => (
        <RunLinkRow key={entry.link} entry={entry} dispatch={props.dispatch} />
      ))}
    </ul>
  );
}

/** Props of {@link PopoverLinkButton}. */
export interface PopoverLinkButtonProps {
  /** The selected objects (texts). */
  readonly selection: readonly BoardObject[];
  /** Runs a shell action: the restyle, one undo step. */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * Whether the dialog lists the run links alone, without the object's link field: a shape's or
   * a connector's label, which have no link of their own.
   */
  readonly isListOnly?: boolean | undefined;
}

/**
 * The dialog's contents: the address field, and for a shared link its destination (as text)
 * with Open and Remove. Shared by an object's link and a run's.
 *
 * @param props - The shared link, and what applying, removing and closing do.
 * @param props.link - The link the selection shares, if any.
 * @param props.hasLink - Whether any selected object has a link (Remove then shows).
 * @param props.onApply - Applies a link.
 * @param props.onRemove - Removes the link.
 * @returns The contents.
 */
export function LinkEditor(props: {
  readonly link: string | undefined;
  readonly hasLink: boolean;
  readonly onApply: (link: string) => void;
  readonly onRemove: () => void;
}): ReactElement {
  const [text, setText] = useState(props.link ?? '');
  const [isInvalid, setInvalid] = useState(false);
  const errorId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || isImeKey(event.nativeEvent)) return;
    event.preventDefault();
    const link = normalizeLink(text);
    setInvalid(link === undefined);
    if (link !== undefined) props.onApply(link);
  };
  const { link } = props;
  return (
    <div className={styles.editor}>
      <input
        type="url"
        className={styles.field}
        aria-label="Link address"
        aria-invalid={isInvalid}
        aria-describedby={isInvalid ? errorId : undefined}
        placeholder="https://"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
      />
      {isInvalid ? (
        <p id={errorId} role="alert" className={styles.error}>
          {LINK_INVALID_MESSAGE}
        </p>
      ) : null}
      {link === undefined ? null : (
        // The destination, as text: never markup, never a link the page follows itself.
        <p className={styles.destination} data-link-destination="">
          {link}
        </p>
      )}
      {props.hasLink ? (
        <div className={styles.actions}>
          {link === undefined ? null : (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                openLink(link);
              }}
            >
              Open link
            </button>
          )}
          <button type="button" className={styles.action} onClick={props.onRemove}>
            Remove link
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The text row's Link: a 28 px button named "Link", "Link: <the link>",
 * "Link: Mixed", or "Links (N)" when the selected text's runs carry N links, opening
 * (or on ⌘K / Ctrl+K) a dialog to type an address (applied by Enter once `normalizeLink`
 * accepts it, else marked invalid), for a shared link its destination as text with Open (a new
 * tab, no opener or referrer), and Remove whenever any selected text has a link. Applying or
 * removing restyles every selected text in one change, one undo step. With `isListOnly` (a shape's
 * or connector's label) the dialog lists the label's links alone.
 *
 * @param props - The selection and the dispatcher.
 * @returns The button and, while open, its dialog.
 */
export function PopoverLinkButton(props: PopoverLinkButtonProps): ReactElement {
  const { selection, dispatch } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => {
    setOpen(true);
  }, []);
  useLinkShortcut(open);
  const shared = commonValue(selection, linkOf);
  const link = shared === MIXED ? undefined : shared;
  const entries = runLinkEntriesOf(selection);
  const name =
    entries.length > 0
      ? `Links (${String(entries.length)})`
      : shared === MIXED
        ? 'Link: Mixed'
        : link === undefined
          ? 'Link'
          : `Link: ${link}`;
  const restyle = (value: string | undefined): void => {
    dispatch({
      type: 'style',
      changes: selection.map((object) => ({ id: object.id, style: { link: value } })),
    });
    setOpen(false);
    buttonRef.current?.focus();
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
      <AnchoredPopover
        anchor={buttonRef}
        isOpen={isOpen}
        label="Link"
        role="dialog"
        shape="stack"
        side="bottom"
        align="start"
        gap={12}
        onClose={() => {
          setOpen(false);
        }}
      >
        {props.isListOnly === true ? null : (
          <LinkEditor
            link={link}
            hasLink={selection.some((object) => linkOf(object) !== undefined)}
            onApply={restyle}
            onRemove={() => {
              restyle(undefined);
            }}
          />
        )}
        <RunLinks entries={entries} dispatch={dispatch} />
      </AnchoredPopover>
    </>
  );
}
