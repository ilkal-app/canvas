import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { FloatingSheet } from '../controls/floating-sheet.js';
import type { EditedText } from '../engine/text-style-types.js';
import { focusTextEditor, TEXT_BAR_ATTRIBUTE } from '../focus/text-bar-target.js';
import { MIXED } from '../panels/controls/mixed-value.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import { AlignDropdown } from './align-dropdown.js';
import { EditingLinkButton } from './editing-link.js';
import rowStyles from './editing-text-row.module.css';
import type { PopoverStyleControlsProps } from './popover-controls.js';
import { Divider, EmphasisToggles } from './popover-row-parts.js';
import { PopoverColourButton, TypeControls } from './popover-shared.js';
import { popoverTextValues } from './popover-values.js';
import type { SelectionPopoverProps } from './selection-popover.js';
import styles from './selection-popover.module.css';
import { isSameData, useStableControlsProps } from './stable-style-controls.js';
import { usePopoverPlacement } from './use-popover-placement.js';

/** The key that moves the keyboard from the edited text into the editing popover. */
export const EDITING_POPOVER_SHORTCUT = 'Alt+F10';

/** What the focus guard lets keep focus inside the popover: an open popup, or a field. */
const KEEPS_FOCUS = '[role="menu"], [role="dialog"], [role="listbox"], input, textarea, select';

/**
 * The text row of the editing popover: every text option for the edited kind, so
 * nothing the classic text bar or the inspector offered is lost under the floating chrome.
 * A text takes font, size, Bold, Italic, text colour and alignment; a sticky the same after its
 * note colour, its alignment vertical too; a shape's or connector's label all but alignment
 * (labels are centred). Font, size, Bold, Italic and the text colour go through `onTextStyle`,
 * which a text editing session applies to the selected range (or the caret's pending style);
 * alignment and a sticky's note colour and vertical alignment restyle the edited object.
 *
 * @param props - The popover's controls' props, the edited object and its kind.
 * @param props.controls - The controls' props, the selection being the edited object.
 * @param props.edited - The edited object's id and type.
 * @returns The row.
 */
