// The z-order key rule and comparison moved to @canvas/schema; re-exported under
// their names here so importers of @canvas/document keep working.
export { compareKeys, isValidKey, MAX_KEY_LENGTH } from '@canvas/schema';
export { listAssetIds } from './assets/list-asset-ids.js';
export { boundsOfBoxes, type ArrangeBox, type ArrangeMove } from './arrange/arrange-box.js';
export { ALIGN_KINDS, planAlign, type AlignKind } from './arrange/plan-align.js';
export { planDistribute } from './arrange/plan-distribute.js';
export type { DistributeAxis } from './arrange/plan-distribute.js';
export { planTidy } from './arrange/plan-tidy.js';
export {
  DECODE_ISSUE_CODES,
  isHiddenMemberIssue,
  isParentCycleIssue,
} from './codec/decode-issue.js';
export { findNetworkMemberIssues, NETWORK_MEMBER_PROBLEMS } from './codec/network-well-formed.js';
export type {
  NetworkMemberIssue,
  NetworkMemberProblem,
  StoredNetwork,
  StoredNetworkMember,
} from './codec/network-well-formed.js';
export type { DecodeIssue, DecodeIssueCode } from './codec/decode-issue.js';
export type {
  AnyCommand,
  BoardReader,
  Command,
  CommandContext,
  CommandParts,
  CommandValidation,
  SplitOptions,
  StagedPlanning,
} from './commands/command.js';
export { hasListedAncestor } from './commands/command-checks.js';
export { COMMAND_ERROR_CODES, commandError, isCommandErrorCode } from './commands/command-error.js';
export type { CommandError, CommandErrorCode } from './commands/command-error.js';
export { connectCommand, connectInputSchema } from './commands/connect.js';
export type { ConnectPlan, ConnectResult } from './commands/connect.js';
export { createObjectCommand, createObjectInputSchema } from './commands/create-object.js';
export type { CreateObjectPlan, CreateObjectResult } from './commands/create-object.js';
export { createFrameCommand, createFrameInputSchema } from './commands/create-frame.js';
export type {
  CreateFrameCommand,
  CreateFramePlan,
  CreateFrameResult,
} from './commands/create-frame.js';
export { createObjectsCommand, createObjectsInputSchema } from './commands/create-objects.js';
export { MAX_OBJECTS_PER_TRANSACTION } from './commands/create-objects-parts.js';
export { importedObjectsInStackOrder, type ImportedObject } from './commands/imported-objects.js';
export type { CreateObjectsPlan, CreateObjectsResult } from './commands/create-objects.js';
export { deleteObjectsCommand, deleteObjectsInputSchema } from './commands/delete-objects.js';
export { liftOff, type LiftOffOutcome } from './commands/lift-off.js';
export { writtenSinceCreation } from './commands/written-since-creation.js';
export type { DeleteObjectsPlan, DeleteObjectsResult } from './commands/delete-objects.js';
export {
  editMembers,
  editNetworkCommand,
  editNetworkInputSchema,
} from './commands/edit-network.js';
export type {
  EditNetworkCommand,
  EditNetworkInput,
  EditNetworkPlan,
  EditNetworkResult,
  NetworkMember,
} from './commands/edit-network.js';
export { groupCommand, groupInputSchema } from './commands/group.js';
export type { GroupPlan, GroupResult } from './commands/group.js';
export * from './commands/section-image-api.js';
export { moveObjectsCommand, moveObjectsInputSchema } from './commands/move-objects.js';
export type {
  MoveBy,
  MoveObjectsPlan,
  MoveObjectsResult,
  MoveTo,
} from './commands/move-objects.js';
export { placeObjectsCommand, placeObjectsInputSchema } from './commands/place-objects.js';
export type { PlaceObjectsPlan, PlaceObjectsResult } from './commands/place-objects.js';
export { newObjectSchema } from './commands/new-object-schema.js';
export { comparePaintOrder } from './commands/paint-order.js';
export type { NewObject } from './commands/new-object-schema.js';
export type { PlannedPatch } from './commands/object-patches.js';
export { COMMANDS, findCommand } from './commands/registry.js';
export { openHistoricalStore } from './commands/historical-store.js';
export { restoreBoardCommand, restoreBoardInputSchema } from './commands/restore-board.js';
export type { RestoreBoardPlan } from './commands/restore-board.js';
export { RESTORE_MARKER_KEY, restoreMarkerSchema } from './meta/restore-marker.js';
export type { RestoreMarker } from './meta/restore-marker.js';
export type { CommandInput, CommandName, CommandResult } from './commands/registry.js';
export {
  bringForwardCommand,
  bringToFrontCommand,
  reorderInputSchema,
  sendBackwardCommand,
  sendToBackCommand,
} from './commands/reorder.js';
export type { ReorderCommand, ReorderResult } from './commands/reorder.js';
export { addPageCommand, addPageInputSchema } from './commands/pages/add-page.js';
export type { AddPagePlan, AddPageResult } from './commands/pages/add-page.js';
export { deletePageCommand, deletePageInputSchema } from './commands/pages/delete-page.js';
export type { DeletePagePlan, DeletePageResult } from './commands/pages/delete-page.js';
export { duplicatePageCommand, duplicatePageInputSchema } from './commands/pages/duplicate-page.js';
export type { DuplicatePagePlan, DuplicatePageResult } from './commands/pages/duplicate-page.js';
export {
  moveObjectsToPageCommand,
  moveObjectsToPageInputSchema,
} from './commands/pages/move-to-page.js';
export type {
  MoveObjectsToPagePlan,
  MoveObjectsToPageResult,
} from './commands/pages/move-to-page.js';
export { renamePageCommand, renamePageInputSchema } from './commands/pages/rename-page.js';
export type { RenamePagePlan, RenamePageResult } from './commands/pages/rename-page.js';
export { reorderPageCommand, reorderPageInputSchema } from './commands/pages/reorder-page.js';
export type { ReorderPagePlan, ReorderPageResult } from './commands/pages/reorder-page.js';
export { PAGES_MAP_NAME } from './pages/page-map.js';
export type { PageCreation } from './pages/page-writes.js';
export {
  deleteColorTokenCommand,
  deleteColorTokenInputSchema,
} from './commands/tokens/delete-color-token.js';
export type { DeleteColorTokenResult } from './commands/tokens/delete-color-token.js';
export {
  renameColorTokenCommand,
  renameColorTokenInputSchema,
} from './commands/tokens/rename-color-token.js';
export type {
  RenameColorTokenPlan,
  RenameColorTokenResult,
} from './commands/tokens/rename-color-token.js';
export {
  resetColorTokenCommand,
  resetColorTokenInputSchema,
} from './commands/tokens/reset-color-token.js';
export type {
  ResetColorTokenPlan,
  ResetColorTokenResult,
} from './commands/tokens/reset-color-token.js';
export {
  setColorTokenCommand,
  setColorTokenInputSchema,
} from './commands/tokens/set-color-token.js';
export type { SetColorTokenPlan, SetColorTokenResult } from './commands/tokens/set-color-token.js';
export {
  createObjectsWithTokensCommand,
  createObjectsWithTokensInputSchema,
  MAX_TOKEN_ITEMS,
} from './commands/tokens/create-objects-with-tokens.js';
export type {
  CreateObjectsWithTokensInput,
  CreateObjectsWithTokensPlan,
  CreateObjectsWithTokensResult,
  TokenItemResult,
} from './commands/tokens/create-objects-with-tokens.js';
export {
  parseTokenKey,
  readTokens,
  TOKEN_FIELDS,
  tokenKey,
  TOKENS_MAP_NAME,
} from './tokens/token-map.js';
export type { ParsedTokenKey, TokenField, TokenIdentity } from './tokens/token-map.js';
export type { TokenCreation, TokenWrite } from './tokens/token-writes.js';
export * from './styles/styles-api.js';
export * from './facilitation/facilitation-api.js';
export { renameFrameCommand, renameFrameInputSchema } from './commands/rename-frame.js';
export { renameObjectCommand, renameObjectInputSchema } from './commands/rename-object.js';
export type {
  RenameObjectCommand,
  RenameObjectPlan,
  RenameObjectResult,
} from './commands/rename-object.js';
export type {
  RenameFrameCommand,
  RenameFramePlan,
  RenameFrameResult,
} from './commands/rename-frame.js';
export { resizeObjectsCommand, resizeObjectsInputSchema } from './commands/resize-objects.js';
export type { ResizeObjectsPlan, ResizeObjectsResult } from './commands/resize-objects.js';
export { planGroupResize } from './commands/group-resize.js';
export type {
  GroupResize,
  GroupResizePlan,
  ObjectTreeReader,
  BoxSize,
} from './commands/group-resize.js';
export { rotateObjectsCommand, rotateObjectsInputSchema } from './commands/rotate-objects.js';
export type { RotateObjectsResult } from './commands/rotate-objects.js';
export { batchCommand, MAX_BATCH_ITEMS, type BatchPlan } from './commands/batch-command.js';
export { runCommand } from './commands/run-command.js';
export * from './commands/link-card-api.js';
export { RunRefusedError, startRun } from './commands/start-run.js';
export type { CommandRefusal, RunReport, StartRunOptions } from './commands/start-run.js';
export type {
  CommandEnvironment,
  CommandOutcome,
  RunCommandOptions,
} from './commands/run-command.js';
export { previewCommand } from './commands/preview-command.js';
export type { CommandPreview } from './commands/preview-command.js';
export { boxSourceOf, overlaySource } from './bound/box-source.js';
export type { BoxSource } from './bound/box-source.js';
export { BOUND_SLACK, isPastBound, judgeExtents } from './bound/extent-rule.js';
export type {
  ExtentsOutward,
  ExtentsWithin,
  ExtentVerdict,
  PlaceLost,
} from './bound/extent-rule.js';
export { isFarObject } from './bound/far-object.js';
export { worldBoundViolations } from './bound/world-bound-check.js';
export type { WorldBoundViolation } from './bound/world-bound-check.js';
export { worldBoxOf } from './bound/world-box.js';
export type { WorldBox } from './bound/world-box.js';
export {
  setConnectorEndCommand,
  setConnectorEndInputSchema,
} from './commands/set-connector-end.js';
export type {
  SetConnectorEndCommand,
  SetConnectorEndPlan,
  SetConnectorEndResult,
} from './commands/set-connector-end.js';
export { setLinePointsCommand, setLinePointsInputSchema } from './commands/set-line-points.js';
export type {
  SetLinePointsCommand,
  SetLinePointsPlan,
  SetLinePointsResult,
} from './commands/set-line-points.js';
export { setLockedCommand, setLockedInputSchema } from './commands/set-locked.js';
export type { SetLockedCommand, SetLockedResult } from './commands/set-locked.js';
export { croppedImageBox, fullImageBox } from './commands/image-crop-box.js';
export type { CroppedImage, ImageBox } from './commands/image-crop-box.js';
export { setStyleCommand, setStyleInputSchema } from './commands/set-style.js';
export type { PlannedRestyle, SetStyleResult } from './commands/set-style.js';
export { setTextRunsCommand, setTextRunsInputSchema } from './commands/set-text-runs.js';
export type { SetTextRunsResult } from './commands/set-text-runs.js';
export {
  liftStrokeAlign,
  STYLE_FIELDS_BY_TYPE,
  stylePatchSchema,
} from './commands/style-fields.js';
export type { StyleFieldName, StylePatch } from './commands/style-fields.js';
export { ungroupCommand, ungroupInputSchema } from './commands/ungroup.js';
export type { UngroupPlan, UngroupResult } from './commands/ungroup.js';
export * from './history/history-api.js';
export { createRandomObjectId } from './ids/random-object-id.js';
export * from './meta/meta-api.js';
export {
  HISTORY_KEY_PATTERN,
  ORIGIN_KINDS,
  parseTransactionOrigin,
  SYSTEM_ORIGIN,
} from './origin/transaction-origin.js';
export type { OriginKind, TransactionOrigin } from './origin/transaction-origin.js';
export type { ApplyUpdateInStepsOptions, ApplyUpdateOptions } from './store/document-update.js';
export type {
  BoardSnapshot,
  RepairMode,
  ChangeSet,
  DocumentStore,
  DocumentTransaction,
  DocumentUpdate,
  ObjectFieldName,
  ObjectFieldValue,
  ObjectPatch,
} from './store/document-store.js';
export { DocumentWriteError, type ValidationIssue } from './store/document-write-error.js';
export { createLargeBoardObjects } from './synthetic/large-board.js';
export {
  designBoardLayout,
  designBoardObjects,
  type DesignBoardLayout,
} from './synthetic/design-board.js';
export type { BoardReferences } from './store/reference-index.js';
export { OBJECTS_MAP_NAME, YjsDocumentStore } from './store/yjs-document-store.js';
export * from './store/watch-comment-pins.js';
export * from './search/search-api.js';
export {
  isStoreRunning,
  storeRunState,
  subscribeStoreRuns,
  waitForStoreIdle,
  whenStoreIdle,
} from './store/when-store-idle.js';
export {
  RunStoppedError,
  RunStopRequest,
  StoreBusyError,
  StoreDestroyedError,
} from './store/store-run.js';
export type {
  RunnableStore,
  RunStopReason,
  StoreRun,
  StoreRunProgress,
  StoreRunState,
} from './store/store-run.js';
export { generateKeyBetween, generateNKeysBetween } from './z-order/fractional-key.js';
export { generateObjectKeys } from './z-order/object-keys.js';
export type { ReorderPlan } from './z-order/reorder-plan.js';
export { keysAtFront, sortedSiblings } from './z-order/sibling-order.js';

