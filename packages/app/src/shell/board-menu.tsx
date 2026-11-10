import { useId, type ReactElement, type ReactNode } from 'react';

import { useCommentMode, type CommentMode } from '../comments/comment-context.js';
import { usePopup } from '../focus/use-popup.js';
import { Icon } from '../icons/icon.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ThemePreference } from '../theme/theme-preference.js';
import { THEME_LABELS } from '../theme/theme-tokens.js';
import type { ToolbarAction } from '../toolbar/toolbar-actions.js';

import { useShellDrawers } from './shell-board-mode.js';
import styles from './top-bars.module.css';

/** An entry the host adds to the board menu (the site's History). */
export interface BoardMenuEntry {
  /** Unique among the entries, kebab-case (`history`). */
  readonly id: string;
  /** The entry's name. */
  readonly label: string;
  /** Called when the person chooses it; the menu has closed. */
  readonly onSelect: () => void;
}

/** Props of {@link BoardMenu}. */
export interface BoardMenuProps {
  /** The host's entries, first; none if absent. */
  readonly entries?: readonly BoardMenuEntry[] | undefined;
  /** The view toggles (the toolbar's actions: grid, snapping). */
  readonly actions: readonly ToolbarAction[];
  /** The shell state, for whether each toggle is on. */
  readonly state: ShellState;
  /** The theme choice. */
  readonly themePreference: ThemePreference;
  /** Runs a toggle's action, or opens the shortcut sheet. */
  readonly dispatch: (action: ShellAction) => void;
  /** Called with the theme the person chooses. */
  readonly onThemeChange: (preference: ThemePreference) => void;
  /** The trigger's class, for a bar that draws it its own way (the floating bar's 28 px). */
  readonly triggerClassName?: string | undefined;
}

/** The theme choices in the order the menu offers them: Graphite, Vellum, System. */
const THEME_CHOICES: readonly (readonly [ThemePreference, string])[] = [
  ['dark', THEME_LABELS.dark],
  ['light', THEME_LABELS.light],
  ['system', 'System'],
];

/** Props of {@link MenuItem}. */
interface MenuItemProps {
  /** `menuitem`, or a checkable kind. */
  readonly role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  /** For a checkable item, whether it is checked. */
  readonly isChecked?: boolean | undefined;
  /** The chord shown after the name. */
  readonly hint?: string;
  /** Whether choosing it opens a dialog. */
  readonly hasDialogPopup?: boolean;
  /** Called when it is chosen. */
  readonly onChoose: () => void;
  /** The name. */
  readonly children: ReactNode;
}

/**
 * One item of the board menu: a button out of the tab order, which the arrows reach.
 *
 * @param props - Its role, checked state, hint and handler.
 * @returns The item.
 */
function MenuItem(props: MenuItemProps): ReactElement {
  return (
    <button
      type="button"
      role={props.role}
      tabIndex={-1}
      className={styles.menuItem}
      aria-checked={props.role === 'menuitem' ? undefined : props.isChecked === true}
      aria-haspopup={props.hasDialogPopup === true ? 'dialog' : undefined}
      data-popup-item=""
      onClick={props.onChoose}
    >
      <span className={styles.check} aria-hidden="true" />
      <span className={styles.menuLabel}>{props.children}</span>
      {props.hint === undefined ? null : <span className={styles.menuHint}>{props.hint}</span>}
    </button>
  );
}

/**
 * The board menu's theme entries: Graphite, Vellum and System as menu radio items, the one in
 * use checked.
 *
 * @param props - The theme in use and what choosing one does.
 * @param props.themePreference - The theme in use.
 * @param props.onChoose - Called with the theme chosen.
 * @returns The group.
 */
function ThemeChoices(props: {
  readonly themePreference: ThemePreference;
  readonly onChoose: (preference: ThemePreference) => void;
}): ReactElement {
  return (
    <div role="group" aria-label="Theme">
      {THEME_CHOICES.map(([preference, label]) => (
        <MenuItem
          key={preference}
          role="menuitemradio"
          isChecked={preference === props.themePreference}
          onChoose={() => {
            props.onChoose(preference);
          }}
        >
          {label}
        </MenuItem>
      ))}
    </div>
  );
}

/**
 * The board menu's toggle of the site's comment threads panel (the old toolbar's
 * Comments button), checked while the panel is open.
 *
 * @param props - The site's comment mode and how the menu runs a choice.
 * @param props.comments - The comment mode.
 * @param props.choose - Wraps a choice so the menu closes first.
 * @returns The item.
 */
