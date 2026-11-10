// A connector tool's context over a real document store holding the select board
// (select-board.ts), for the connector tool's tests: previews, selections, exit requests and
// refusals are recorded, new ids are numbered, and `objectAt` answers from the board's index as
// the app's does (the topmost object, not a connector, a comment or a frame's open area).
import type { YjsDocumentStore } from '@canvas/document';
import { hitPoint } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import type { LineToolRecord } from '../../line/__fixtures__/line-tool-context.js';
import { indexOf, mapSource, selectBoardObjects } from '../../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  NOW,
  storeSource,
} from '../../select/__fixtures__/select-store.js';
import type { ConnectorModeContext, ConnectorStyle } from '../connector-context.js';

/** The connector tool's style in these tests: 2 wide, black, straight, an arrow at the end. */
export const ARROW_STYLE: ConnectorStyle = {
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  route: 'straight',
};

/**
 * A connector tool context over the select board.
 *
 * @param style - The tool's style; {@link ARROW_STYLE} by default.
 * @param hasCapture - Whether edits run through an undo capture (the app's), counted.
 * @returns The store, the context and what it recorded.
 */
export function connectorToolContext(
  style: ConnectorStyle = ARROW_STYLE,
  hasCapture = true,
): {
  readonly store: YjsDocumentStore;
  readonly context: ConnectorModeContext;
  readonly record: LineToolRecord;
} {
  const objects = selectBoardObjects();
  const store = createSelectStore(objects);
  const record: LineToolRecord = {
    previews: new Map(),
    selected: [],
    refusals: [],
    commands: 0,
    exitRequests: 0,
  };
  const index = indexOf(objects);
  const hitSource = mapSource(objects);
  let nextId = 0;
  const context: ConnectorModeContext = {
    store,
    origin: ADA,
    environment: {
      clock: () => NOW,
      createId: () => `new-${String((nextId += 1))}` as ObjectId,
    },
    ...(hasCapture && {
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
    snapIndex: index,
    source: storeSource(store),
    connectorStyle: () => style,
    objectAt: (world, zoom) =>
      hitPoint(index, hitSource, world, { zoom }).find((id) => {
        const type = hitSource.get(id)?.type;
        return type !== 'connector' && type !== 'comment' && type !== 'frame';
      }),
    selectObjects: (ids) => {
      record.selected.push(ids);
    },
    requestExit: () => {
      record.exitRequests += 1;
    },
  };
  return { store, context, record };
}
