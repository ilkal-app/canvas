import { Fragment, memo, useEffect, useRef, type ReactElement } from 'react';

import { useCommentMode } from '../comments/comment-context.js';
import { useToastDock } from '../feedback/toast-region.js';
import { useMediaQuery } from '../hooks/use-media-query.js';
import type { IconName } from '../icons/icon-paths.js';
import { useBoardReactions, type BoardReactions } from '../reactions/reactions-context.js';
import { ReactionsFlyout } from '../reactions/reactions-flyout.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { DockRole } from '../state/dock-layout.js';
import { floatingDockKeyAction, floatingDockToolAction } from '../state/floating-dock-actions.js';
import {
  FLOATING_DOCK_TOOLS,
  floatingDockSectionsFor,
  floatingDockToolOfMode,
  floatingToolAvailability,
  type FloatingDockSection,
  type FloatingDockToolId,
} from '../state/floating-dock.js';
import {
  FLOATING_MOBILE_BAR_WIDTHS,
  floatingMobileBarOf,
  floatingMobileBarSlotsFor,
} from '../state/floating-mobile-bar.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ToolPanelId } from '../state/tool-panel-state.js';

import { actionHint } from './action-hints.js';
import { BOTTOM_CHROME_ATTRIBUTE } from './bottom-chrome.js';
import { DockButton } from './dock-button.js';
import { dockRoleOf } from './dock.js';
import styles from './floating-dock.module.css';
import { FloatingMoreTools } from './floating-more-tools.js';
import { OpenToolPanel } from './floating-tool-panel.js';
import { TOOL_PANELS, type AnyToolPanel } from './tool-panels/tool-panel-contribution.js';
import { POPOVER_AVOID } from './tool-panels/tool-panel-host.js';
import { useToolPanel } from './use-dock-tool-panel.js';
import { usePanelKeyboardFocus } from './use-panel-keyboard-focus.js';
import { useRovingFocus } from './use-roving-focus.js';

/** Each floating dock tool's icon ('s whiteboard icons; Draw is the pencil). */
export const FLOATING_DOCK_ICONS: Readonly<Record<FloatingDockToolId, IconName>> = {
  select: 'select',
  pan: 'hand',
  section: 'section',
  shapes: 'shapes',
  image: 'image',
  text: 'text',
  connector: 'connector',
  draw: 'pencil',
  sticky: 'note',
  comment: 'comment',
  reactions: 'reactions',
};

/** Props of {@link FloatingDock}. */
export interface FloatingDockProps {
  /** The shell's shortcuts, for each button's hint (`FLOATING_SHORTCUTS` under this dock). */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell state: the active tool, the tools that can be chosen, whether the person can edit. */
  readonly state: ShellState;
  /** Receives the tools' actions (`floatingDockToolAction`). */
  readonly dispatch: (action: ShellAction) => void;
  /** The tool panels by tool; the registered ones (`TOOL_PANELS`) if absent. */
  readonly panels?: ReadonlyMap<ToolPanelId, AnyToolPanel> | undefined;
}

/**
 * Whether two sets of props show the same dock: the same registry and dispatch, and the same
 * active tool, tool panel key, editing right and available tools (not on every canvas
 * action).
 *
 * @param previous - The props of the last render.
 * @param next - The new props.
 * @returns True when the dock would render the same.
 */
function isSameFloatingDock(previous: FloatingDockProps, next: FloatingDockProps): boolean {
  return (
    previous.registry === next.registry &&
    previous.dispatch === next.dispatch &&
    previous.panels === next.panels &&
    previous.state.activeTool === next.state.activeTool &&
    previous.state.lastToolPanelKey === next.state.lastToolPanelKey &&
    previous.state.canEdit === next.state.canEdit &&
    previous.state.availableTools === next.state.availableTools &&
    previous.state.toolPanelRequest === next.state.toolPanelRequest
  );
}

/**
 * The dock tool shown pressed: Comment while placing a comment, Reactions while its flyout is
 * open, a panel tool without a mode while its panel is open, else the active
 * mode's tool.
 *
 * @param state - The shell state.
 * @param modeless - The open panel's tool without a mode, if any.
 * @param flows - Whether a comment is being placed and whether the reactions flyout is open.
 * @param flows.isPlacingComment - A comment is being placed.
 * @param flows.isReacting - The reactions flyout is open.
 * @returns The tool, or `undefined` for a mode with none.
 */
function pressedToolOf(
  state: ShellState,
  modeless: FloatingDockToolId | undefined,
  flows: { readonly isPlacingComment: boolean; readonly isReacting: boolean },
): FloatingDockToolId | undefined {
  if (flows.isPlacingComment) return 'comment';
  if (flows.isReacting) return 'reactions';
  return modeless ?? floatingDockToolOfMode(state.activeTool);
}

/**
 * How many 48 px targets the compact bar holds on this viewport now, following it as it
 * changes (`floatingMobileBarSlotsFor`).
 *
 * @returns The targets, More included.
 */
