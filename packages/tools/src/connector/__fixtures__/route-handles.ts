// Route handles over a board of two boxes and one connector between them, its id selected, for
// ConnectorRouteHandles' tests: previews, commands and refusals are recorded.
import { expect } from 'vitest';

import type { CommandError } from '@canvas/document';
import type { BoardObject, ConnectorObject, ObjectId, Point, PrincipalId } from '@canvas/schema';

import type { ToolPointerInput } from '../../modes/tool-mode.js';
import { rect } from '../../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  NOW,
  storeSource,
} from '../../select/__fixtures__/select-store.js';
import { ConnectorRouteHandles } from '../connector-route-handles.js';

/** The connector's id. */
export const ID = 'route' as ObjectId;

// From box a's right side (60, 30) to box b's left side (300, 230): the stubs end at x 84 and 276,
// so the elbow's middle piece runs upright, automatically at x 180, its handle at (180, 130).
/** Where the automatic middle piece's handle sits. */
export const AUTOMATIC = { x: 180, y: 130 };
/** Where the `from` end's stub ends, x. */
export const STUB_FROM = 84;
/** Where the `to` end's stub ends, x. */
export const STUB_TO = 276;

/**
 * The route's connector.
 *
 * @param extra - Fields to set.
 * @returns The connector.
 */
export function connectorOf(extra: Partial<ConnectorObject> = {}): ConnectorObject {
  return {
    id: ID,
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a2',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
    type: 'connector',
    from: { kind: 'object', objectId: 'a' as ObjectId, anchor: { x: 1, y: 0.5 } },
    to: { kind: 'object', objectId: 'b' as ObjectId, anchor: { x: 0, y: 0.5 } },
    route: 'elbow',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'none',
    label: null,
    ...extra,
  };
}

/**
 * A pointer input at a zoom.
 *
 * @param kind - The input's kind.
 * @param world - The point.
 * @param timeStamp - When, ms; none for null.
 * @param zoom - The zoom; 1 if absent.
 * @returns The input.
 */
export function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
  timeStamp: number | null = 0,
  zoom = 1,
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    screen: { x: world.x * zoom, y: world.y * zoom },
    world,
    ...(timeStamp !== null && { timeStamp }),
    isShiftPressed: false,
    isModPressed: false,
    zoom,
    snapping: { isEnabled: false, isGridVisible: false },
    camera: { x: 0, y: 0, zoom, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 },
  };
}

/**
 * The route handles over a board of two boxes and the connector, the connector selected.
 *
 * @param extra - The connector's fields.
 * @param options - Whether edits run through an undo capture, and whether the scene keeps drawing
 *   the connector as it was (a document that lost it refuses the write).
 * @param options.hasCapture - Through a capture; true if absent.
 * @param options.isStale - The source keeps the first connector; false if absent.
 * @returns The store, the editor, what was recorded and a setter for the selection.
 */
export function setUp(
  extra: Partial<ConnectorObject> = {},
  options: { hasCapture?: boolean; isStale?: boolean } = {},
) {
  const objects: BoardObject[] = [
    rect('a', null, { x: 0, y: 0, width: 60, height: 60 }),
    rect('b', null, { x: 300, y: 200, width: 60, height: 60 }),
    connectorOf(extra),
  ];
  const store = createSelectStore(objects);
  const record = {
    previews: new Map<ObjectId, BoardObject | undefined>(),
    commands: 0,
    refusals: [] as (readonly CommandError[])[],
  };
  let selection: readonly ObjectId[] = [ID];
  const live = storeSource(store);
  const shown = connectorOf(extra);
  const source = options.isStale
    ? { ...live, get: (id: ObjectId) => (id === ID ? shown : live.get(id)) }
    : live;
  const editor = new ConnectorRouteHandles({
    store,
    origin: ADA,
    environment: { clock: () => NOW, createId: () => 'unused' as ObjectId },
    ...(options.hasCapture !== false && {
      capture: {
        command: (run: () => void) => {
          record.commands += 1;
          run();
        },
      },
    }),
    setPreview: (id, object) => {
      record.previews.set(id, object);
    },
    onChange: () => undefined,
    onCommandRefused: (errors) => {
      record.refusals.push(errors);
    },
    source,
    selection: () => selection,
  });
  const connector = (): ConnectorObject | undefined => {
    const object = store.get(ID);
    return object?.type === 'connector' ? object : undefined;
  };
  const select = (ids: readonly ObjectId[]) => {
    selection = ids;
  };
  return { store, editor, record, connector, select };
}

/**
 * Drags from one point to another and releases there.
 *
 * @param editor - The editor.
 * @param from - The press.
 * @param to - The release.
 */
export function drag(editor: ConnectorRouteHandles, from: Point, to: Point): void {
  expect(editor.press(input('pointerDown', from), 1)).toBe(true);
  editor.follow(input('pointerMove', to));
  editor.follow(input('pointerUp', to));
}
