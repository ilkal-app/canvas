import { useRef, useState, type ReactElement } from 'react';

import type { ReactionChannel } from '@canvas/collab';
import type { BoardMode } from '@canvas/schema';

import type { ShellAccount } from '../account/account-menu.js';
import type { CanvasMountProps } from '../canvas/canvas-mount.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { useHoldReloadWhileSaving } from '../collab/hold-reload-while-saving.js';
import { CameraInputProvider, CameraInputSignal, useCameraInput } from '../collab/use-follow.js';
import { useContextMenu } from '../context-menu/use-context-menu.js';
import type { DeveloperOverlayProps } from '../diagnostics/developer-overlay.js';
import type { MountedEngine, MountEngine } from '../engine/mounted-engine.js';
import type { StartPendingEngine } from '../engine/pending-engine.js';
import type { BoardExporter } from '../export/run-export.js';
import { LiveAnnouncerBoundary } from '../feedback/live-announcer.js';
import { ToastHome, ToastRegionBoundary } from '../feedback/toast-region.js';
import { useShellHarness } from '../harness/use-shell-harness.js';
import { useTheme, type ThemeScope } from '../hooks/use-theme.js';
import { useOpeningCamera } from '../pages/opening-camera.js';
import { collaboratorPageName } from '../pages/page-navigator.js';
import type { PageListSource } from '../pages/page-switcher.js';
import type { StylePanelRegistry } from '../panels/panel-sections.js';
import { usePanelModel } from '../panels/use-panel-model.js';
import { useLongPressReactions } from '../reactions/long-press-reactions.js';
import { ReactionsProvider } from '../reactions/reactions-provider.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import { FontReplacementDialog } from '../text-input/font-replacement-dialog.js';
import type { ChromeFontSet } from '../theme/chrome-fonts.js';
import type { ThemePreference } from '../theme/theme-preference.js';
import type { ToolbarActionRegistry } from '../toolbar/toolbar-actions.js';

import styles from './app-shell.module.css';
import type { BoardBarContent } from './board-name-bar.js';
import { CanvasControls } from './canvas-controls.js';
import type { HelpLinks } from './help-links.js';
import { useHostEvents, type HostEventProps } from './host-events.js';
import { pageListOf } from './page-list-role.js';
import { shellBoardModeContext, useShellBoardModeValue } from './shell-board-mode.js';
import { ShellLayers, type ShellLayersProps } from './shell-layers.js';
import { boardTitleOf, exporterOf, shellEngineOptionsOf } from './shell-root-inputs.js';
import { ShellTopBars } from './shell-top-bars.js';
import { ShellWorkspace } from './shell-workspace.js';
import { useCommentKeyDispatch } from './use-comment-key-dispatch.js';
import { useEditableShellState } from './use-editable-shell-state.js';
import { useNoSwipeBack } from './use-no-swipe-back.js';
import { useShellEngine } from './use-shell-engine.js';
import { useShellInput } from './use-shell-input.js';
import { useShellInspector } from './use-shell-inspector.js';
import { useShellRegistries } from './use-shell-registries.js';
import {
  chromeForMode,
  chromeRootAttributes,
  whiteboardChromeContext,
  useWhiteboardChrome,
} from './whiteboard-chrome.js';

export type { WhiteboardChrome } from './whiteboard-chrome.js';