function useFloatingMobileBarSlots(): number {
  const { seven, six } = FLOATING_MOBILE_BAR_WIDTHS;
  const isUnderSeven = useMediaQuery(`(width < ${String(seven)}px)`);
  const isUnderSix = useMediaQuery(`(width < ${String(six)}px)`);
  return floatingMobileBarSlotsFor(isUnderSix ? 0 : isUnderSeven ? six : seven);
}

/**
 * Escape anywhere closes the open Reactions flyout, as it closes a tool panel (on a
 * phone, focus is back on More tools once Reactions is chosen), before the canvas hears it, so
 * the selection stays; not while a menu or a dialog has the key.
 *
 * @param reactions - The board's reactions, if any.
 */
function useEscapeClosesReactions(reactions: BoardReactions | undefined): void {
  const isOpen = reactions?.isOpen === true;
  const close = reactions?.close;
  useEffect(() => {
    if (!isOpen || close === undefined) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="menu"], [role="dialog"]') != null) return;
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, close]);
}

/**
 * The floating dock's rendering.
 *
 * @param props - The registry, the state and the dispatch.
 * @returns The dock.
 */
function FloatingDockView(props: FloatingDockProps): ReactElement {
  const { registry, state, dispatch } = props;
  const comments = useCommentMode();
  const dockRef = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(dockRef);
  const keys = usePanelKeyboardFocus(dockRef, roving.onKeyDown);
  useToastDock(dockRef);
  const role = dockRoleOf(state, comments?.canWrite === true);
  const panel = useToolPanel(state, dispatch, props.panels ?? TOOL_PANELS, registry);
  const reactions = useBoardReactions();
  useEscapeClosesReactions(reactions);
  const pressed = pressedToolOf(state, panel.modeless, {
    isPlacingComment: comments?.isPlacing === true,
    isReacting: reactions?.isOpen === true,
  });
  const isCompact = useIsMobileSite();
  const canComment = comments?.canWrite === true;
  const slots = useFloatingMobileBarSlots();
  const bar = isCompact ? floatingMobileBarOf(role, slots) : undefined;
  const sections = shownSections(bar?.sections ?? floatingDockSectionsFor(role), canComment);
  const isAvailable = (tool: FloatingDockToolId): boolean =>
    floatingToolAvailability(tool, role).isAvailable && isModeAvailable(tool, state);
  const choose = (tool: FloatingDockToolId, action: ShellAction): void => {
    keys.chosen(tool);
    panel.chooseFromButton(tool);
    // The pressed Select again leaves a mode shown as the select tool (vector edit).
    dispatch(
      pressed === 'select' && tool === 'select' ? { type: 'reselectTool', tool: 'select' } : action,
    );
  };
  return (
    <>
      <div
        ref={dockRef}
        {...{ [POPOVER_AVOID]: '' }}
        role="toolbar"
        aria-label="Tools"
        aria-orientation="horizontal"
        className={styles.dock}
        data-floating-dock=""
        {...(isCompact ? { 'data-compact': '', [BOTTOM_CHROME_ATTRIBUTE]: '' } : {})}
        onKeyDown={keys.onDockKeyDown}
        onPointerDown={keys.onDockPointerDown}
        onFocus={roving.onFocus}
      >
        <DockSections
          sections={sections}
          pressed={pressed}
          isAvailable={isAvailable}
          isCompact={isCompact}
          role={role}
          registry={registry}
          onChoose={choose}
        />
        {bar !== undefined && bar.more.length > 0 && (
          <FloatingMoreTools
            tools={bar.more}
            pressed={pressed}
            isAvailable={isAvailable}
            onChoose={(tool) => {
              const action = floatingDockToolAction(tool);
              if (action !== undefined) choose(tool, action);
            }}
          />
        )}
      </div>
      {reactions?.isOpen === true && <ReactionsFlyout reactions={reactions} isSheet={isCompact} />}
      {reactions?.isOpen !== true && (
        <OpenToolPanel
          panel={panel}
          keys={keys}
          registry={registry}
          dispatch={dispatch}
          isSheet={isCompact}
        />
      )}
    </>
  );
}

/**
 * The dock's sections, each a labelled group of its tools' buttons, with a divider between them.
 *
 * @param props - The sections and how their buttons show and choose.
 * @param props.sections - The sections shown.
 * @param props.pressed - The tool shown pressed, if any.
 * @param props.isAvailable - Whether a tool can be chosen now.
 * @param props.isCompact - Whether they are in the compact bar (48 px targets).
 * @param props.role - Whose dock it is.
 * @param props.registry - The shortcuts, for the buttons' hints.
 * @param props.onChoose - Chooses a tool with its action.
 * @returns The sections.
 */
