import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type {
  BoardObject,
  ConnectorObject,
  LineObject,
  ObjectId,
  ShapeObject,
  TextObject,
} from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleContext } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { voteContext, type BoardVote } from '../voting/vote-context.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

const POINT_BASE = {
  parentId: null,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 300,
  y: 250,
};
const BASE = {
  ...POINT_BASE,
  width: 100,
  height: 100,
};
const LABEL = {
  text: 'Hello',
  runs: [
    {
      length: 5,
      style: {
        fontFamily: 'Lora',
        fontSize: 16,
        color: [0.1, 0.2, 0.3, 1],
        weight: 400,
        italic: false,
      },
    },
  ],
};
/** A labelled, stroked rectangle with a fixed box. */
export const SHAPE = {
  ...BASE,
  id: 'shape-1' as ObjectId,
  type: 'shape',
  kind: 'rectangle',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  fill: [1, 0, 0, 1],
  cornerRadius: 0,
  sides: 4,
  label: LABEL,
} as ShapeObject;
/** A second shape with different fill, stroke and kind. */
export const SHAPE_2 = {
  ...SHAPE,
  id: 'shape-2' as ObjectId,
  x: 420,
  kind: 'ellipse',
  stroke: { color: [0, 0, 1, 1], width: 4 },
  fill: null,
} as ShapeObject;
/** A bound connector whose endpoints must survive route changes. */
export const CONNECTOR = {
  ...POINT_BASE,
  id: 'connector-1' as ObjectId,
  type: 'connector',
  from: { kind: 'object', objectId: SHAPE.id, anchor: null },
  to: { kind: 'point', x: 100, y: 50 },
  route: 'elbow',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'triangle',
  label: LABEL,
} as ConnectorObject;
/** A connector with a different route, width and ends. */
export const CONNECTOR_2 = {
  ...CONNECTOR,
  id: 'connector-2' as ObjectId,
  x: 420,
  stroke: { color: [0, 0, 1, 1], width: 4 },
  route: 'straight',
  startCap: 'circle',
  endCap: 'circle',
} as ConnectorObject;
/** A legacy line with no label or curved route. */
export const LINE = {
  ...POINT_BASE,
  id: 'line-1' as ObjectId,
  type: 'line',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
  route: 'straight',
  stroke: { color: [1, 0, 0, 1], width: 1 },
  startCap: 'none',
  endCap: 'none',
} as LineObject;
/** A text object for mixed group selections. */
export const TEXT = {
  ...BASE,
  id: 'text-1' as ObjectId,
  type: 'text',
  verticalAlign: 'top',
  text: LABEL.text,
  runs: LABEL.runs,
  align: 'left',
  autoWidth: true,
} as TextObject;
/** The selected shape label's text style. */
export const TEXT_STYLE: TextStyleContext = {
  style: { fontFamily: 'Lora', fontSize: 16, color: [0.1, 0.2, 0.3, 1] },
  align: 'left',
  isEditing: false,
};

let frames: FrameRequestCallback[] = [];

/** Fixes placement measurements and queued animation frames for a jsdom case. */
export function preparePopover(): void {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
}

/**
 * Makes props whose engine stores the selected objects.
 *
 * @param selection - The selected objects.
 * @param overrides - Props varied by the case, including the proposed label handler.
 * @returns Popover props.
 */
export function propsOf(
  selection: readonly BoardObject[],
  overrides: Partial<SelectionPopoverProps> & {
    onEditLabel?: ((id: ObjectId) => void) | undefined;
    onSectionTimer?: ((id: ObjectId) => void) | undefined;
  } = {},
): SelectionPopoverProps {
  const store = new YjsDocumentStore({ clientId: 628 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of selection) transaction.setObject(object);
  });
  const engine = new FakeMountedEngine(
    document.createElement('canvas'),
    { store },
    Promise.resolve(),
  );
  engine.currentCamera = {
    x: 0,
    y: 0,
    zoom: 1,
    viewportWidthPx: 1000,
    viewportHeightPx: 800,
    dpr: 1,
  };
  return {
    engine,
    camera: createCameraSource(),
    selection,
    canEdit: true,
    isEditingText: false,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch: vi.fn(),
    textStyle: TEXT_STYLE,
    onTextStyle: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the Selection toolbar with comments enabled and completes placement.
 *
 * @param props - The selection and handlers.
 * @param vote - The board's vote context, if present.
 * @param canComment - Whether the person may comment.
 * @returns The toolbar.
 */
export function mount(
  props: SelectionPopoverProps,
  vote?: BoardVote,
  canComment = true,
): HTMLElement {
  const data = {
    connection: { store: { read: () => ({ objects: new Map() }) } },
    selectedId: undefined,
    placement: undefined,
    place: vi.fn(),
  } as unknown as CommentData;
  const mode = {
    isPlacing: false,
    canWrite: canComment,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  } satisfies CommentMode;
  render(
    <voteContext.Provider value={vote}>
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={data}>
          <main>
            <canvas />
            <SelectionPopover {...props} />
          </main>
        </commentDataContext.Provider>
      </commentContext.Provider>
    </voteContext.Provider>,
  );
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
  return canComment || props.canEdit
    ? screen.getByRole('toolbar', { name: 'Selection' })
    : document.body;
}

/**
 * Returns button names and divider markers in DOM order.
 *
 * @param toolbar - The Selection toolbar.
 * @returns Names and markers.
 */
export function rowOf(toolbar: HTMLElement): (string | null)[] {
  return [...toolbar.querySelectorAll('button, [data-popover-divider]')].map((element) =>
    element.hasAttribute('data-popover-divider') ? '|' : element.getAttribute('aria-label'),
  );
}