/** Props of {@link AppShell}. */
export interface AppShellProps extends CanvasMountProps, DeveloperOverlayProps, HostEventProps {
  /**
   * The presence/share bar and the notices are shown by default; an isolated history view
   * supplies its own context.
   */
  readonly shouldShowConnectionFeedback?: boolean;
  /** The keyboard convention for shortcuts and their labels; detected from the browser if absent. */
  readonly platform?: KeyboardPlatform;
  /** The theme to start with; `system` (follow `prefers-color-scheme`) if absent. */
  readonly initialThemePreference?: ThemePreference;
  /**
   * Whose theme the shell's is (`useTheme`): the page's, shared with every themed root on it and
   * kept on this device, if absent; `shell` keeps a choice to this shell (an SDK board).
   */
  readonly themeScope?: ThemeScope;
  /**
   * Mounts the engine on the canvas; if absent, `mountDefaultEngine`: the engine host mount with
   * the engine in a dedicated worker where the browser can render there, else
   * on the main thread. Pass `createEngineHostMount({ prefer: 'main' })` to keep the engine on
   * the page; tests pass a fake.
   */
  readonly mountEngine?: MountEngine;
  /** Keeps this canvas through a preview/live handoff without exposing a synthetic board. */
  readonly startEngine?: StartPendingEngine;
  /** Disables editing and shell input while the authorized board is hydrating. */
  readonly isLoading?: boolean;
  /** Preserves the authorized role's toolbar/sidebar geometry during loading; grants no input. */
  readonly hasEditingLayoutWhileLoading?: boolean;
  /**
   * Receives the error when the engine cannot start (no WebGPU and no WebGL2, a worker that does
   * not start), and what goes wrong once it runs (a crashed worker); if absent it is reported to
   * the page as an uncaught error (`reportError`).
   */
  readonly onEngineError?: (error: unknown) => void;
  /**
   * The board and its link to the relay (`openBoardConnection`): the engine edits its store under
   * its origin, and a chip over the canvas shows where it stands. Read when the canvas mounts. If
   * absent, the engine makes its own local demo document and no chip shows.
   */
  readonly connection?: BoardConnection;
  /**
   * A reactions channel for a shell whose connection has none: the harness's own
   * (`?reactions=local`). The connection's channel wins when it has one.
   */
  readonly reactions?: Pick<ReactionChannel, 'send' | 'subscribe'> | undefined;
  /**
   * The board's name as the host shows it (the site's title), for what the shell says about the
   * board; the connection's board id if absent.
   */
  readonly boardName?: string;
  /**
   * What the host puts in the board-name bar over the canvas's top-left corner: the
   * way home, the title and the board menu's own entries; the bar shows the
   * board's name (`boardName`, else the connection's board id) and the shell's menu if absent.
   */
  readonly boardBar?: BoardBarContent;
  /**
   * Opens the host's share dialog from the presence/share bar's Share; no Share if
   * absent.
   */
  readonly onShare?: () => void;
  /** Copies the board's link from the presence bar's Copy link; no button if absent. */
  readonly onCopyLink?: () => void;
  /** The signed-in person, whose account button ends the presence/share bar. */
  readonly account?: ShellAccount;
  /**
   * Where the board menu's Help and feedback goes: the host's help page and feedback
   * address; no Help and feedback if absent.
   */
  readonly helpLinks?: HelpLinks;
  /**
   * The fonts the chrome is set in: the host's (the site's Rand); the shell's own,
   * open Geist and Geist Mono (`NEUTRAL_CHROME_FONTS`), if absent.
   */
  readonly chromeFonts?: ChromeFontSet;
  /** The host's notice, first in the board's notices (the site's session ended). */
  readonly hostNotice?: ShellLayersProps['hostNotice'];
  /**
   * The view toggles of the board menu (grid, snapping); if absent, those of `toolbar/actions/`
   * (`createDefaultToolbarActionRegistry`).
   */
  readonly toolbarActions?: ToolbarActionRegistry;
  /**
   * Whether the host shows a modal dialog of its own over the shell (the site's share dialog):
   * the layout is then inert and the canvas's shortcuts and clipboard are off, exactly as while
   * the cheat sheet is open, so no key or paste aimed at the page reaches the board. False if
   * absent.
   */
  readonly isInert?: boolean;
  /**
   * The board's mode, whose tools the dock offers: the site's board record.
   * If absent, the shell keeps its own, Whiteboard to start, which the switcher changes.
   */
  readonly mode?: BoardMode;
  /**
   * Called with the mode chosen in the dock's switcher (the site saves it on the board); the
   * shell's own mode follows it. Nothing in the board's document changes.
   */
  readonly onModeChange?: (mode: BoardMode) => void;
  /**
   * The style panel's sections; if absent, those of `panels/sections/`
   * (`createDefaultStylePanelRegistry`).
   */
  readonly stylePanelSections?: StylePanelRegistry;
  /**
   * Whether the board zooms to fit its content whenever it opens (item 1,
   * `useOpeningCamera`): the site's whiteboards. Off if absent, so the camera starts at the
   * origin.
   */
  readonly shouldFitOnOpen?: boolean;
}