function DockSections(props: {
  readonly sections: readonly FloatingDockSection[];
  readonly pressed: FloatingDockToolId | undefined;
  readonly isAvailable: (tool: FloatingDockToolId) => boolean;
  readonly isCompact: boolean;
  readonly role: DockRole;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly onChoose: (tool: FloatingDockToolId, action: ShellAction) => void;
}): ReactElement {
  return (
    <>
      {props.sections.map((section, index) => (
        <Fragment key={section.id}>
          {index > 0 && <span className={styles.divider} data-dock-divider="" aria-hidden="true" />}
          <div
            role="group"
            aria-label={section.label}
            className={styles.section}
            data-dock-section={section.id}
          >
            {section.tools.map((tool) => (
              <FloatingDockToolButton
                key={tool}
                tool={tool}
                isPressed={props.pressed === tool}
                isAvailable={props.isAvailable(tool)}
                isCompact={props.isCompact}
                registry={props.registry}
                onChoose={(action) => {
                  props.onChoose(tool, action);
                }}
              />
            ))}
          </div>
        </Fragment>
      ))}
    </>
  );
}

/**
 * A role's dock sections as shown: Comment only where the site's comments let the person write
 * (as the classic dock's), and a section left empty dropped.
 *
 * @param sections - The role's sections (the dock's, or the compact bar's).
 * @param canComment - Whether the site's comments let the person write.
 * @returns The sections.
 */
function shownSections(
  sections: readonly FloatingDockSection[],
  canComment: boolean,
): readonly FloatingDockSection[] {
  return sections
    .map((section) => ({
      ...section,
      tools: section.tools.filter((tool) => canComment || tool !== 'comment'),
    }))
    .filter((section) => section.tools.length > 0);
}

/**
 * Whether a tool's interaction mode can be made active now (the shell's available tools); a
 * tool without a mode (Comment) needs none.
 *
 * @param tool - The tool.
 * @param state - The shell state.
 * @returns True when it can be chosen.
 */
function isModeAvailable(tool: FloatingDockToolId, state: ShellState): boolean {
  const { mode } = FLOATING_DOCK_TOOLS[tool];
  return mode === undefined || state.availableTools.includes(mode);
}

/**
 * One floating dock tool's button: its name, icon and key hint, pressed while chosen, disabled
 * while not built, the role's or not available now. Comment carries an accent dot, and says how
 * many, while threads are unread for the person.
 *
 * @param props - The tool, its state, the shortcuts and where its action goes.
 * @param props.tool - The tool.
 * @param props.isPressed - Whether it is the chosen tool.
 * @param props.isAvailable - Whether it can be chosen.
 * @param props.isCompact - Whether it is in the compact bar: a 48 px target.
 * @param props.registry - The shortcuts, for its hint.
 * @param props.onChoose - Receives its action.
 * @returns The button.
 */
function FloatingDockToolButton(props: {
  readonly tool: FloatingDockToolId;
  readonly isPressed: boolean;
  readonly isAvailable: boolean;
  readonly isCompact: boolean;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly onChoose: (action: ShellAction) => void;
}): ReactElement {
  const { tool, onChoose } = props;
  const action = floatingDockToolAction(tool);
  const label = FLOATING_DOCK_TOOLS[tool].label;
  // Comment carries a dot while threads are unread for the person.
  const unread = useCommentMode()?.unread?.threads ?? 0;
  const hasDot = tool === 'comment' && unread > 0;
  return (
    <DockButton
      label={label}
      {...(hasDot ? { name: `${label}, ${String(unread)} unread` } : {})}
      icon={FLOATING_DOCK_ICONS[tool]}
      hint={actionHint(props.registry, floatingDockKeyAction(tool))}
      isPressed={props.isPressed}
      isAvailable={props.isAvailable && action !== undefined}
      isCompact={props.isCompact}
      hasSmallIcon
      onSelect={() => {
        if (action !== undefined) onChoose(action);
      }}
    >
      {hasDot && <span className={styles.unreadDot} data-unread-dot="" aria-hidden="true" />}
    </DockButton>
  );
}

/**
 * The floating whiteboard dock (design "Whiteboard · tool panels"), shown
 * instead of the classic dock on a whiteboard board under the floating chrome: centred over the
 * canvas's bottom edge, its tools in three sections with a divider between them, Navigate
 * (Select, Pan, Section), Set the stage (Shapes, Image, Text, Connector, Draw) and Collaborate
 * (Sticky, Comment, Reactions), each section a labelled group. A person who cannot edit keeps a
 * reduced dock (`floatingDockSectionsFor`); a tool not built yet (Reactions) and a
 * commenter's Comment show disabled, and Comment shows only where the site's comments let the
 * person write (none in the standalone shell). The chosen tool's panel (a registered
 * `toolbar/tool-panels/*-panel.tsx`) shows above it; the selection popover keeps clear of both
 * (`data-popover-avoid`). One tab stop with roving focus, as the classic dock.
 */
export const FloatingDock = memo(FloatingDockView, isSameFloatingDock);
