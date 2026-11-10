// One action of every kind and command the shell knows, for the tests of the edit gate.
// The records are typed by the command unions, so a new command fails to type-check
// here until it is listed.
import type { ObjectId } from '@canvas/schema';
import { TOOL_IDS } from '@canvas/tools';

import type {
  ArrangeCommand,
  HistoryCommand,
  NavigationCommand,
  SelectionCommand,
  ShellAction,
} from '../shell-action.js';

const SELECTION: Readonly<Record<SelectionCommand, true>> = {
  selectAll: true,
  selectSameType: true,
  deselect: true,
  delete: true,
  deleteAndHeal: true,
  duplicate: true,
  copy: true,
  cut: true,
  paste: true,
  toggleLock: true,
  activate: true,
  cropImageFill: true,
  toggleBold: true,
  toggleItalic: true,
  toggleUnderline: true,
  toggleStrikethrough: true,
};

const ARRANGE: Readonly<Record<ArrangeCommand, true>> = {
  group: true,
  ungroup: true,
  createComponent: true,
  bringForward: true,
  sendBackward: true,
  bringToFront: true,
  sendToBack: true,
  alignLeft: true,
  alignCentre: true,
  alignRight: true,
  alignTop: true,
  alignMiddle: true,
  alignBottom: true,
  distributeHorizontally: true,
  distributeVertically: true,
  tidyUp: true,
  stackSticky: true,
};

const NAVIGATION: Readonly<Record<NavigationCommand, true>> = {
  zoomIn: true,
  zoomOut: true,
  zoomToActualSize: true,
  zoomToFit: true,
  zoomToSelection: true,
  toggleGrid: true,
  toggleSnapping: true,
  toggleMinimap: true,
  previousPage: true,
  nextPage: true,
};

const HISTORY: Readonly<Record<HistoryCommand, true>> = { undo: true, redo: true };

/**
 * A link removed from one text's first character.
 *
 * @param id - The text.
 * @returns The action.
 */
function relinkOf(id: ObjectId): ShellAction {
  const targets = [{ id, ranges: [{ start: 0, end: 1 }] }];
  return { type: 'relinkText', targets, from: 'https://example.com/', link: null };
}

/**
 * Every shell action but `setEditable`: each tool selected and reselected, each command of each
 * kind, a nudge each way, a restyle, a layout change, a row's lock, a layers drop, each component command, the dialogs, the overlay and the layers
 * drawer.
 *
 * @param objectId - The object a restyle and a row's lock name.
 * @returns The actions, a new array.
 */
export function everyShellAction(objectId: ObjectId): ShellAction[] {
  const keys = <Command extends string>(record: Readonly<Record<Command, true>>): Command[] =>
    Object.keys(record) as Command[];
  return [
    ...TOOL_IDS.map((tool): ShellAction => ({ type: 'selectTool', tool })),
    ...TOOL_IDS.map((tool): ShellAction => ({ type: 'reselectTool', tool })),
    { type: 'setToolStyle', tool: 'sticky', style: { fill: [1, 0, 0, 1] } },
    ...keys(NAVIGATION).map((command): ShellAction => ({ type: 'navigate', command })),
    { type: 'frame', bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    { type: 'panCamera', deltaXPx: 10, deltaYPx: -4 },
    { type: 'zoomCamera', centerXPx: 400, centerYPx: 300, scale: 2 },
    ...keys(SELECTION).map((command): ShellAction => ({ type: 'selection', command })),
    ...keys(ARRANGE).map((command): ShellAction => ({ type: 'arrange', command })),
    ...keys(HISTORY).map((command): ShellAction => ({ type: 'history', command })),
    ...(['up', 'down', 'left', 'right'] as const).map((direction): ShellAction => ({
      type: 'nudge',
      direction,
      isLarge: false,
    })),
    { type: 'style', changes: [{ id: objectId, style: { fill: [0, 0, 1, 1] } }] },
    { type: 'layout', ids: [objectId], field: 'width', value: 40 },
    { type: 'toggleLockOf', ids: [objectId] },
    { type: 'placeLayers', ids: [objectId], parentId: null },
    { type: 'autoLayout', ids: [objectId], change: { kind: 'patch', patch: { gap: 8 } } },
    { type: 'fitToContent', id: objectId },
    { type: 'linkCard', id: objectId, change: { kind: 'toText' } },
    relinkOf(objectId),
    {
      type: 'replaceImage',
      id: objectId,
      assetId: 'asset-1',
      naturalSize: { width: 10, height: 10 },
    },
    { type: 'component', command: 'setOverride', id: objectId, path: 'a', override: { text: 'x' } },
    { type: 'component', command: 'resetOverrides', id: objectId },
    { type: 'component', command: 'detach', id: objectId },
    { type: 'component', command: 'placeInstance', id: objectId },
    { type: 'component', command: 'placeInstanceAt', id: objectId, at: { x: 0, y: 0 } },
    { type: 'component', command: 'rename', id: objectId, name: 'Card' },
    { type: 'component', command: 'setSwapOptions', id: objectId, options: ['check' as ObjectId] },
    { type: 'component', command: 'goToMain', id: objectId },
    { type: 'component', command: 'setVariant', id: objectId, variant: { state: 'hover' } },
    { type: 'component', command: 'setScale', id: objectId, scale: 2 },
    {
      type: 'component',
      command: 'setVariantAxes',
      id: objectId,
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
      renames: { values: [{ axis: 'state', from: 'on', to: 'hover' }] },
    },
    {
      type: 'component',
      command: 'setPreset',
      id: objectId,
      axis: 'state',
      value: 'hover',
      path: 'a',
      override: { isHidden: true },
    },
    { type: 'component', command: 'resetPreset', id: objectId, axis: 'state', value: 'hover' },
    { type: 'component', command: 'previewPreset', id: objectId, axis: 'state', value: 'hover' },
    { type: 'colorToken', command: 'set', name: 'Brand', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] },
    { type: 'colorToken', command: 'setValue', id: 'brand1', mode: 'dark', value: [0, 1, 0, 1] },
    { type: 'colorToken', command: 'rename', id: 'brand1', name: 'Brand 2' },
    { type: 'colorToken', command: 'delete', id: 'brand1' },
    { type: 'colorToken', command: 'reset', id: 'accent' },
    { type: 'toggleCheatSheet' },
    { type: 'closeCheatSheet' },
    { type: 'toggleDeveloperOverlay' },
    { type: 'toggleInspector' },
    { type: 'toggleCommentPlacing' },
    { type: 'toggleReactions' },
    { type: 'toolPanelKey', tool: 'draw', key: 'cycle', shouldChooseTool: true },
    { type: 'openToolPanel', panel: 'image' },
    { type: 'toggleLayersDrawer' },
    { type: 'openBoardSearch' },
    { type: 'focusSelectionPopover' },
    { type: 'toggleDeleteConnectors' },
  ];
}
