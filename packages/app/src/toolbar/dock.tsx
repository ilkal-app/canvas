import { Fragment, memo, useRef, type ReactElement } from 'react';

import type { BoardMode } from '@canvas/schema';

import { useCommentMode } from '../comments/comment-context.js';
import { CommentTool } from '../comments/comment-toolbar.js';
import { useToastDock } from '../feedback/toast-region.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import { dockButtonAction, DOCK_BUTTONS, type DockButtonId } from '../state/dock-buttons.js';
import {
  dockEntriesFor,
  isDockGroup,
  type DockEntry,
  type DockRole,
} from '../state/dock-layout.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import { TOOL_AVAILABILITY } from '../state/tool-availability.js';

import { actionHint } from './action-hints.js';
import { DockButton } from './dock-button.js';
import { DockGroupButton } from './dock-group.js';
import { useDockPlacement } from './dock-placement.js';
import styles from './dock.module.css';
import { useRovingFocus } from './use-roving-focus.js';

/** Props of {@link Dock}. */
export interface DockProps {
  /** The shell's shortcuts, for each button's hint. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /**
   * The shell state: the active tool, the tools that can be chosen, each group's tool, the tool
   * styles and whether the person can edit. The dock renders again only when one of those
   * changes (`isSameDock`), not on every canvas action.
   */
  readonly state: ShellState;
  /** The board's mode, whose tools the dock offers. */
  readonly mode: BoardMode;
  /** Called with the mode chosen in the switcher. */
  readonly onModeChange: (mode: BoardMode) => void;
  /** Receives the dock's actions: tool selection. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * Whose dock it is: an editor's when the person can edit; a commenter's when they cannot but may
 * write comments (the site's comment mode says so); else a viewer's.
 *
 * @param state - The shell state.
 * @param canComment - Whether the site's comment mode lets the person write comments.
 * @returns The role.
 */
export function dockRoleOf(state: Pick<ShellState, 'canEdit'>, canComment: boolean): DockRole {
  if (state.canEdit) return 'editor';
  return canComment ? 'commenter' : 'viewer';
}

/**
 * Whether two sets of props show the same dock: the same registry, mode and handlers, and in the
 * shell state the same active tool, editing right, available tools, group tools and tool styles.
 * Every other slice (the latest canvas action, dialogs, view preferences) leaves the dock as it
 * is.
 *
 * @param previous - The props of the last render.
 * @param next - The new props.
 * @returns True when the dock would render the same.
 */
function isSameDock(previous: DockProps, next: DockProps): boolean {
  const before = previous.state;
  const after = next.state;
  return (
    previous.registry === next.registry &&
    previous.mode === next.mode &&
    previous.onModeChange === next.onModeChange &&
    previous.dispatch === next.dispatch &&
    before.activeTool === after.activeTool &&
    before.canEdit === after.canEdit &&
    before.availableTools === after.availableTools &&
    before.dockGroupTools === after.dockGroupTools &&
    before.toolStyles === after.toolStyles
  );
}

/**
 * Where the dock draws a divider: after the hand, and before the comment button.
 *
 * @param entry - The entry.
 * @param index - Its place.
 * @param entries - The dock's entries.
 * @returns True when a divider goes before it.
 */
function hasDividerBefore(entry: DockEntry, index: number, entries: readonly DockEntry[]): boolean {
  return index > 0 && (entries[index - 1] === 'hand' || entry === 'comment');
}

/**
 * The dock's rendering, given its props.
 *
 * @param props - The registry, the state, the mode and the handlers.
 * @returns The dock.
 */
function DockView(props: DockProps): ReactElement {
  const { registry, state, mode, dispatch } = props;
  const commentMode = useCommentMode();
  const dockRef = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(dockRef);
  const placement = useDockPlacement(dockRef);
  // The toast region stacks above it (item 4), from where it is.
  useToastDock(dockRef);
  // The comment button shows only on the site, to a member who may write (`CommentTool`).
  const canComment = commentMode?.canWrite === true;
  const role = dockRoleOf(state, canComment);
  const entries = dockEntriesFor(mode, role).filter((entry) => canComment || entry !== 'comment');
  const choose = (action: ShellAction): void => {
    commentMode?.setPlacing(false);
    dispatch(action);
  };
  return (
    <div
      ref={dockRef}
      role="toolbar"
      aria-label="Tools"
      aria-orientation="horizontal"
      className={styles.dock}
      data-placement={placement.kind}
      // Just right of the zoom control, measured (`useDockPlacement`): not a length a sheet knows.
      style={
        placement.kind === 'beside' ? { left: placement.leftPx, transform: 'none' } : undefined
      }
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
    >
      {entries.map((entry, index) => (
        <Fragment key={entry}>
          {hasDividerBefore(entry, index, entries) && (
            <span className={styles.divider} aria-hidden="true" />
          )}
          {isDockGroup(entry) ? (
            <DockGroupButton group={entry} registry={registry} state={state} onChoose={choose} />
          ) : (
            <DockToolButton id={entry} registry={registry} state={state} onChoose={choose} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One plain dock button: the comment button (the site's placement), or a tool's, pressed while
 * its tool is active; the select button pressed again reselects (it leaves vector editing).
 *
 * @param props - The button, the shortcuts, the state and where a choice goes.
 * @param props.id - The button.
 * @param props.registry - The shortcuts.
 * @param props.state - The shell state.
 * @param props.onChoose - Dispatches the button's action.
 * @returns The button.
 */
function DockToolButton(props: {
  readonly id: DockButtonId;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly state: ShellState;
  readonly onChoose: (action: ShellAction) => void;
}): ReactElement | null {
  const { id, registry, state, onChoose } = props;
  const isAvailable = TOOL_AVAILABILITY[id].isAvailable;
  if (id === 'comment') return <CommentTool isAvailable={isAvailable} />;
  const { label, tool } = DOCK_BUTTONS[id];
  const action = dockButtonAction(id);
  const isPressed = tool !== undefined && tool === state.activeTool;
  return (
    <DockButton
      label={label}
      icon={id}
      hint={actionHint(registry, action)}
      isPressed={isPressed}
      isAvailable={isAvailable && (tool === undefined || state.availableTools.includes(tool))}
      onSelect={() => {
        if (action === undefined) return;
        // The pressed Select button again leaves a mode shown as the select tool (vector edit).
        onChoose(isPressed && tool === 'select' ? { type: 'reselectTool', tool } : action);
      }}
    />
  );
}

/**
 * The shell's bottom dock (Figma "Dock · modes & flyouts"): a toolbar floating over the
 * canvas's bottom centre, the board mode's tools in the order of `DOCK_LAYOUTS`, the shapes and
 * lines flyouts among them, the comment button after them on the site; no mode switcher since the
 * cutover (D2: a board's mode is set when it is created). A tool not built
 * yet shows disabled and does nothing. A person who cannot edit gets only the select tool and the
 * hand, and a commenter the comment button too (`dockEntriesFor`). The toolbar has one tab stop and
 * roving focus: ArrowLeft and ArrowRight (Home, End) move between its buttons, Enter and Space
 * choose, Enter or ArrowUp opens a flyout. It renders again only when a slice of the shell state it
 * shows, or a prop, changes (`isSameDock`); the shell passes stable handlers.
 */
export const Dock = memo(DockView, isSameDock);