/**
 * The application shell: the canvas filling the shell, the layers drawer
 * over its left side under the board-name bar while open (the zoom control's layers toggle
 * and alt+1 open and close it, the person's choice kept in `localStorage`), the right-hand column
 * floating over it holding the inspector drawer (the contextual style panel, opening on a
 * selection, by its toggle or alt+8, and sharing its slot with the host's comments and history
 * panels), the dock of the board mode's tools over the canvas's bottom centre and the zoom control
 * over its bottom-left corner, the developer overlay over the canvas when shown
 * (mod+shift+d), a notice over the canvas when an action did nothing or a command was refused
 * (objects an order command left out among them), the canvas's context menu where a long-press or a
 * secondary click opens it, and the shortcut cheat sheet over everything when open. It owns
 * the shell state, keeps the person's grid and snapping preferences in `localStorage` (mod+',
 * mod+shift+'), binds the default shortcuts to the window, themes its own subtree and runs the
 * engine on the canvas, handing it the active tool and the camera, selection and history shortcuts,
 * and routes the document's copy, cut and paste events to it. Every
 * notice, toast and board condition it shows (the notice, the offline banner, the view-only notice,
 * the cache recovery and stranded-edits notices, the host's own) goes to the one toast region
 * (`ToastRegionBoundary`: the host's, else its own), shown over the dock in its own home outside
 * the inert layout (`ToastHome`). Over the canvas float the board-name bar (top left: the
 * host's way home, the title and mode, the board menu with grid, snapping, the shortcut sheet and
 * the theme) and, with a board connection or a host's Share, the presence/share bar (top right: the
 * connection's state, who else is here, Share, and the signed-in person's account button,
 *), first in the tab order after the toolbar. While the cheat sheet is open the rest of the
 * shell is inert and canvas shortcuts and the clipboard are off. While it is mounted a sideways
 * swipe does not navigate the browser back (`useNoSwipeBack`), and while the board's
 * device cache has writes pending a reload asks first (`useHoldReloadWhileSaving`).
 * Any edits a layout bump stranded show in the toast region. What happens on the board
 * without the person's doing (another person's reaction, a vote revealed) is told to a screen
 * reader through the page's one live region (`LiveAnnouncerBoundary`). A person who cannot edit the board (a viewer or a commenter, as the relay
 * answers) gets a read-only shell: the select tool alone, no style panel or lock toggles,
 * no editing shortcut, menu entry, gesture, paste or drop, and "You can view this board" once in
 * the board's notices; it follows a role changed mid-session without a reload. While the connection
 * is `outdated` (this build cannot read the board) editing is off the same way, the
 * connection's state alone staying live, saying to reload; and so while the host says its own
 * dialog is open (`isInert`). Actions go through the scenario harness in `VITE_CANVAS_HARNESS=1`
 * builds only (`useShellHarness`), else to the reducer.
 *
 * @param props - Canvas callbacks, and optionally the platform, initial theme, engine mount and
 *   another source of frame statistics for the developer overlay (the engine's by default).
 * @returns The shell.
 */
export function AppShell(props: AppShellProps): ReactElement {
  const boardMode = useShellBoardModeValue(props.mode, props.onModeChange, 'floating');
  // Floating on whiteboard boards, classic on design and slides boards (D1; since
  // the cutover's delete, no host names another): the shell's surfaces read this chrome.
  const chrome = chromeForMode('floating', boardMode.mode);
  // The person's own camera moves, from the engine to the follow.
  const [cameraInput] = useState(() => new CameraInputSignal());
  return (
    <whiteboardChromeContext.Provider value={chrome}>
      <shellBoardModeContext.Provider value={boardMode}>
        <ToastRegionBoundary>
          <LiveAnnouncerBoundary>
            <ReactionsProvider connection={props.connection} reactions={props.reactions}>
              <CameraInputProvider value={cameraInput}>
                <ShellRoot {...props} />
              </CameraInputProvider>
            </ReactionsProvider>
          </LiveAnnouncerBoundary>
        </ToastRegionBoundary>
      </shellBoardModeContext.Provider>
    </whiteboardChromeContext.Provider>
  );
}

/**
 * The shell inside its toast region (see {@link AppShell}).
 *
 * @param props - The shell's props.
 * @returns The shell.
 */