function CommentsItem(props: {
  readonly comments: CommentMode;
  readonly choose: (run: () => void) => () => void;
}): ReactElement {
  const { comments } = props;
  return (
    <MenuItem
      role="menuitemcheckbox"
      isChecked={comments.isPanelOpen}
      onChoose={props.choose(() => {
        comments.togglePanel();
      })}
    >
      Comments
    </MenuItem>
  );
}

/**
 * The board menu's comment entry: with the right-hand drawer, the threads panel's toggle; without
 * it (a floating whiteboard), where comments stay pins and cards, the toggle of
 * resolved pins instead; none on a board without site comments, or where the mode
 * cannot show resolved pins.
 *
 * @returns The entry and the comment mode, or undefined.
 */
function useCommentMenuEntry():
  { readonly kind: 'panel' | 'resolved'; readonly mode: CommentMode } | undefined {
  const mode = useCommentMode();
  const { hasInspector } = useShellDrawers();
  if (mode === undefined) return undefined;
  if (hasInspector) return { kind: 'panel', mode };
  return mode.toggleResolvedShown === undefined ? undefined : { kind: 'resolved', mode };
}

/**
 * The board menu's toggle of resolved threads' pins under the floating whiteboard chrome,
 * where there is no threads panel and resolved pins hide unless shown; checked while
 * they show.
 *
 * @param props - The site's comment mode and how the menu runs a choice.
 * @param props.comments - The comment mode.
 * @param props.choose - Wraps a choice so the menu closes first.
 * @returns The item.
 */
function ResolvedCommentsItem(props: {
  readonly comments: CommentMode;
  readonly choose: (run: () => void) => () => void;
}): ReactElement {
  const { toggleResolvedShown = () => undefined } = props.comments;
  return (
    <MenuItem
      role="menuitemcheckbox"
      isChecked={props.comments.isResolvedShown === true}
      onChoose={props.choose(toggleResolvedShown)}
    >
      Show resolved comments
    </MenuItem>
  );
}

/**
 * The board menu of the board-name bar (item 8): the "⋯" button and the menu it
 * opens: the host's entries (the site's History), the site's Comments panel (checked while
 * open) or, under the floating whiteboard chrome, "Show resolved comments",
 * the view toggles (grid, snapping, checked while on), the shortcut sheet, and the theme as three choices (Graphite, Vellum, System), the
 * one in use checked. A WAI-ARIA menu button (`usePopup`): choosing an entry closes the menu.
 *
 * @param props - The entries, the toggles, the state, the theme and the handlers.
 * @returns The button and, when open, the menu.
 */
export function BoardMenu(props: BoardMenuProps): ReactElement {
  const { entries = [], actions, state, themePreference, dispatch, onThemeChange } = props;
  const popup = usePopup();
  const menuId = useId();
  const commentEntry = useCommentMenuEntry();
  const hasHostEntries = entries.length > 0 || commentEntry !== undefined;
  const choose = (run: () => void) => () => {
    popup.close();
    run();
  };
  return (
    <div className={styles.anchor}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={props.triggerClassName ?? styles.edgeButton}
        aria-label="Board menu"
        aria-haspopup="menu"
        aria-expanded={popup.isOpen}
        aria-controls={popup.isOpen ? menuId : undefined}
        onClick={popup.toggle}
        onKeyDown={popup.onTriggerKeyDown}
      >
        <Icon name="more" />
      </button>
      {popup.isOpen ? (
        <div
          ref={popup.popupRef}
          id={menuId}
          role="menu"
          aria-label="Board menu"
          className={styles.menu}
          onKeyDown={popup.onPopupKeyDown}
        >
          {entries.map((entry) => (
            <MenuItem key={entry.id} role="menuitem" onChoose={choose(entry.onSelect)}>
              {entry.label}
            </MenuItem>
          ))}
          {commentEntry?.kind === 'panel' ? (
            <CommentsItem comments={commentEntry.mode} choose={choose} />
          ) : (
            commentEntry && <ResolvedCommentsItem comments={commentEntry.mode} choose={choose} />
          )}
          {hasHostEntries ? <div role="separator" className={styles.separator} /> : null}
          {actions.map((entry) => (
            <MenuItem
              key={entry.id}
              role={entry.isPressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
              isChecked={entry.isPressed?.(state)}
              onChoose={choose(() => {
                dispatch(entry.action);
              })}
            >
              {entry.label}
            </MenuItem>
          ))}
          <MenuItem
            role="menuitem"
            hint="?"
            hasDialogPopup
            onChoose={choose(() => {
              dispatch({ type: 'toggleCheatSheet' });
            })}
          >
            Keyboard shortcuts
          </MenuItem>
          <div role="separator" className={styles.separator} />
          <ThemeChoices
            themePreference={themePreference}
            onChoose={(preference) => {
              popup.close();
              onThemeChange(preference);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
