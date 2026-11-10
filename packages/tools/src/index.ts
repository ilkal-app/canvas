export { arrangeFrameOf } from './arrange/arrange-frame.js';
export type { ArrangeFrame } from './arrange/arrange-frame.js';
export {
  ARRANGE_OPERATIONS,
  isArrangeOperation,
  planArrange,
  runArrange,
} from './arrange/arrange-plan.js';
export type { ArrangeOperation, ArrangePlan } from './arrange/arrange-plan.js';
export { applyCameraOperation } from './camera/camera-controller.js';
export {
  chooseDefaultInk,
  contrastRatio,
  DEFAULT_CANVAS_COLORS,
  DEFAULT_INK_CONTRAST,
  DEFAULT_INK_PALETTE,
} from './ink/default-ink.js';
export type { DefaultInkInput } from './ink/default-ink.js';
export { copyInkableColor, creationColor } from './ink/creation-ink.js';
export type { CreationInkSource } from './ink/creation-ink.js';
export { colorsUnderPoint } from './ink/under-point.js';
export type { AverageColorOf, UnderColor, UnderPointColors } from './ink/under-point.js';
export type { CameraOperation } from './camera/camera-controller.js';
export {
  cameraOperationFor,
  FIT_PADDING_PX,
  KEYBOARD_PAN_LARGE_PX,
  KEYBOARD_PAN_PX,
} from './camera/camera-input.js';
export { steppedZoom, ZOOM_LEVELS } from './camera/zoom-levels.js';
export type {
  CameraInput,
  CameraInputContext,
  KeyZoomCommand,
  PanDirection,
} from './camera/camera-input.js';
export {
  fitCameraToRect,
  panCamera,
  resetCameraToOrigin,
  resizeCameraViewport,
  zoomCameraAt,
  zoomCameraTo,
} from './camera/camera-moves.js';
export type { ScreenPoint, ViewportSize } from './camera/camera-moves.js';
export { CameraTransition, interpolateCamera } from './camera/camera-transition.js';
export type { CameraTransitionOptions } from './camera/camera-transition.js';
export { TwoFingerGesture } from './camera/two-finger-gesture.js';
export { LINE_HEIGHT_PX, wheelDeltaPx } from './camera/wheel-delta.js';
export type { ConnectorModeContext, ConnectorStyle } from './connector/connector-context.js';
export { ConnectorEndpoints, connectorEndsOf } from './connector/connector-endpoints.js';
// A connector's route handles.
export * from './connector/route-handles-api.js';
export {
  ConnectorLabelDrag,
  routeFractionAt,
  type ConnectorLabelDragContext,
} from './connector/connector-label-drag.js';
export { ConnectorLabelMode } from './connector/connector-label-mode.js';
export type { ConnectorLabelStart } from './connector/connector-label-mode.js';
export type {
  ConnectorEndName,
  ConnectorEndpointContext,
} from './connector/connector-endpoints.js';
export { ConnectorMode } from './connector/connector-mode.js';
export { connectorEndRects, connectorTargetRects } from './connector/connector-overlay.js';
export type { ConnectorToolEnd } from './connector/connector-end.js';
export type { DrawModeContext } from './draw/draw-context.js';
export type { LiveInk } from './draw/live-ink.js';
export { DrawMode } from './draw/draw-mode.js';
export type { DrawStyle } from './draw/draw-style.js';
export { ERASER_FADE, EraserGesture } from './draw/eraser-gesture.js';
export {
  ERASER_RADIUS_PX,
  eraserRadius,
  erasedStrokes,
  isErasable,
  isStrokeTouched,
  sweepBounds,
  type EraserSource,
  type EraserSweep,
} from './draw/eraser-hits.js';
export {
  DRAW_SMOOTHING,
  freehandObjectsOf,
  newFreehandObjects,
  type NewFreehandObject,
} from './draw/new-freehand-objects.js';
export { STROKE_SPACING_PX, StrokeCapture } from './draw/stroke-capture.js';
export * from './image/image-api.js';
export { constrainLineEnd, LINE_ANGLE_STEP } from './line/angle-constraint.js';
export {
  ANCHOR_CANDIDATES_CAP,
  ANCHOR_SNAP_PX,
  anchorsOfBox,
  nearestAnchor,
} from './line/line-anchors.js';
export type { AnchorQuery } from './line/line-anchors.js';
export type { LineStyle, LineToolContext } from './line/line-context.js';
export { lineEndAt } from './line/line-end.js';
export type { LineEnd, LineEndContext } from './line/line-end.js';
export { lineEndsOf, LineEndpoints } from './line/line-endpoints.js';
export type { LineEndIndex, LineEndpointContext } from './line/line-endpoints.js';
export { LineMode } from './line/line-mode.js';
export type { LineModeContext } from './line/line-mode.js';
export { ANCHOR_MARKER_PX, anchorMarkerRect, endpointHandleRects } from './line/line-overlay.js';
export { newLineObject } from './line/new-line-object.js';
export type { NewLineObject } from './line/new-line-object.js';
export { isToolId, TOOL_IDS } from './modes/tool-ids.js';
export { HandMode } from './modes/hand-mode.js';
export type { HandModeContext } from './modes/hand-mode.js';
export type { ToolId } from './modes/tool-ids.js';
export { TOOL_STEP_CONTINUE } from './modes/tool-mode.js';
export type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from './modes/tool-mode.js';
export * from './frame/frame-api.js';
export {
  FRAME_TITLE_BAND_PX,
  frameTitleAt,
  isAboveFrameTop,
  isOnFrameTitle,
} from './select/frame-title.js';
export {
  HANDLE_HIT_SIZE_PX,
  HANDLE_SIZE_PX,
  handleHitSizePx,
  handleLayout,
  hitHandle,
  RESIZE_HANDLES,
  TOUCH_HANDLE_HIT_SIZE_PX,
  TOUCH_HANDLE_INWARD_REACH_PX,
  touchCornerOutwardReachPx,
  touchInwardReachPx,
} from './select/handle-layout.js';
export type { HandlePlacement, ResizeAbility, ResizeHandle } from './select/handle-layout.js';
export { isMarqueeEligible } from './select/marquee-eligibility.js';
export {
  boxAround,
  boxCentreOf,
  boxCornersOf,
  boxPointToWorld,
  isInsideBox,
  normalizeAngle,
  rotateBoxAbout,
  rotatePointAbout,
  translateBox,
  worldPointToBox,
} from './select/oriented-box.js';
export type { OrientedBox } from './select/oriented-box.js';
export {
  DOUBLE_PRESS_DISTANCE_PX,
  DOUBLE_PRESS_INTERVAL_MS,
  DOUBLE_TAP_DISTANCE_PX,
  doublePressDistancePx,
  isDoublePress,
} from './select/double-press.js';
export type { PressStamp } from './select/double-press.js';
export {
  enteredChainOf,
  enteredScopeIds,
  isInsideEnteredGroup,
  outerGroupOf,
  scopeOfTarget,
  selectionOnEntering,
} from './select/entered-group.js';
export {
  EMPTY_OVERLAY,
  ENTERED_GROUP_COLOR,
  HANDLE_FILL,
  LOCK_BADGE_GAP_PX,
  LOCK_BADGE_SIZE_PX,
  LOCKED_COLOR,
  MARQUEE_FILL,
  OUTLINE_WIDTH_PX,
  overlayRectsOf,
  SELECTION_COLOR,
} from './select/overlay-rects.js';
export {
  HANDLE_EDGE_PX,
  SELECTION_FRAME_GAP_PX,
  SELECTION_FRAME_WIDTH_PX,
} from './select/styled-selection.js';
export type { OverlayRect, SelectionOverlayModel } from './select/overlay-rects.js';
export {
  dashedOutlineOf,
  dashWindowOf,
  GAP_TICK_PX,
  gapRunOf,
  LOCKED_DASH_GAP_PX,
  LOCKED_DASH_PX,
  MAX_LOCKED_DASHES,
} from './select/overlay-marks.js';
export { TEXT_HIGHLIGHT_ALPHA, textHighlightOf } from './select/overlay-palette.js';
export type { OverlayPalette, SelectionStyle } from './select/overlay-palette.js';
export {
  CONNECT_LABEL_TEXT,
  connectLabelOf,
  extentLabelOf,
  gapLabelsOf,
  LOCKED_LABEL_TEXT,
  lockedLabelOf,
  sizeLabelOf,
} from './select/overlay-label.js';
export type { OverlayLabel, OverlayLabelKind } from './select/overlay-label.js';
export {
  MAX_OUTLINED_OBJECTS,
  selectionOutlinesOf,
  type SelectionOutlines,
} from './select/selection-outlines.js';
export {
  COUNT_BADGE_GAP_PX,
  COUNT_BADGE_HEIGHT_PX,
  COUNT_BADGE_MARGIN_PX,
  countBadgeLayout,
  type CountBadgeLayout,
} from './select/count-badge.js';
export {
  createSelectionOverlayLayer,
  isSelectionOverlayModel,
} from './select/selection-overlay-layer.js';
export {
  FREE_RESIZE,
  isProportionalResize,
  resizeAspectOf,
  type ResizeAspect,
} from './select/resize-aspect.js';
export { MIN_RESIZE_SIZE, resizeFrame } from './select/resize-frame.js';
export { ROTATION_SNAP_STEP, rotationAngle } from './select/rotation-angle.js';
export {
  hitRotationBand,
  ROTATION_BAND_WIDTH_PX,
  rotationBandWidthPx,
  SELECTION_CORNERS,
  TOUCH_ROTATION_BAND_WIDTH_PX,
} from './select/rotation-band.js';
export type { SelectionCorner } from './select/rotation-band.js';
export type { RootMovePreview } from './select/root-move-preview.js';
export { SelectController } from './select/select-controller.js';
export type { SelectControllerOptions } from './select/select-controller-options.js';
export { ROTATE_CURSOR_STEPS, rotateCursorStepOf } from './select/select-cursor.js';
export type { RotateCursor, SelectCursor } from './select/select-cursor.js';
export type { SelectDrag } from './select/select-drag.js';
export { createSelectHitTester } from './select/select-hit-tester.js';
export type { PointHit, SelectHitTester } from './select/select-hit-tester.js';
export { MarqueeHits } from './select/marquee-hits.js';
export type { MarqueeSelect } from './select/marquee-hits.js';
export type {
  NudgeDirection,
  SelectInput,
  PointerSample,
  SelectPointer,
  SelectPointerType,
} from './select/select-input.js';
export type { SelectActivation, SelectIntent } from './select/select-intent.js';
export type { PressTarget, SelectToolContext } from './select/select-press.js';
export { selectSameTypeOf } from './select/select-same-type.js';
export type { SameTypeSource } from './select/select-same-type.js';
export {
  CLICK_THRESHOLD_PX,
  clickThresholdPx,
  IDLE_SELECT_TOOL,
  NUDGE_DISTANCE,
  NUDGE_LARGE_DISTANCE,
  stepSelectTool,
} from './select/select-tool.js';
export type { SelectToolState, SelectToolStep } from './select/select-tool.js';
export {
  farIds,
  farSkipOf,
  farSkipOfScope,
  nearIds,
  selectionScopeOf,
} from './select/far-objects.js';
export type { FarSkip, SelectionScope } from './select/far-objects.js';
export {
  groupsHoldingLocked,
  isResizable,
  localRectOf,
  orientedBoxOf,
  selectTargetOf,
  transformableIds,
  unlockedTopmostIds,
} from './select/selection-geometry.js';
export { selectionBoxOf, selectionFrameOf } from './select/selection-frame.js';
export type { SelectionSource } from './select/selection-geometry.js';
export { isLockedSelection, lockToggleOf } from './select/selection-lock.js';
export type { LockChange } from './select/selection-lock.js';
export { orderTargetOf } from './select/selection-order.js';
export type { OrderTarget } from './select/selection-order.js';
export { SELECTION_OVERLAY_STAGE_NAME, SelectionOverlay } from './select/selection-overlay.js';
export {
  EMPTY_SELECTION,
  isSameSelection,
  isSelected,
  selectionOf,
  toggleSelected,
  withoutObjects,
} from './select/selection-state.js';
export type { SelectionState } from './select/selection-state.js';
export { isLongPress, LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from './select/touch-gestures.js';
export type { DoubleTapFit, TouchCallbacks } from './select/touch-gestures.js';
export { planTransform, previewObjects, runTransformPlan } from './select/transform-plan.js';
export type { BoxPlacement, TransformPlan } from './select/transform-plan.js';
export * from './text/text-api.js';
export { editingSessionOf } from './modes/editing-session.js';
export * from './shape/shape-api.js';
export { newStickyObject, NOTE_SIZE, WIDE_NOTE_WIDTH } from './sticky/new-sticky-object.js';
export type { NewStickyObject } from './sticky/new-sticky-object.js';
export { DEFAULT_NOTE_COLOR, NOTE_COLORS, noteColorName } from './sticky/note-colors.js';
export type { NoteColor } from './sticky/note-colors.js';
export { STACK_GAP, stackedStickyOf } from './sticky/stack-sticky.js';
export { StickyMode } from './sticky/sticky-mode.js';
export { carriedLabelsOf } from './arrange/carried-labels.js';
export type { CarriedLabelsSource, RaiseDirection } from './arrange/carried-labels.js';
export type { StickyModeContext, StickyModeStart } from './sticky/sticky-mode.js';
export { ALL_SNAP_EDGES, guidesOf, snapBox } from './snap/snap-box.js';
export type { SnapEdge, SnapEdges, SnapGrid, SnapResult } from './snap/snap-box.js';
export { snapCandidatesNear } from './snap/snap-candidates.js';
export type { SnapCandidateQuery } from './snap/snap-candidates.js';
export { SNAP_GUIDE_COLOR } from './snap/snap-guide.js';
export { gapLabelOf, gapsOf } from './snap/snap-gap.js';
export type { SnapGap } from './snap/snap-gap.js';
export type { SnapGuide } from './snap/snap-guide.js';
export { snapPoint } from './snap/snap-point.js';
export type { SnappedPoint } from './snap/snap-point.js';
export { SNAP_THRESHOLD_PX, snapThresholdAt } from './snap/snap-threshold.js';
export { SNAPPING_OFF, snapMove } from './select/drag-snap.js';
export type {
  DragSnapContext,
  MoveIntent,
  ResizeIntent,
  SnappedDrag,
  SnapSettings,
  TransformIntent,
} from './select/drag-snap.js';
export { snapResize } from './select/resize-snap.js';
export { snapTransform } from './select/snap-transform.js';
export type { DragSnapRequest } from './select/snap-transform.js';
export type { SnapIndex } from './snap/snap-candidates.js';
export { SNAP_CANDIDATES_PER_BAND } from './snap/snap-candidates.js';
export { DragSnapper } from './select/drag-snapper.js';
export type { SnapView } from './select/drag-snapper.js';
export { constrain45 } from './pen/constrain-45.js';
// Every export of the network operations is public.
export * from './pen/network.js';
export { isEmptyNetworkEdit, networkEditOf } from './pen/network-edit.js';
export type { NetworkEdit } from './pen/network-edit.js';
export { continuationHandle, setHandle, toggleSmooth } from './pen/network-handles.js';
export {
  HANDLE_HIT_TOLERANCE_PX,
  hitFill,
  hitNetworkHandle,
  hitSegment,
  hitVertex,
  nearestVertex,
  isInsideEvenOdd,
  SEGMENT_HIT_TOLERANCE_PX,
  VERTEX_HIT_TOLERANCE_PX,
} from './pen/network-hit.js';
export type { HandleHit, SegmentHit } from './pen/network-hit.js';
export { splitSegment } from './pen/split-segment.js';
export type { SplitSegment } from './pen/split-segment.js';
export { networkOverlayRects, toWorld } from './pen/network-overlay.js';
export {
  HANDLE_TIP_SIZE_PX,
  OVERLAY_LINE_WIDTH_PX,
  VERTEX_SIZE_PX,
} from './pen/network-overlay.js';
export type { NetworkOverlayInput, PendingHandle } from './pen/network-overlay.js';
export { PATH_LOCKED_NOTICE, PathSession } from './pen/path-session.js';
export type { PathObject, PathWrite } from './pen/path-session.js';
export type { PenModeContext, PenSnapRequest, PenStyle } from './pen/pen-context.js';
export { NO_CHAIN, penBackspace, penDrag, penPress } from './pen/pen-gesture.js';
export type {
  PenChain,
  PenDrag,
  PenDragBase,
  PenPressStep,
  PenStep,
  PenTolerances,
} from './pen/pen-gesture.js';
export { PEN_DRAG_DEAD_ZONE_PX, PenMode } from './pen/pen-mode.js';
export type { PenModeStart, VectorEditFactory } from './pen/pen-mode.js';
export { VectorEditMode } from './pen/vector-edit-mode.js';
export type { PenFactory } from './pen/vector-edit-mode.js';
export { createPenMode, createVectorEditMode } from './pen/vector-modes.js';
export { penPressPoint, snapPenWorld } from './pen/pen-press-point.js';
export type { PenPressPoint, PenSnapping } from './pen/pen-press-point.js';
export { createPenSnapper } from './pen/pen-snapper.js';
