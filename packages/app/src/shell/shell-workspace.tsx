import { useMemo, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';

import type { PageImages } from '../assets/page-images.js';
import { UploadFailedToast } from '../assets/upload-failed-toast.js';
import { CanvasMount } from '../canvas/canvas-mount.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { FollowProvider } from '../collab/use-follow.js';
import { DeveloperOverlay, type FrameStatsReader } from '../diagnostics/developer-overlay.js';
import type { CameraSource } from '../editing/camera-source.js';
import { EditingLayers } from '../editing/editing-layers.js';
import { useKeyboardInset } from '../editing/keyboard-inset.js';
import { useKeepInView } from '../editing/use-keep-in-view.js';
import type { TextStyleChange, TextStyleContext } from '../engine/document-text.js';
import type { BoardExporter } from '../export/run-export.js';
import { useSectionTimer } from '../facilitation/use-section-timer.js';
import { useBoardTokens } from '../hooks/use-board-tokens.js';
import type { MountedEngineBinding } from '../hooks/use-mounted-engine.js';
import type { NoticeBinding } from '../hooks/use-notice.js';
import { useObjectLinkOpen } from '../links/object-link.js';
import { Notice } from '../notices/notice.js';
import { PagesPanel } from '../pages/pages-panel.js';
import { usePageShown } from '../pages/use-pages.js';
import { ColourTokensProvider } from '../panels/controls/colour-tokens-context.js';
import {
  ImageAvailabilityProvider,
  type ImageAvailabilityReader,
} from '../panels/image-availability-context.js';
import { ImageReplacementProvider, imageReplacerOf } from '../panels/image-replacement-context.js';
import { InspectorHeaderActions } from '../panels/inspector-header.js';
import type { StylePanelRegistry } from '../panels/panel-sections.js';
import { selectionSummary } from '../panels/selection-summary.js';
import { TextStyleProvider } from '../panels/text-style-control.js';
import { useImageReplacePicker } from '../panels/use-image-replace-picker.js';
import type { PanelModel } from '../panels/use-panel-model.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ToolStyles } from '../state/tool-style.js';
import { useStickyAuthorsControl } from '../stickies/use-sticky-authors-control.js';
import type { ThemeName } from '../theme/theme-tokens.js';
import {
  ImagePanelActionsProvider,
  imagePanelActionsOf,
} from '../toolbar/tool-panels/image-panel-actions.js';

import styles from './app-shell.module.css';
import { BoardOverlays } from './board-overlays.js';
import drawerStyles from './drawer.module.css';
import { InspectorDrawer, type InspectorDrawerBinding } from './inspector-drawer.js';
import { LayersDrawer } from './layers-drawer.js';
import {
  LazySelectionPopover,
  LazyStylePanel,
  usePreloadedWorkspaceParts,
} from './lazy-workspace-parts.js';
import { useIsMobileSite } from './mobile-site.js';
import { useShellDrawers } from './shell-board-mode.js';
import topBarStyles from './top-bars.module.css';

/**
 * Without the page's images, nothing is known of an image's asset.
 *
 * @returns `unknown`, always.
 */
const NO_IMAGES: ImageAvailabilityReader = () => Promise.resolve('unknown');

/** Props of {@link ShellWorkspace}. */
export interface ShellWorkspaceProps {
  /** The engine on the canvas: its canvas callbacks, board view and frame statistics. */
  readonly engine: MountedEngineBinding;
  /** The shell state. */
  readonly state: ShellState;
  /** What the panels show. */
  readonly panels: PanelModel;
  /** The style panel's sections; undefined while the default ones load (no panel yet). */
  readonly sections: StylePanelRegistry | undefined;
  /**
   * What the host gives the workspace: another source of frame statistics for the developer
   * overlay (the engine's if absent), and whether the page shown is kept in the address.
   */
  readonly host: {
    readonly readFrameStats?: FrameStatsReader | undefined;
    readonly isPageInAddress?: boolean | undefined;
  };
  /** The shell's one notice (`useNotice`): what it shows, and how it is hidden. */
  readonly notice: NoticeBinding;
  /** Each creation tool's style, for the style panel with nothing selected. */
  readonly toolStyles: ToolStyles;
  /** The text style the engine reports, which the style panel's text section shows. */
  readonly textStyle: TextStyleContext | undefined;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /** The shell's shortcuts, whose chords the inspector's buttons show. */
  readonly shortcuts: ShortcutRegistry<ShellAction>;
  /**
   * The board's connection: its agents' trace sheets show over the canvas, and its
   * images' uploads show badges there; none if absent.
   */
  readonly connection?: BoardConnection | undefined;
  /** What the selection popover's Export exports with; no Export if absent. */
  readonly exporter?: BoardExporter | undefined;
  /** The theme, whose agent colour the trace sheets' tint takes. */
  readonly themeName: ThemeName;
  /** The top bars over the canvas (`ShellTopBars`), first in the tab order; none if absent. */
  readonly topBars?: ReactNode;
  /** Whether the canvas, the sidebar and the overlays are inert (the shell's layout is). */
  readonly isInert?: boolean;
  /** What floats over the canvas: the dock and the zoom control. */
  readonly overlay?: ReactNode;
  /** The inspector drawer's state (`useInspectorDrawer`). */
  readonly inspector: InspectorDrawerBinding;
  /** Whether the board's objects are still loading: the layers drawer shows skeleton rows. */
  readonly isLoading?: boolean;
  /**
   * The camera on screen, which the text bar and the editing labels follow; neither
   * shows if absent.
   */
  readonly camera?: CameraSource;
}

/**
 * The layers drawer with the board's page list at its top.
 *
 * @param props - The workspace's props.
 * @returns The drawer.
 */
function layersDrawerOf(props: ShellWorkspaceProps): ReactElement {
  const { engine, state, panels, notice, dispatch } = props;
  return (
    <LayersDrawer
      isOpen={state.isLayersDrawerOpen}
      view={engine.engine?.board}
      selectedIds={panels.board.selectedIds}
      enteredGroupId={panels.board.enteredGroupId}
      dispatch={dispatch}
      canEdit={state.canEdit}
      isLoading={props.isLoading === true || engine.engine === undefined}
      pages={
        <PagesPanel
          pages={engine.engine?.pages}
          canEdit={state.canEdit}
          selectedIds={panels.board.selectedIds}
          onNotice={notice.show}
        />
      }
    />
  );
}

/**
 * The inspector drawer's header: what is selected, over a caption, and the lock and
 * "more" menu beside it.
 *
 * @param props - The workspace's props.
 * @returns The drawer's summary and actions.
 */
function inspectorHeaderOf(props: ShellWorkspaceProps) {
  const { panels, state, dispatch } = props;
  return {
    summary: selectionSummary(
      panels.selection,
      state.activeTool,
      panels.selection.length === 0 && panels.context !== 'none',
      panels.board.board,
    ),
    actions: (
      <InspectorHeaderActions
        selection={panels.selection}
        shortcuts={props.shortcuts}
        dispatch={dispatch}
      />
    ),
  };
}

/**
 * The failed uploads' toast, posted to the toast region.
 *
 * @param images - The page's images, if the board has them.
 * @returns The poster, or nothing without images.
 */
function uploadToastOf(images: PageImages | undefined): ReactElement | null {
  if (images === undefined) return null;
  return <UploadFailedToast uploads={images.uploads} />;
}

/**
 * Below 768 px wide: keeps the text being edited, else the selection, clear of the
 * compact chrome, the sheets and the on-screen keyboard (`useKeepInView`), and says whether the
 * inspector's sheet gives way to the format bar while a text is edited (Figma MX1).
 *
 * @param props - The workspace's props.
 * @param workspaceRef - The workspace.
 * @returns Whether a text is edited at the compact width.
 */
function useCompactWorkspace(
  props: ShellWorkspaceProps,
  workspaceRef: RefObject<HTMLDivElement | null>,
): boolean {
  const isCompact = useIsMobileSite();
  const keyboardInset = useKeyboardInset();
  const edited = props.textStyle?.isEditing === true ? props.textStyle.edited : undefined;
  useKeepInView({
    isEnabled: isCompact,
    workspaceRef,
    engine: props.engine.engine,
    camera: props.camera,
    ids: edited === undefined ? props.panels.board.selectedIds : [edited.id],
    layoutKey: `${String(keyboardInset)}:${String(props.inspector.isOpen)}:${String(props.state.isLayersDrawerOpen)}`,
  });
  return isCompact && edited !== undefined;
}

/** Props of {@link WorkspaceInspector}. */
interface WorkspaceInspectorProps extends ShellWorkspaceProps {
  /** The text section's style and change handler. */
  readonly textControl: {
    readonly context: TextStyleContext | undefined;
    readonly onChange: (change: TextStyleChange) => void;
  };
}

/**
 * The inspector drawer with the style panel, its colour controls given the board's
 * colour tokens (`useBoardTokens`) in the viewer's theme, the text section the text
 * style, and the image sections the page's images.
 *
 * @param props - The workspace's props and the text control.
 * @returns The drawer.
 */
function WorkspaceInspector(props: WorkspaceInspectorProps): ReactElement {
  const { engine, panels, state, notice, textControl } = props;
  const images = props.connection?.images;
  const tokenTable = useBoardTokens(engine.engine?.board);
  const colourTokens = useMemo(
    () => ({ table: tokenTable, mode: props.themeName }),
    [tokenTable, props.themeName],
  );
  return (
    <InspectorDrawer drawer={props.inspector} {...inspectorHeaderOf(props)}>
      <TextStyleProvider value={textControl}>
        <ImageAvailabilityProvider value={images?.availability.availabilityOf ?? NO_IMAGES}>
          <ImageReplacementProvider value={imageReplacerOf(images, notice.show)}>
            <ColourTokensProvider value={colourTokens}>
              {props.sections !== undefined && (
                <LazyStylePanel
                  registry={props.sections}
                  context={panels.context}
                  board={panels.board}
                  selection={panels.selection}
                  activeTool={state.activeTool}
                  toolStyles={props.toolStyles}
                  dispatch={props.dispatch}
                  shouldDeleteConnectors={state.shouldDeleteConnectors}
                  shortcuts={props.shortcuts}
                />
              )}
            </ColourTokensProvider>
          </ImageReplacementProvider>
        </ImageAvailabilityProvider>
      </TextStyleProvider>
    </InspectorDrawer>
  );
}

/**
 * The shell below the toolbar: the top bars over the canvas (
 * their own inertness, so the connection's state stays live while the rest is inert), the layers
 * drawer over the canvas's left side while open (the page list at its top),
 * then the canvas, filling the workspace, with the right-hand column floating over it: the
 * inspector drawer with the style panel (not for a person who cannot edit;
 * its colour controls given the board's colour tokens in the viewer's theme),
 * and over the canvas the agents' trace sheets, peers editing text, the
 * editing labels and the text bar, the delete-main confirmation, the dock
 * and the zoom control, the states
 * of the board's images (their uploads, a collaborator's processing), the developer
 * overlay, all inert while `isInert`, and the posters of the shell's one notice and of the failed
 * uploads' toast, which the toast region shows outside the layout. Following and the
 * spotlight (`FollowProvider`) run over it all, for the presence bar and the frame.
 *
 * @param props - The engine, state, panels, notice and dispatch.
 * @returns The workspace.
 */
export function ShellWorkspace(props: ShellWorkspaceProps): ReactElement {
  return (
    <FollowProvider
      connection={props.connection}
      engine={props.engine.engine}
      camera={props.camera}
    >
      <WorkspaceBody {...props} />
    </FollowProvider>
  );
}

/**
 * Follows the page shown: tells the connection (presence), and keeps it in the page's address
 * unless the host says the address is its own (`HostEventProps.isPageInAddress`).
 *
 * @param props - The workspace's props.
 */
function useWorkspacePage(props: ShellWorkspaceProps): void {
  usePageShown(
    props.engine.engine?.pages,
    (pageId) => props.connection?.showPage?.(pageId),
    props.host.isPageInAddress ?? true,
  );
}

/**
 * The workspace inside the follow: see {@link ShellWorkspace}.
 *
 * @param props - The workspace's props.
 * @returns The workspace.
 */
function WorkspaceBody(props: ShellWorkspaceProps): ReactElement {
  const { engine, state, notice, dispatch, textStyle, host } = props;
  const images = props.connection?.images;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const drawers = useShellDrawers(); // None on a floating whiteboard.
  const isCompactEditing = useCompactWorkspace(props, workspaceRef);
  useWorkspacePage(props);
  usePreloadedWorkspaceParts();
  useObjectLinkOpen(engine.engine?.board, dispatch);
  const sectionTimer = useSectionTimer(props.connection);
  const replaceImage = useImageReplacePicker(props.connection?.images, notice.show, dispatch);
  const stickyAuthors = useStickyAuthorsControl(engine.engine, props.connection);
  const imagePanel = useMemo(
    () => imagePanelActionsOf(images, () => engine.engineRef.current?.pasteTarget(), notice.show),
    [images, engine.engineRef, notice.show],
  );
  const textControl = {
    context: textStyle,
    onChange: (change: TextStyleChange) => {
      engine.engineRef.current?.applyTextStyle?.(change);
    },
  };
  return (
    <div ref={workspaceRef} className={styles.workspace}>
      {props.topBars}
      <div className={topBarStyles.contents} inert={props.isInert === true}>
        {drawers.hasLayersDrawer && layersDrawerOf(props)}
        <CanvasMount onCanvasReady={engine.onCanvasReady} onCanvasResize={engine.onCanvasResize}>
          <BoardOverlays
            {...{ connection: props.connection, notice, camera: props.camera }}
            engine={engine.engine}
            canEdit={state.canEdit}
            themeName={props.themeName}
            activeTool={state.activeTool}
            dispatch={dispatch}
          />
          {props.camera !== undefined && (
            <EditingLayers
              {...{ engine: engine.engine, camera: props.camera, textStyle, dispatch }}
              connection={props.connection}
              canEdit={state.canEdit}
              onTextStyle={textControl.onChange}
            />
          )}
          {props.camera !== undefined && (
            <LazySelectionPopover
              {...{ engine: engine.engine, camera: props.camera, dispatch }}
              selection={props.panels.selection}
              {...{ canEdit: state.canEdit, focusRequests: state.popoverFocusRequests }}
              isEditingText={textStyle?.isEditing === true}
              shortcuts={props.shortcuts}
              themeName={props.themeName}
              textStyle={textStyle}
              onTextStyle={textControl.onChange}
              onSectionTimer={sectionTimer}
              onReplaceImage={replaceImage}
              stickyAuthors={stickyAuthors}
              exporter={props.exporter}
              onNotice={notice.show}
            />
          )}
          <ImagePanelActionsProvider value={imagePanel}>{props.overlay}</ImagePanelActionsProvider>
        </CanvasMount>
        <div className={drawerStyles.column} data-text-editing={isCompactEditing ? '' : undefined}>
          {state.canEdit && drawers.hasInspector && (
            <WorkspaceInspector {...props} textControl={textControl} />
          )}
        </div>
        {state.isDeveloperOverlayOpen && (
          <DeveloperOverlay
            readFrameStats={host.readFrameStats ?? engine.readFrameStats}
            readFrameTimesMs={engine.readFrameTimesMs}
          />
        )}
        <Notice notice={notice.notice} onDismiss={notice.dismiss} />
        {uploadToastOf(images)}
      </div>
    </div>
  );
}