export function EditingTextRow(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly edited: EditedText;
}): ReactElement {
  const { controls, edited } = props;
  const values = popoverTextValues(controls.selection, controls.textStyle);
  const isNote = edited.type === 'sticky';
  const canAlign = edited.type === 'sticky' || edited.type === 'text';
  const restyleObject = (style: { readonly verticalAlign?: 'top' | 'middle' | 'bottom' }): void => {
    controls.dispatch({ type: 'style', changes: [{ id: edited.id, style }] });
  };
  return (
    <>
      {isNote ? (
        <>
          <PopoverColourButton
            kind="note"
            value={values.noteColor ?? MIXED}
            controls={controls}
            onChange={(color) => {
              if (color === null || color === 'ink') return;
              controls.dispatch({ type: 'style', changes: [{ id: edited.id, style: { color } }] });
            }}
          />
          <Divider />
        </>
      ) : null}
      <TypeControls controls={controls} values={values} />
      <EmphasisToggles textStyle={controls.textStyle} onTextStyle={controls.onTextStyle} />
      <PopoverColourButton
        kind="text"
        value={values.textColor ?? MIXED}
        controls={controls}
        onChange={(color) => {
          if (color !== null) controls.onTextStyle?.({ kind: 'style', patch: { color } });
        }}
      />
      <EditingLinkButton controls={controls} />
      {canAlign && values.align !== undefined ? (
        <AlignDropdown
          align={values.align}
          verticalAlign={isNote ? values.verticalAlign : undefined}
          onAlign={(align) => {
            controls.onTextStyle?.({ kind: 'align', align });
          }}
          onVerticalAlign={
            isNote
              ? (verticalAlign) => {
                  restyleObject({ verticalAlign });
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

/**
 * The edited object's id as the placement's ids: the same array while the id is the same.
 *
 * @param id - The edited object's id, or none while the popover does not show.
 * @returns The ids.
 */
function useEditedIds(id: ObjectId | undefined): readonly ObjectId[] {
  return useMemo(() => (id === undefined ? [] : [id]), [id]);
}

/**
 * The popover's focusable controls in the row, in order.
 *
 * @param sheet - The popover.
 * @returns Its buttons outside any open popup.
 */
function rowItems(sheet: HTMLElement): HTMLButtonElement[] {
  return [...sheet.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.closest(KEEPS_FOCUS) === null && !button.disabled,
  );
}

/**
 * Moves the keyboard into the popover on {@link EDITING_POPOVER_SHORTCUT}, from the edited text or
 * anywhere else on the page, while it shows; listens in the capture phase, since the editor's
 * input keeps its keys from the window.
 *
 * @param sheetRef - The popover.
 * @param isShown - Whether it shows.
 * @param keyboardRef - Set while the keyboard works the popover (the focus guard lets it stay).
 */
function useEditingShortcut(
  sheetRef: RefObject<HTMLDivElement | null>,
  isShown: boolean,
  keyboardRef: RefObject<boolean>,
): void {
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const sheet = sheetRef.current;
      const first = sheet === null ? undefined : rowItems(sheet)[0];
      if (!event.altKey || event.key !== 'F10' || first === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      keyboardRef.current = true;
      first.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [sheetRef, isShown, keyboardRef]);
}

/**
 * The popover's keys while the keyboard is in it: Escape gives the keyboard back to the text
 * (editing goes on), the arrows and Home and End move between the row's controls, and no key
 * reaches the canvas's shortcuts. An open menu or colour panel keeps its own keys.
 *
 * @param event - The key.
 * @param keyboardRef - Cleared when the keyboard goes back to the text.
 */
function onEditingKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  keyboardRef: RefObject<boolean>,
): void {
  event.stopPropagation();
  const { key, currentTarget, target } = event;
  if (target instanceof Element && target.closest(KEEPS_FOCUS) !== null) return;
  if (key === 'Escape' && !isImeKey(event.nativeEvent)) {
    event.preventDefault();
    keyboardRef.current = false;
    focusTextEditor(currentTarget);
    return;
  }
  const items = rowItems(currentTarget);
  const index = items.findIndex((item) => item === target);
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  let next: number | undefined;
  if (step !== 0 && index >= 0) next = (index + step + items.length) % items.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  items[next]?.focus();
}

/**
 * Keeps the keyboard in the edited text while the pointer works the popover: a press on a
 * control, or a menu or colour panel giving focus back to its button once a choice is made,
 * sends focus straight back to the text. An open popup or a field (a colour's hex) keeps focus
 * while it is used, and Alt+F10's keyboard keeps it everywhere until Escape.
 *
 * @param event - The focus moving into the popover.
 * @param keyboardRef - Whether the keyboard works the popover.
 */
function onEditingFocus(event: FocusEvent<HTMLDivElement>, keyboardRef: RefObject<boolean>): void {
  if (keyboardRef.current) return;
  const { target, currentTarget } = event;
  if (target instanceof Element && target.closest(KEEPS_FOCUS) !== null) return;
  focusTextEditor(currentTarget);
}

/** The editing row, rendered again only when what it shows changes. */
const StableEditingTextRow = memo(EditingTextRow, (previous, next) => isSameData(previous, next));

/**
 * The selection popover's editing form (the owner's feedback items 3 and 4): while a
 * text, a sticky's text or a shape's or connector's label is edited under the floating chrome
 * at 768 px wide and more, the popover stays beside the edited object with every text option
 * (`EditingTextRow`) in place of the classic text bar, and without Vote, Comment or More. Its
 * changes reach the selected range, so part of a text can be bold, italic, recoloured or
 * resized. A pointer leaves the keyboard in the text; Alt+F10 moves it into the popover and
 * Escape gives it back, editing going on. It marks itself as the text bar
 * (`TEXT_BAR_ATTRIBUTE`), so the editor lets it keep focus. Below 768 px the docked text bar
 * stays, and this shows nothing.
 *
 * @param props - The popover's props and the edited object.
 * @returns The popover, or nothing below 768 px wide.
 */
export function EditingPopover(
  props: SelectionPopoverProps & { readonly edited: EditedText },
): ReactElement | null {
  const { edited } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef(false);
  const isCompact = useIsMobileSite();
  const ids = useEditedIds(isCompact ? undefined : edited.id);
  usePopoverPlacement(sheetRef, props.engine, props.camera, ids, false);
  useEditingShortcut(sheetRef, !isCompact, keyboardRef);
  useEffect(() => {
    // The sheet takes data attributes only; the shortcut is announced on it as the text bar does.
    sheetRef.current?.setAttribute('aria-keyshortcuts', EDITING_POPOVER_SHORTCUT);
  });
  const object: BoardObject | undefined =
    props.selection.find((selected) => selected.id === edited.id) ??
    props.engine?.board.board.get(edited.id);
  // A click in the edited text (the caret moves, the style stays) leaves the row as it is.
  const controls = useStableControlsProps({
    engine: props.engine,
    selection: object === undefined ? [] : [object],
    textStyle: props.textStyle,
    onTextStyle: props.onTextStyle,
    dispatch: props.dispatch,
    mode: props.themeName ?? 'light',
  });
  if (isCompact) return null;
  return (
    <div className={styles.layer} data-selection-popover-layer="">
      <FloatingSheet
        ref={sheetRef}
        shape="toolbar"
        role="toolbar"
        label="Text"
        className={styles.popover}
        dataAttributes={{
          'data-selection-popover': '',
          'data-editing': '',
          'data-hidden': '',
          [TEXT_BAR_ATTRIBUTE]: '',
        }}
        onKeyDown={(event) => {
          onEditingKeyDown(event, keyboardRef);
        }}
      >
        <div
          className={rowStyles.row}
          onFocus={(event) => {
            onEditingFocus(event, keyboardRef);
          }}
          onBlur={(event) => {
            // The keyboard left the popover (Escape, Tab out, a press elsewhere): the next
            // pointer use sends focus back to the text again.
            if (!event.currentTarget.contains(event.relatedTarget)) keyboardRef.current = false;
          }}
        >
          <StableEditingTextRow controls={controls} edited={edited} />
        </div>
      </FloatingSheet>
    </div>
  );
}
