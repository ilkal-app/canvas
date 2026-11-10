import { useContext, useEffect, useRef, useState, type ReactElement } from 'react';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { retryLinkCard } from '../clipboard/link-paste-handler.js';
import { useCommentMode } from '../comments/comment-context.js';
import { commentDataContext } from '../comments/comment-data-context.js';
import { AnchoredPopoverAvoidContext } from '../controls/anchored-popover.js';
import { FloatingSheet } from '../controls/floating-sheet.js';
import { Menu } from '../controls/menu.js';
import type { ScreenRect } from '../controls/placement.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { TextStyleChange, TextStyleContext } from '../engine/text-style-types.js';
import type { BoardExporter } from '../export/run-export.js';
import { Icon } from '../icons/icon.js';
import { copyObjectLink } from '../links/object-link.js';
import { exportOf } from '../shell/floating-board-menu-button.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import { shellBoardModeContext } from '../shell/shell-board-mode.js';
import { useWhiteboardChrome } from '../shell/whiteboard-chrome.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ThemeName } from '../theme/theme-tokens.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';

import { CommentButton } from './comment-button.js';
import { EditingPopover } from './editing-text-row.js';
import { LinkCardOpenControls, singleLinkCardOf } from './link-card-controls.js';
import { selectionMoreEntries, type SelectionMoreExtras } from './more-menu.js';
import type { StickyAuthorsToggle } from './popover-controls.js';
import { measureWindowReservedZones } from './reserved-zones.js';
import styles from './selection-popover.module.css';
import { isSeveralSelection } from './several-values.js';
import { StableStyleControls, useStableControlsProps } from './stable-style-controls.js';
import { usePopoverKeys } from './use-popover-keys.js';
import { usePopoverPlacement } from './use-popover-placement.js';
import { VoteButton } from './vote-button.js';

/** Props of {@link SelectionPopover}. */
export interface SelectionPopoverProps {
  /** The engine, once it runs. */
  readonly engine: MountedEngine | undefined;
  /** The camera's source. */
  readonly camera: CameraSource;
  /** The selected objects, primary first. */
  readonly selection: readonly BoardObject[];
  /**
   * Whether the person may edit the board. A commenter (who may comment but not edit) gets the
   * popover with Comment alone; a viewer gets none.
   */
  readonly canEdit: boolean;
  /** Whether a text or a sticky's text is being edited: the text bar has the selection then. */
  readonly isEditingText: boolean;
  /**
   * How many times mod+/ asked for focus in the popover (`ShellState.popoverFocusRequests`,
   *); a change while it shows moves focus to its first item. None if absent.
   */
  readonly focusRequests?: number | undefined;
  /** The shell's shortcuts, for the more menu's. */
  readonly shortcuts: ShortcutRegistry<ShellAction>;
  /** Runs a shell action. */
  readonly dispatch: (action: ShellAction) => void;
  /** The theme, which a comment's pin picks colour tokens in; light if absent. */
  readonly themeName?: ThemeName | undefined;
  /** The engine's view of the selected text, for the style controls. */
  readonly textStyle?: TextStyleContext | undefined;
  /** Applies a text style change (font, size, text colour, alignment): one undo step. */
  readonly onTextStyle?: ((change: TextStyleChange) => void) | undefined;
  /** Starts editing a connector's label; the selection's `activate` when absent. */
  readonly onEditLabel?: ((id: ObjectId) => void) | undefined;
  /** Starts the board timer for a section, from the section's row. */
  readonly onSectionTimer?: ((sectionId: ObjectId) => void) | undefined;
  /** Asks for a picture to replace an image's, from the image row. */
  readonly onReplaceImage?: ((id: ObjectId) => void) | undefined;
  /** The sticky row's Author toggle over the board's setting; absent, not built yet. */
  readonly stickyAuthors?: StickyAuthorsToggle | undefined;
  /** What the more menu's Export exports the selection with; no Export if absent. */
  readonly exporter?: BoardExporter | undefined;
  /** Shows the shell's notice: the more menu's Copy link says it copied; no Copy link if absent. */
  readonly onNotice?: ((message: string) => void) | undefined;
}

/**
 * The more menu's Export and Copy link to object, where the shell offers them: Copy
 * link copies a link to the primary selected object.
 *
 * @param props - The popover's props.
 * @returns The extras.
 */
