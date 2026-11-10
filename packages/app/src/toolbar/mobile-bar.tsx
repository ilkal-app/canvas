import { memo, useRef, type ReactElement } from 'react';

import type { BoardMode } from '@canvas/schema';

import { useCommentMode } from '../comments/comment-context.js';
import { CommentTool } from '../comments/comment-toolbar.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import { dockButtonAction, DOCK_BUTTONS, type DockButtonId } from '../state/dock-buttons.js';
import { isDockGroup } from '../state/dock-layout.js';
import { mobileBarEntriesFor, type MobileBarEntry } from '../state/mobile-bar-layout.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import { TOOL_AVAILABILITY } from '../state/tool-availability.js';

import { actionHint } from './action-hints.js';
import { BOTTOM_CHROME_ATTRIBUTE } from './bottom-chrome.js';
import { DockButton } from './dock-button.js';
import { DockGroupButton } from './dock-group.js';
import { dockRoleOf } from './dock.js';
import styles from './dock.module.css';
import { useRovingFocus } from './use-roving-focus.js';

/** Props of {@link MobileBar}. */
export interface MobileBarProps {
  /** The shell's shortcuts, for each button's hint. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell state: the active tool, the tools that can be chosen, each group's tool. */
  readonly state: ShellState;
  /** The board's mode, whose tools the bar offers. */
  readonly mode: BoardMode;
  /** Called with the mode chosen in the mode button's flyout. */
  readonly onModeChange: (mode: BoardMode) => void;
  /** Receives the bar's actions: tool selection. */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * Why editing is refused for now ('s L1 at mobile width: "Editing starts when the board
   * is live"): the bar is then dimmed and out of reach, and the reason shows over it. Nothing if
   * absent.
   */
  readonly refusal?: string | undefined;
}

/**
 * One plain button of the bar: a tool's, pressed while its tool is active, or the comment
 * button.
 *
 * @param props - The button, the shortcuts, the state and where a choice goes.
 * @param props.id - The button.
 * @param props.registry - The shortcuts.
 * @param props.state - The shell state.
 * @param props.onChoose - Dispatches the button's action.
 * @returns The button.
 */
function MobileToolButton(props: {
  readonly id: DockButtonId;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly state: ShellState;
  readonly onChoose: (action: ShellAction) => void;
}): ReactElement | null {
  const { id, registry, state, onChoose } = props;
  const isAvailable = TOOL_AVAILABILITY[id].isAvailable;
  if (id === 'comment') return <CommentTool isAvailable={isAvailable} isCompact />;
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
      isCompact
      onSelect={() => {
        if (action === undefined) return;
        onChoose(isPressed && tool === 'select' ? { type: 'reselectTool', tool } : action);
      }}
    />
  );
}

/**
 * One entry of the bar.
 *
 * @param props - The entry and the bar's props.
 * @param props.entry - The entry.
 * @param props.bar - The bar's props.
 * @param props.onChoose - Dispatches a tool's action.
 * @returns The entry's button.
 */
function MobileBarItem(props: {
  readonly entry: MobileBarEntry;
  readonly bar: MobileBarProps;
  readonly onChoose: (action: ShellAction) => void;
}): ReactElement | null {
  const { entry, bar, onChoose } = props;
  if (isDockGroup(entry)) {
    return (
      <DockGroupButton
        group={entry}
        registry={bar.registry}
        state={bar.state}
        onChoose={onChoose}
        isCompact
      />
    );
  }
  return (
    <MobileToolButton id={entry} registry={bar.registry} state={bar.state} onChoose={onChoose} />
  );
}

/**
 * The compact bottom bar (the design's mobile frames), the dock's form below 768 px wide: a 374 px
 * sheet (narrower only on a narrower screen) over the canvas's bottom edge, its buttons 48 px
 * touch targets spread edge to edge: the mode button, whose flyout switches the board's mode,
 * then the mode's tools (`MOBILE_BAR_LAYOUTS`; Whiteboard's select, note, shapes▾, lines▾, pen
 * and comment), each with the shared 20 px icon at a 1.5 px stroke. Flyouts open above the bar
 * as the dock's do. A person who cannot edit gets the select tool and the hand, and no mode
 * button. While editing is refused (`refusal`) the bar is dimmed, its buttons inert (a press
 * lands on the bar, not the canvas beneath), and it says why. One
 * tab stop with roving focus, as the dock.
 *
 * @param props - The shortcuts, state, mode, handlers and any refusal.
 * @returns The bar.
 */
function MobileBarView(props: MobileBarProps): ReactElement {
  const { state, mode, dispatch, refusal } = props;
  const commentMode = useCommentMode();
  const barRef = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(barRef);
  const canComment = commentMode?.canWrite === true;
  const entries = mobileBarEntriesFor(mode, dockRoleOf(state, canComment)).filter(
    (entry) => canComment || entry !== 'comment',
  );
  const choose = (action: ShellAction): void => {
    commentMode?.setPlacing(false);
    dispatch(action);
  };
  return (
    <>
      {refusal === undefined ? null : (
        <div role="status" className={styles.refusal}>
          {refusal}
        </div>
      )}
      <div
        ref={barRef}
        role="toolbar"
        aria-label="Tools"
        aria-orientation="horizontal"
        className={styles.compactBar}
        data-dimmed={refusal === undefined ? undefined : ''}
        aria-disabled={refusal === undefined ? undefined : true}
        {...{ [BOTTOM_CHROME_ATTRIBUTE]: '' }}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {/* Refused, the buttons are inert and a press lands on the bar itself, never the canvas. */}
        <div className={styles.contents} inert={refusal !== undefined}>
          {entries.map((entry) => (
            <MobileBarItem key={entry} entry={entry} bar={props} onChoose={choose} />
          ))}
        </div>
      </div>
    </>
  );
}

/** The compact bottom bar ({@link MobileBarView}); the shell passes stable handlers. */
export const MobileBar = memo(MobileBarView);