function ShellRoot(props: AppShellProps): ReactElement {
  const { connection, isLoading = false, platform } = props;
  const registries = useShellRegistries(platform, props.toolbarActions, props.stylePanelSections);
  const { registry } = registries;
  const [state, reducerDispatch, canEditByRole] = useEditableShellState(connection, isLoading);
  const rootRef = useRef<HTMLDivElement>(null);
  useNoSwipeBack();
  useHoldReloadWhileSaving(connection?.cacheWrites);
  const { initialThemePreference, chromeFonts, themeScope } = props;
  const theme = useTheme(rootRef, initialThemePreference, chromeFonts, themeScope);
  const { contextMenu, openContextMenu } = useContextMenu(registry, state.canEdit);
  const onContextMenu = useLongPressReactions(openContextMenu);
  const input = useCameraInput();
  const { engine, toolStyles, notice, textStyle, zoom, camera } = useShellEngine(
    shellEngineOptionsOf(props, state, { onContextMenu, dispatch: reducerDispatch, theme }, input),
  );
  useOpeningCamera(engine.engine, camera, props.shouldFitOnOpen === true, connection);
  const panels = usePanelModel(engine.engine?.board, state.activeTool, registries.sections);
  useHostEvents(props, panels.board.selectedIds, theme.preference, engine.engine);
  const layout = loadingLayoutOf(state, props);
  const shell = { rootRef, registry, showNotice: notice.show };
  const inspector = useShellInspector(panels, layout, shell, reducerDispatch);
  const dispatch = useShellHarness(rootRef, {
    state,
    dispatch: useCommentKeyDispatch(inspector.dispatch, state),
    registry,
    theme: { name: theme.themeName, preference: theme.preference },
    engineRef: engine.engineRef,
    connection,
    panels: { styleContext: panels.context, styleSectionIds: panels.sectionIds },
  });
  const isLayoutInert = useShellInput({ ...props, registry, dispatch, rootRef, engine, state });
  const exporter = exporterOf(props, engine.engine, theme.themeName, notice.show);
  const topBars = topBarsOf(props, {
    registries,
    state: layout,
    theme,
    dispatch,
    isLayoutInert,
    engine: engine.engine,
    exporter,
    pageList: pageListOf(props, canEditByRole, panels.board.selectedIds, notice.show),
  });
  return (
    <div ref={rootRef} className={styles.shell} {...chromeRootAttributes(useWhiteboardChrome())}>
      <div className={styles.layout}>
        <ShellWorkspace
          {...{ engine, panels, notice, toolStyles, textStyle, dispatch, camera, isLoading }}
          state={layout}
          sections={registries.sections}
          host={props}
          shortcuts={registry}
          connection={connection}
          exporter={exporter}
          themeName={theme.themeName}
          isInert={isLayoutInert}
          topBars={topBars}
          overlay={
            <CanvasControls
              {...{ registry, zoom, camera, dispatch, themeName: theme.themeName }}
              engine={engine.engine}
              state={layout}
              host={props}
            />
          }
          inspector={inspector.drawer}
        />
      </div>
      <ShellLayers
        connection={props.shouldShowConnectionFeedback === false ? undefined : connection}
        boardName={props.boardName}
        canEdit={canEditByRole}
        {...{ registry, dispatch, contextMenu, hostNotice: props.hostNotice }}
        isCheatSheetOpen={state.isCheatSheetOpen}
      />
      <ToastHome />
      <FontReplacementDialog />
    </div>
  );
}

/** What {@link topBarsOf} needs of the shell besides its props. */
interface TopBarsInputs {
  /** The shell's registries, whose toolbar actions are the board menu's view toggles. */
  readonly registries: { readonly actions: ToolbarActionRegistry };
  /** The shell state as the layout shows it. */
  readonly state: ShellState;
  /** The theme (`useTheme`). */
  readonly theme: Pick<ReturnType<typeof useTheme>, 'preference' | 'setPreference' | 'themeName'>;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /** Whether the layout is inert. */
  readonly isLayoutInert: boolean;
  /**
   * The mounted engine: its pages, whose names the people's pages show, and its board
   * and pages, which board search searches; none before mount.
   */
  readonly engine: MountedEngine | undefined;
  /** What the board menu's Export exports with. */
  readonly exporter: BoardExporter;
  /** What the floating board bar's pages work with: the role, selection and notice. */
  readonly pageList: PageListSource;
}

/**
 * The top bars over the canvas (`ShellTopBars`): the host's board-name bar content,
 * else the board's name (`boardName`, the connection's board id, or `Untitled board`), the board
 * menu's toggles and theme, and the presence/share bar on the connection (unless the host shows
 * its own feedback) with the host's Share.
 *
 * @param props - The shell's props.
 * @param inputs - The toggles, the state, the theme, the dispatch and whether the layout is inert.
 * @returns The bars.
 */
function topBarsOf(props: AppShellProps, inputs: TopBarsInputs): ReactElement {
  const { connection } = props;
  const title = boardTitleOf(props);
  return (
    <ShellTopBars
      content={props.boardBar}
      fallbackTitle={title}
      actions={inputs.registries.actions.actions}
      state={inputs.state}
      themePreference={inputs.theme.preference}
      dispatch={inputs.dispatch}
      onThemeChange={inputs.theme.setPreference}
      isInert={inputs.isLayoutInert}
      connection={props.shouldShowConnectionFeedback === false ? undefined : connection}
      board={connection}
      search={{ view: inputs.engine?.board, pages: inputs.engine?.pages, engine: inputs.engine }}
      exporter={inputs.exporter}
      pageList={inputs.pageList}
      onShare={props.onShare}
      onCopyLink={props.onCopyLink}
      account={props.account}
      helpLinks={props.helpLinks}
      pageNameOf={(pageId) => collaboratorPageName(inputs.engine?.pages, pageId)}
    />
  );
}

/**
 * Preserves the authorized loading role's geometry without changing permission state.
 *
 * @param state - The actual reducer/engine permissions and tool state.
 * @param props - The optional presentation role while hydration blocks all input.
 * @returns State for rendering inert controls only.
 */
function loadingLayoutOf(state: ShellState, props: AppShellProps): ShellState {
  return props.isLoading === true && props.hasEditingLayoutWhileLoading !== undefined
    ? { ...state, canEdit: props.hasEditingLayoutWhileLoading }
    : state;
}
