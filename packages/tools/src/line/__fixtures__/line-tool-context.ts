// A line tool's context over a real document store holding the select board (select-board.ts),
// for the line tool's and endpoint editing's tests: previews, selections, exit requests and
// refusals are recorded, and new ids are numbered.
import type { CommandError, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { indexOf, selectBoardObjects } from '../../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  NOW,
  storeSource,
} from '../../select/__fixtures__/select-store.js';
import type { LineStyle } from '../line-context.js';
import type { LineModeContext } from '../line-mode.js';

/** What the context recorded. */
export interface LineToolRecord {
  /** The preview shown per object; `undefined` once dropped. */
  readonly previews: Map<ObjectId, BoardObject | undefined>;
  /** Selections asked for. */
  readonly selected: (readonly ObjectId[])[];
  /** Refused commands' errors. */
  readonly refusals: (readonly CommandError[])[];
  /** Undo steps opened through `capture.command`. */
  commands: number;
  /** How many times the mode asked to end. */
  exitRequests: number;
}

/** The line tool's style in these tests: 2 wide, black, a plain straight line. */
export const PLAIN_STYLE: LineStyle = {
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'none',
  route: 'straight',
};

/**
 * A line tool context over the select board.
 *
 * @param style - The tool's style; {@link PLAIN_STYLE} by default.
 * @returns The store, the context and what it recorded.
 */
export function lineToolContext(style: LineStyle = PLAIN_STYLE): {
  readonly store: YjsDocumentStore;
  readonly context: LineModeContext;
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
  let nextId = 0;
  const context: LineModeContext = {
    store,
    origin: ADA,
    environment: {
      clock: () => NOW,
      createId: () => `new-${String((nextId += 1))}` as ObjectId,
    },
    capture: {
      command: (run) => {
        record.commands += 1;
        run();
      },
    },
    setPreview: (id, object) => {
      record.previews.set(id, object);
    },
    onChange: () => undefined,
    onCommandRefused: (errors) => {
      record.refusals.push(errors);
    },
    snapIndex: indexOf(objects),
    source: storeSource(store),
    lineStyle: () => style,
    selectObjects: (ids) => {
      record.selected.push(ids);
    },
    requestExit: () => {
      record.exitRequests += 1;
    },
  };
  return { store, context, record };
}
