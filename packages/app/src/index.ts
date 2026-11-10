export { AppShell, type AppShellProps, type WhiteboardChrome } from './shell/app-shell.js';
export type { BoardBarContent } from './shell/board-name-bar.js';
export type { FloatingBoardMenuHost } from './shell/floating-board-menu.js';
export type { HelpLinks, HostEventProps } from './shell/host-props.js';
export type { BoardMenuEntry } from './shell/board-menu.js';
export { OBJECT_PARAMETER, objectLinkOf } from './links/object-link.js';
export type {
  AdapterAssetMessage,
  AssetLink,
  LocalImage,
  PageAssetMessage,
  PageLink,
} from './assets/asset-channel.js';
export type { ScheduleTimer } from './assets/poll-budget.js';
export type * from './assets/assets-http-types.js';
export {
  createHttpAssetSource,
  HttpAssetSource,
  type HttpAssetSourceOptions,
} from './assets/http-asset-source.js';
export { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './assets/image-files.js';
export {
  ImageUploads,
  MAX_CONCURRENT_UPLOADS,
  type RunImageUpload,
  type UploadEntry,
} from './assets/image-uploads.js';
export {
  CopiedAssets,
  type CopiedAssetsOptions,
  type CopiedAssetsStorage,
} from './assets/copied-assets.js';
export { CopyLedger } from './assets/copy-ledger.js';
export { ProcessingImages } from './assets/processing-images.js';
export {
  PageImages,
  type BoardImageAccess,
  type ImageInsertTarget,
  type PageImagesOptions,
  type ReplacementAsset,
} from './assets/page-images.js';
export {
  ImageAvailabilityCheck,
  type ImageAvailability,
  type ImageAvailabilityOptions,
} from './assets/image-availability.js';
export { documentVisibility, type PageVisibility } from './assets/page-visibility.js';
export {
  ImagePreparer,
  MAX_PREPARING,
  type ImagePixelSize,
  type PrepareAnswer,
  type PreparedImage,
  type PrepareOutcome,
  type PrepareRequest,
  type PrepareWorker,
  type SizeReader,
} from './assets/prepare-image.js';
export type { PutFile } from './assets/run-upload.js';
export type { UploadEvent, UploadPhase, UploadState } from './assets/upload-state.js';
export { CanvasMount, type CanvasMountProps } from './canvas/canvas-mount.js';
export {
  DEFAULT_BOARD_ID,
  DEV_RELAY_URL,
  devTokenUrlFor,
  parseBoardAddress,
  type BoardAddress,
  type BoardAddressDefaults,
} from './collab/board-address.js';
export type {
  BoardConnection,
  BoardRecoverySource,
  BoardSyncClient,
  ConnectionStatusSource,
  StrandedEditsSource,
} from './collab/board-connection.js';
export type {
  BoardConnectionStatus,
  CollaboratorSummary,
} from './collab/board-connection-status.js';
export type { BoardTokenProviderOptions } from './collab/board-token-provider.js';
export { PresenceShareBar, type PresenceShareBarProps } from './collab/presence-share-bar.js';
export { AccountMenu, type AccountMenuProps, type ShellAccount } from './account/account-menu.js';
export {
  createLocalBoardConnection,
  type LocalBoardConnectionOptions,
} from './collab/local-board-connection.js';
// The board connection's opener stays out of the library bundle until the SDK needs it (the
// playground imports it from source); its types document the shell's `connection` prop.
export type { OpenBoardConnectionOptions } from './collab/open-board-connection.js';
export type { ProvidedBoardTokens } from './collab/provided-board-tokens.js';
export type { CanvasBackingSize } from './canvas/backing-store-size.js';
export { mountDefaultEngine } from './engine/mount-default-engine.js';
export { createEngineHostMount } from './engine/mount-engine-host.js';
export type { EngineHostMountOptions } from './engine/engine-host-mount-options.js';
export type {
  ContextMenuRequest,
  EngineDrawingBuffer,
  MountedEngine,
  MountEngine,
  MountEngineOptions,
} from './engine/mounted-engine.js';
export { HostFrameFeed, type HostFrame } from './diagnostics/ink-debug/host-frame-feed.js';
export {
  LiveInkChannel,
  type LiveInkModel,
  type LiveInkPaint,
} from './live-ink/live-ink-channel.js';
export type { LiveInkHandOff } from './live-ink/live-ink-hand-off.js';
export type { ChangeSetSummary } from './engine/document-scene-feed.js';
export type { BoardView, BoardViewChange, BoardViewState } from './engine/board-view.js';
export type { ComponentDeletion } from './engine/component-deletion.js';
export type {
  DeletionConfirmationSource,
  PendingDeletion,
} from './engine/deletion-confirmations.js';
export type { EditedText, TextStyleChange, TextStyleContext } from './engine/document-text.js';
export { OverlayLabelFeed } from './editing/overlay-label-feed.js';
export { TextEditingFeed, type TextEditingSpot } from './editing/text-editing-feed.js';
export type { PeerEditingGeometry, PeerEditingInput } from './editing/peer-editing-geometry.js';
export type { PeerEditingPlacement, PeerEditingSurface } from './engine/mount-peer-editing.js';
export type {
  PeerSelectionInput,
  PeerSelectionPlacement,
  PeerSelectionSurface,
} from './engine/mount-peer-selection.js';
export type {
  EditHistory,
  EngineInspection,
  TextEditingInspection,
} from './engine/engine-document.js';
export {
  CANVAS_BOARD_MIME_TYPE,
  CANVAS_OBJECTS_MIME_TYPE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
  type ClipboardFlavours,
} from './clipboard/clipboard-formats.js';
export {
  DEFAULT_PASTE_HANDLERS,
  registerPasteHandler,
} from './clipboard/default-paste-handlers.js';
export {
  PasteHandlerRegistry,
  type PasteHandler,
  type PasteHandlerOptions,
  type LinkCardUpdate,
  type PasteImages,
  type PasteItem,
  type PasteLocation,
  type PasteTarget,
} from './clipboard/paste-handlers.js';
export {
  MAX_PASTE_MARKUP_LENGTH,
  MAX_PASTE_OBJECTS,
  MAX_PASTE_TEXT_LENGTH,
} from './clipboard/clipboard-notice.js';
export type { PreparedCut } from './clipboard/clipboard-source.js';
export { createImagePasteHandler, IMAGE_PASTE_PRIORITY } from './clipboard/image-paste-handler.js';
export { PASTE_OFFSET } from '@canvas/document';
export {
  DEVELOPER_OVERLAY_FPS_POLL_INTERVAL_MS,
  DEVELOPER_OVERLAY_POLL_INTERVAL_MS,
  DeveloperOverlay,
  type DeveloperOverlayProps,
  type FrameStatsReader,
} from './diagnostics/developer-overlay.js';
export {
  frameRateOf,
  recordFrameTime,
  FRAME_RATE_WINDOW_MS,
  type FrameRateReading,
} from './diagnostics/frame-rate.js';
export type {
  CanvasHarness,
  CanvasHarnessAttribute,
  CanvasHarnessHost,
  CanvasHarnessProperty,
  CanvasHarnessSnapshot,
  CanvasMetrics,
  HarnessTheme,
  HarnessPanels,
  PixelBlock,
  PixelRect,
} from './harness/canvas-harness.js';
export type {
  EngineHarness,
  EngineHarnessCanvas,
  EngineHarnessProperty,
} from './harness/engine-harness.js';
export type { HarnessAssetChannel, HarnessAssetMessage } from './engine/harness-assets.js';
export type { HarnessBoard, HarnessView, WorkerProbe } from './harness/harness-url-options.js';
export type { InputCompletion, PageLongTask, TransferTiming } from './harness/page-latency.js';

export { chordsEqual, parseChord, type ParsedChord } from './shortcuts/chord.js';
export { formatAriaKeyShortcut, formatChord, formatChordParts } from './shortcuts/chord-format.js';
export { detectKeyboardPlatform, type KeyboardPlatform } from './shortcuts/keyboard-platform.js';
export type { KeyEventLike } from './shortcuts/key-event-match.js';
export {
  SHORTCUT_CATEGORIES,
  type ShortcutCategory,
  type ShortcutCategoryInfo,
} from './shortcuts/shortcut-category.js';
export {
  createShortcutRegistry,
  findShortcutConflict,
  listShortcuts,
  matchShortcut,
  registerShortcut,
  type ShortcutDefinition,
  type ShortcutEntry,
  type ShortcutGroup,
  type ShortcutRegistry,
} from './shortcuts/shortcut-registry.js';
export { createDefaultShortcutRegistry, DEFAULT_SHORTCUTS } from './keymap/default-keymap.js';
export { useShortcuts } from './hooks/use-shortcuts.js';
export type {
  ArrangeCommand,
  CanvasAction,
  ComponentAction,
  ComponentCommand,
  HistoryCommand,
  NavigationCommand,
  NudgeDirection,
  SelectionCommand,
  ShellAction,
  StyleChange,
} from './state/shell-action.js';
export type { LinkCardAction } from './state/link-card-action.js';
export type * from './state/panel-action-types.js';
export type { LayoutField } from './panels/layout-box.js';
export {
  INITIAL_SHELL_STATE,
  shellReducer,
  type RecordedCanvasAction,
  type ShellState,
} from './state/shell-reducer.js';
export type { NoticeAction, ShellNotice } from './hooks/use-notice.js';
export { BUSY_NOTICE, INPUT_CHANGED_NOTICE } from './notices/busy-notices.js';
export {
  noticeOf,
  type NoticeOutline,
  type NoticeSink,
  type ProtectedUndo,
  type ShownNotice,
} from './notices/notice-outline.js';
export type { PageCommandName, PageNavigation } from './pages/page-navigator.js';
export {
  DEFAULT_VIEW_PREFERENCES,
  loadViewPreferences,
  saveViewPreferences,
  VIEW_PREFERENCES_STORAGE_KEY,
} from './state/view-preferences.js';
export type { PreferenceStorage, ViewPreferences } from './state/view-preferences.js';
export * from './state/tool-style-api.js';
export { TOOL_LABELS } from './state/tool-labels.js';
export { DEFAULT_TOOL_STYLES, toolStylesOf } from './tool-styles/default-tool-styles.js';
export { DEFAULT_LINE_STYLE, lineToolStyleOf } from './tool-styles/line-style.js';
export {
  availableToolIds,
  TOOL_AVAILABILITY,
  type ToolAvailability,
  type ToolTicket,
} from './state/tool-availability.js';
export {
  DOCK_BUTTON_IDS,
  DOCK_BUTTONS,
  dockButtonAction,
  dockButtonOfVariant,
  type DockButtonDefinition,
  type DockButtonId,
} from './state/dock-buttons.js';
export {
  DOCK_GROUP_IDS,
  DOCK_GROUPS,
  dockGroupButtonOf,
  dockGroupOfTool,
  INITIAL_DOCK_GROUP_TOOLS,
  withDockGroupTool,
  type DockGroup,
  type DockGroupButtonModel,
  type DockGroupId,
  type DockGroupTools,
} from './state/dock-groups.js';
export {
  DEFAULT_BOARD_MODE,
  DOCK_LAYOUTS,
  dockEntriesFor,
  isDockGroup,
  READ_ONLY_DOCKS,
  type DockEntry,
  type DockRole,
} from './state/dock-layout.js';
export {
  MOBILE_BAR_LAYOUTS,
  mobileBarEntriesFor,
  type MobileBarEntry,
} from './state/mobile-bar-layout.js';
export { BOARD_MODES, type BoardMode } from '@canvas/schema';

export {
  createStylePanelRegistry,
  panelContextOf,
  registerStylePanelSection,
  sectionsForContext,
  sectionsShown,
  SELECTION_CONTEXTS,
  selectionContextOf,
  TOOL_CONTEXTS,
  type SelectionContext,
  type StylePanelRegistry,
  type StylePanelSection,
  type StylePanelSectionProps,
} from './panels/panel-sections.js';
export {
  createDefaultStylePanelRegistry,
  DEFAULT_STYLE_PANEL_SECTIONS,
} from './panels/default-style-sections.js';
export {
  patchFor,
  styleChangesFor,
  takesStyle,
  type StyleToApply,
} from './panels/style-changes.js';
export { commonValue, isSameColour, MIXED, type Mixable } from './panels/controls/mixed-value.js';
export { ColourControl, type ColourControlProps } from './panels/controls/colour-control.js';
export { NumberControl, type NumberControlProps } from './panels/controls/number-control.js';
export {
  SelectControl,
  type SelectControlProps,
  type SelectOption,
} from './panels/controls/select-control.js';
export { ToggleControl, type ToggleControlProps } from './panels/controls/toggle-control.js';
export {
  createToolbarActionRegistry,
  registerToolbarAction,
  type ToolbarAction,
  type ToolbarActionRegistry,
} from './toolbar/toolbar-actions.js';
export {
  createDefaultToolbarActionRegistry,
  DEFAULT_TOOLBAR_ACTIONS,
} from './toolbar/default-toolbar-actions.js';
export {
  BRAND_NEUTRALS,
  COLOURWAYS,
  type BrandTokenName,
  type Colourway,
} from './theme/brand-tokens.js';
export {
  GRAPHITE_COLORS,
  VELLUM_COLORS,
  type ColorTokenName,
  type ColorTokens,
} from './theme/color-tokens.js';
export {
  canvasBackgroundOf,
  inkColorsOfThemes,
  overlayPaletteOf,
} from './theme/canvas-background.js';
export {
  applyChromeFonts,
  loadChromeFonts,
  NEUTRAL_CHROME_FONTS,
  type ChromeFallbackFace,
  type ChromeFontFace,
  type ChromeFontFaceFactory,
  type ChromeFontSet,
} from './theme/chrome-fonts.js';
export { setFontFileResolver, type FontFileResolver } from './text-input/font-file-urls.js';
export { LAYER_TOKENS, type LayerTokenName } from './theme/layer-tokens.js';
export { SCALE_TOKENS, type ScaleTokenName } from './theme/scale-tokens.js';
export {
  GRAPHITE_SHADOWS,
  VELLUM_SHADOWS,
  type ShadowTokenName,
  type ShadowTokens,
} from './theme/shadow-tokens.js';
export {
  TEXT_STYLES,
  TEXT_STYLE_TOKENS,
  type TextStyleName,
  type TextStyleSpec,
  type TextStyleTokenName,
} from './theme/text-styles.js';
export { THEME_LABELS, THEMES, type ThemeName, type ThemeTokens } from './theme/theme-tokens.js';
export {
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  nextThemePreference,
  resolveTheme,
  saveThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
  type ThemePreference,
} from './theme/theme-preference.js';
export { useTheme, type ThemeControls, type ThemeScope } from './hooks/use-theme.js';
export type { StartPendingEngine, PendingEngine } from './engine/pending-engine.js';
export type { EnginePreviewScene } from './engine/engine-preview-scene.js';
export { FIRST_PAINT_PHASES } from './harness/first-paint-trace.js';
export type { FirstPaintMilestone, FirstPaintPhase } from './harness/first-paint-trace.js';