export { highestLayoutStamp, preserveHighestLayout } from './meta/layout-history.js';

export { discardPendingUpdates, type DiscardedPendingUpdates } from './meta/pending-updates.js';

export { MAX_UPDATE_VALUE_DEPTH, UpdateDepthError } from './assets/update-depth.js';
export { MalformedUpdateError, type MalformedUpdateCause } from './assets/update-bounds.js';
export { assertUpdateDepth } from './assets/update-scan.js';

export type { YjsDocumentStoreOptions } from './store/store-options.js';

export { createComponentCommand, createComponentInputSchema } from './commands/create-component.js';
export type { CreateComponentPlan, CreateComponentResult } from './commands/create-component.js';
export { createInstanceCommand, createInstanceInputSchema } from './commands/create-instance.js';
export type { CreateInstancePlan, CreateInstanceResult } from './commands/create-instance.js';
export { detachInstanceCommand, detachInstanceInputSchema } from './commands/detach-instance.js';
export type { DetachInstancePlan, DetachInstanceResult } from './commands/detach-instance.js';
export type { DetachClamp } from './commands/detach-bake.js';
export {
  setInstanceOverrideCommand,
  setInstanceOverrideInputSchema,
  type SetInstanceOverridePlan,
  type SetInstanceOverrideResult,
} from './commands/set-instance-override.js';
export {
  MAX_OVERRIDE_PATH_INPUT,
  overridePathError,
  overridePathInputSchema,
  resolveOverridePath,
  type OverridePathRefusal,
  type OverridePathResolution,
  type OverridePathRoot,
  type ResolvedOverridePath,
} from './commands/override-path-names.js';
export { setSwapOptionsCommand, setSwapOptionsInputSchema } from './commands/set-swap-options.js';
export type { SetSwapOptionsPlan, SetSwapOptionsResult } from './commands/set-swap-options.js';
export {
  selectionErrors,
  setInstanceVariantCommand,
  setInstanceVariantInputSchema,
  switchedOverrides,
} from './commands/set-instance-variant.js';
export type {
  DroppedOverride,
  SetInstanceVariantPlan,
  SetInstanceVariantResult,
} from './commands/set-instance-variant.js';
export { setVariantAxesCommand, setVariantAxesInputSchema } from './commands/set-variant-axes.js';
export type { SetVariantAxesPlan } from './commands/set-variant-axes.js';
export {
  resetVariantPresetCommand,
  resetVariantPresetInputSchema,
  setVariantPresetCommand,
  setVariantPresetInputSchema,
  type ResetVariantPresetPlan,
  type ResetVariantPresetResult,
  type SetVariantPresetPlan,
  type SetVariantPresetResult,
} from './commands/set-variant-preset.js';
export {
  resetInstanceOverridesCommand,
  resetInstanceOverridesInputSchema,
} from './commands/reset-instance-overrides.js';
export type {
  ResetInstanceOverridesPlan,
  ResetInstanceOverridesResult,
} from './commands/reset-instance-overrides.js';
export { setConstraintsCommand, setConstraintsInputSchema } from './commands/set-constraints.js';
export {
  setAutoLayoutCommand,
  setAutoLayoutInputSchema,
  setLayoutChildCommand,
  setLayoutChildInputSchema,
} from './commands/set-auto-layout.js';
export type { SetAutoLayoutResult } from './commands/set-auto-layout.js';
export {
  patchAutoLayoutCommand,
  patchAutoLayoutInputSchema,
} from './commands/patch-auto-layout.js';
export { planRelayout, type RelayoutSource } from './layout/plan-relayout.js';
export type { SetConstraintsResult } from './commands/set-constraints.js';
export { copySelection, countCopied } from './duplicate/copy-selection.js';
export { planDuplicate } from './duplicate/duplicate-plan.js';
export type { DuplicatePlan } from './duplicate/duplicate-plan.js';
export { inParentFrame, inStackingOrder, PASTE_OFFSET, planPaste } from './duplicate/paste-plan.js';
