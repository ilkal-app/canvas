// A text mode's context over a real document store, for the text mode's tests: the page's
// layout is the monospaced fake measurer (10 px text: 6 px a character, 12.5 px a line), undo
// grouping and previews are recorded, and ids are numbered.
import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import { layoutText } from '@canvas/engine';
import type {
  BoardObject,
  ObjectId,
  PrincipalId,
  StickyObject,
  TextObject,
  TextStyle,
} from '@canvas/schema';

import type { TextModeContext } from '../text-mode-context.js';

import { MONO_MEASURER } from './mono-layout.js';

/** Who types. */
export const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/** 10 px text, near-black. */
export const TEN: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 10,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

/** What the context recorded. */
export interface TextModeRecord {
  /** Undo grouping calls, in order: `typing:<session>:<word end>`, `command`, `endStep`. */
  readonly capture: string[];
  /** The preview shown per object. */
  readonly previews: Map<ObjectId, BoardObject | undefined>;
  /** Selections asked for. */
  readonly selected: (readonly ObjectId[])[];
  /** How many times the mode asked to end. */
  exitRequests: number;
  /** How many changes it reported. */
  changes: number;
}

/**
 * A text object at the origin in 10 px text.
 *
 * @param id - The id.
 * @param text - The characters.
 * @param overrides - Fields to change.
 * @returns The object.
 */
export function tenPointText(
  id: string,
  text: string,
  overrides: Partial<TextObject> = {},
): TextObject {
  return {
    id: id as ObjectId,
    type: 'text',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ADA.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: Math.max(1, text.length * 6),
    height: 12.5,
    text,
    runs: [{ length: text.length, style: TEN }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
    ...overrides,
  };
}

/**
 * A yellow 200 × 200 sticky note at the origin in 10 px text, centred both ways, as the sticky
 * tool makes one.
 *
 * @param id - The id.
 * @param text - The characters.
 * @param overrides - Fields to change.
 * @returns The note.
 */
export function tenPointNote(
  id: string,
  text: string,
  overrides: Partial<StickyObject> = {},
): StickyObject {
  return {
    ...tenPointText(id, text),
    type: 'sticky',
    width: 200,
    height: 200,
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
    ...overrides,
  };
}

/**
 * A context over a store holding some objects.
 *
 * @param objects - What the store starts with.
 * @returns The store, the context and what it records.
 */
export function createTextModeContext(objects: readonly BoardObject[] = []): {
  readonly store: YjsDocumentStore;
  readonly context: TextModeContext;
  readonly record: TextModeRecord;
} {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const record: TextModeRecord = {
    capture: [],
    previews: new Map(),
    selected: [],
    exitRequests: 0,
    changes: 0,
  };
  let nextId = 1;
  const context: TextModeContext = {
    store,
    origin: ADA,
    environment: {
      clock: () => 1_780_000_000_000,
      createId: () => `new-${String(nextId++)}` as ObjectId,
    },
    layout: {
      layout: ({ text, runs, wrapWidth, align, paragraphs }) =>
        layoutText(text, runs, wrapWidth, MONO_MEASURER, align, 'auto', paragraphs),
    },
    capture: {
      typing: (sessionId, run, isWordEnd) => {
        record.capture.push(`typing:${String(sessionId)}:${String(isWordEnd)}`);
        run();
      },
      command: (run) => {
        record.capture.push('command');
        run();
      },
      endStep: () => {
        record.capture.push('endStep');
      },
    },
    newTextStyle: () => TEN,
    setPreview: (id, object) => {
      record.previews.set(id, object);
    },
    selectObjects: (ids) => {
      record.selected.push(ids);
    },
    requestExit: () => {
      record.exitRequests += 1;
    },
    onChange: () => {
      record.changes += 1;
    },
    textAt: (world) => {
      for (const object of store.read().objects.values()) {
        if (object.type !== 'text' && object.type !== 'sticky') continue;
        const isInside =
          world.x >= object.x &&
          world.x <= object.x + object.width &&
          world.y >= object.y &&
          world.y <= object.y + object.height;
        if (isInside) return object.id;
      }
      return undefined;
    },
  };
  return { store, context, record };
}