function moreExtrasOf(props: SelectionPopoverProps): SelectionMoreExtras {
  const { onNotice } = props;
  const [primary] = props.selection;
  return {
    export: exportOf(props.exporter),
    onCopyLink:
      onNotice === undefined || primary === undefined
        ? undefined
        : () => {
            void copyObjectLink(primary.id, onNotice);
          },
  };
}

/**
 * The more (⋯) button and its menu.
 *
 * @param props - The popover's props.
 * @returns The button and, while open, the menu.
 */
function MoreButton(props: SelectionPopoverProps): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const [reserved, setReserved] = useState<readonly ScreenRect[]>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          // Measured as it opens, so it opens clear of the dock.
          setReserved(measureWindowReservedZones(buttonRef.current));
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <Icon name="more" />
      </button>
      <Menu
        label="More"
        entries={selectionMoreEntries(
          props.selection,
          props.shortcuts,
          props.dispatch,
          moreExtrasOf(props),
        )}
        anchor={buttonRef}
        isOpen={isOpen}
        side="bottom"
        align="end"
        // The design's frame A: a popover's menu opens 12 px from its button, 6 px clear of the
        // popover's edge.
        gap={12}
        reserved={reserved}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * The selection's properties popover (the design's frame A): a one-row floating sheet
 * beside the selection, where the whiteboard's floating chrome has it instead of the inspector
 * drawer. Placed by `placeSelectionPopover` (the side that covers less of the board, on a tie the
 * one nearer the screen's centre, never over the reserved chrome) without a render per camera
 * frame; hidden while the camera moves or a press on the canvas lasts; not shown to a viewer,
 * while text is edited (the text bar takes the selection) or while a comment thread or a new
 * comment is open (the owner's rule: never both, so opening one clears the selection). While a
 * text is edited under the floating chrome it takes its editing form instead (`EditingPopover`,
 *): every text option for the edited text, applied to the selected range. Its row
 * holds Vote (on a sticky while a dot vote is open), Comment (where comments run) and
 * the more (⋯) menu; a commenter gets Comment alone.
 * Tab from the canvas (or mod+/) moves focus into it and Escape takes focus back,
 * keeping the selection.
 * A sticky's and a text's style controls come first; other types' come with
 * to.
 *
 * @param props - The engine, camera, selection, role, editing state, shortcuts and dispatch.
 * @returns The popover's layer, or nothing while it is not shown.
 */
export function SelectionPopover(props: SelectionPopoverProps): ReactElement | null {
  // While a text is edited, its editing form takes the popover's place.
  const edited = props.textStyle?.isEditing === true ? props.textStyle.edited : undefined;
  if (props.canEdit && edited !== undefined) return <EditingPopover {...props} edited={edited} />;
  return <SelectionSheet {...props} />;
}

/**
 * A failed link card's Retry through a mounted engine's paste target, which reaches
 * the assets service.
 *
 * @param engine - The engine, once it runs.
 * @returns The retry, or undefined before the engine runs.
 */
function retryThrough(
  engine: MountedEngine | undefined,
): ((id: ObjectId, url: string) => void) | undefined {
  if (engine === undefined) return undefined;
  return (id, url) => {
    retryLinkCard(engine.pasteTarget(), id, url);
  };
}

/**
 * The popover's selection form: the row for the selection, Vote, Comment and More.
 *
 * @param props - The popover's props.
 * @returns The popover's layer, or nothing while it is not shown.
 */
function SelectionSheet(props: SelectionPopoverProps): ReactElement | null {
  const sheetRef = useRef<HTMLDivElement>(null);
  const comments = useContext(commentDataContext);
  const canComment = useCommentMode()?.canWrite === true;
  const isThreadOpen = comments?.selectedId !== undefined || comments?.placement !== undefined;
  useThreadClearsSelection(props.engine, isThreadOpen);
  // Anyone who sees a link card may open its page.
  const card = singleLinkCardOf(props.selection);
  const isShown =
    (props.canEdit || canComment || card !== undefined) &&
    props.selection.length > 0 &&
    !props.isEditingText &&
    !isThreadOpen;
  const ids = useSelectedIds(props.selection, isShown);
  // Below 768 px wide a bottom sheet over the compact bar, placed by its stylesheet.
  const isSheet = useIsMobileSite();
  const selectionOnPage = usePopoverPlacement(sheetRef, props.engine, props.camera, ids, isSheet);
  const onKeyDown = usePopoverKeys(sheetRef, isShown, props.focusRequests);
  // A click that changes nothing (on the selected object) leaves the controls as they are.
  const controls = useStableControlsProps({
    engine: props.engine,
    selection: props.selection,
    textStyle: props.textStyle,
    onTextStyle: props.onTextStyle,
    dispatch: props.dispatch,
    mode: props.themeName ?? 'light',
    onEditLabel: props.onEditLabel,
    onSectionTimer: props.onSectionTimer,
    onReplaceImage: props.onReplaceImage,
    // A failed link card's Retry fetches through the engine's paste target.
    onRetryLink: retryThrough(props.engine),
    stickyAuthors: props.stickyAuthors,
  });
  if (!isShown) return null;
  const isSeveral = isSeveralSelection(props.selection);
  return (
    <div className={styles.layer} data-selection-popover-layer="">
      <FloatingSheet
        ref={sheetRef}
        shape="toolbar"
        role="toolbar"
        label="Selection"
        className={styles.popover}
        dataAttributes={{
          'data-selection-popover': '',
          'data-hidden': '',
          ...(isSheet ? { 'data-sheet': '', [BOTTOM_CHROME_ATTRIBUTE]: '' } : {}),
        }}
        onKeyDown={onKeyDown}
      >
        {/* Its menus and dropdowns never cover the selection (round 2). */}
        <AnchoredPopoverAvoidContext.Provider value={selectionOnPage}>
          {props.canEdit ? <StableStyleControls {...controls} /> : null}
          {!props.canEdit && card !== undefined ? <LinkCardOpenControls card={card} /> : null}
          {/* The several-objects card has no Vote or Comment: a vote is for one sticky
            and a comment pins to one object. */}
          {isSeveral ? null : <VoteButton selection={props.selection} />}
          {props.canEdit && isSeveral ? null : (
            <CommentButton
              engine={props.engine}
              selection={props.selection}
              themeName={props.themeName ?? 'light'}
            />
          )}
          {props.canEdit ? <MoreButton {...props} /> : null}
        </AnchoredPopoverAvoidContext.Provider>
      </FloatingSheet>
    </div>
  );
}

/**
 * Clears the selection when a comment thread or a new comment opens (the owner's rule:
 * the popover and a thread are never open together).
 *
 * @param engine - The engine, once it runs.
 * @param isThreadOpen - Whether a thread or a new comment is open.
 */
function useThreadClearsSelection(engine: MountedEngine | undefined, isThreadOpen: boolean): void {
  useEffect(() => {
    if (!isThreadOpen || engine === undefined) return;
    if (engine.board.state().selectedIds.length > 0) engine.board.select([]);
  }, [engine, isThreadOpen]);
}

/** No ids: the popover is not shown. */
const NO_IDS: readonly ObjectId[] = [];

/**
 * The selected ids the popover follows: the same array while the selection's ids are the same,
 * so the placement does not start over on each render; none while it is not shown.
 *
 * @param selection - The selected objects.
 * @param isShown - Whether the popover shows.
 * @returns The ids.
 */
function useSelectedIds(selection: readonly BoardObject[], isShown: boolean): readonly ObjectId[] {
  const last = useRef<readonly ObjectId[]>(NO_IDS);
  const ids = isShown ? selection.map((object) => object.id) : NO_IDS;
  const isSame =
    ids.length === last.current.length && ids.every((id, index) => id === last.current[index]);
  if (!isSame) last.current = ids;
  return last.current;
}

/**
 * The selection popover where it belongs: on a whiteboard under the floating chrome
 * only, the inspector's place there; nothing elsewhere, so the classic shell is unchanged.
 *
 * @param props - The popover's props.
 * @returns The popover, or nothing.
 */
export function WhiteboardSelectionPopover(props: SelectionPopoverProps): ReactElement | null {
  const chrome = useWhiteboardChrome();
  const mode = useContext(shellBoardModeContext)?.mode;
  if (chrome !== 'floating' || mode !== 'whiteboard') return null;
  return <SelectionPopover {...props} />;
}
