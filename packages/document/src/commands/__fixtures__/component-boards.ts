// Boards for the acceptance tests, seeded through the command layer: a main with four
// children ("the card"), a main of one sticky, instances of either, and two synced clients with
// fixed Yjs client ids. Everything here that touches a component goes through `mustFindCommand`,
// so on a base without components the seeding itself fails for the named reason.
import type { z } from 'zod';

import type { ObjectId, Point } from '@canvas/schema';

import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import { ADA, BODY, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { createObjectCommand, type createObjectInputSchema } from '../create-object.js';
import type { CommandEnvironment } from '../run-command.js';

import { applyCommand, testEnvironment } from './command-fixtures.js';
import { mustFindCommand, type Box } from './component-fixtures.js';

/** The `object` of a `createObject` input. */
export type NewObjectInput = z.input<typeof createObjectInputSchema>['object'];

/** The card main's box: 400 × 300 at (100, 100) on the board root. */
export const CARD_BOX: Box = { x: 100, y: 100, width: 400, height: 300 };

/** The card's children, world units relative to the card's origin. */
export const CARD_CHILD_BOXES = {
  /** A sticky at the top-left corner. */
  note: { x: 0, y: 0, width: 160, height: 160 },
  /** A rectangle along the top-right edge. */
  box: { x: 200, y: 0, width: 200, height: 100 },
  /** A text along the bottom-left edge. */
  caption: { x: 0, y: 200, width: 200, height: 100 },
  /** An image at the bottom-right corner. */
  photo: { x: 200, y: 150, width: 200, height: 150 },
} as const satisfies Readonly<Record<string, Box>>;

/** The ids of a seeded card: the main and its four children. */
export interface SeededMain {
  /** The component. */
  readonly mainId: string;
  /** The sticky child. */
  readonly noteId: string;
  /** The rectangle child. */
  readonly boxId: string;
  /** The text child. */
  readonly captionId: string;
  /** The image child. */
  readonly photoId: string;
}

/**
 * A sticky for `createObject`: fixed width, centred text "Note".
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the board root.
 * @param box - Its placement and size in the parent's frame.
 * @returns The `object` input.
 */
export function newSticky(id: string, parentId: string | null, box: Box): NewObjectInput {
  return {
    type: 'sticky',
    id,
    parentId,
    ...box,
    text: 'Note',
    runs: [{ length: 4, style: BODY }],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  };
}

/**
 * A red rectangle for `createObject`, without a stroke or label.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the board root.
 * @param box - Its placement and size in the parent's frame.
 * @returns The `object` input.
 */
export function newRectangle(id: string, parentId: string | null, box: Box): NewObjectInput {
  return {
    type: 'shape',
    id,
    parentId,
    ...box,
    kind: 'rectangle',
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A fixed-width text "Caption" for `createObject`.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the board root.
 * @param box - Its placement and size in the parent's frame.
 * @returns The `object` input.
 */
export function newText(id: string, parentId: string | null, box: Box): NewObjectInput {
  return {
    type: 'text',
    id,
    parentId,
    ...box,
    text: 'Caption',
    runs: [{ length: 7, style: BODY }],
    align: 'left',
    autoWidth: false,
    verticalAlign: 'top',
  };
}

/**
 * An uncropped, opaque image for `createObject`.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the board root.
 * @param box - Its placement and size in the parent's frame.
 * @returns The `object` input.
 */
export function newImage(id: string, parentId: string | null, box: Box): NewObjectInput {
  return {
    type: 'image',
    id,
    parentId,
    ...box,
    assetId: 'asset-photo',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { width: 800, height: 600 },
    opacity: 1,
  };
}

/**
 * A frame for `createObject`, white, not clipping.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the board root.
 * @param box - Its placement and size in the parent's frame.
 * @returns The `object` input.
 */
export function newFrame(id: string, parentId: string | null, box: Box): NewObjectInput {
  return {
    type: 'frame',
    id,
    parentId,
    ...box,
    name: id,
    clip: false,
    background: [1, 1, 1, 1],
  };
}

/**
 * A connector for `createObject`, from a free point in its own frame to an object.
 *
 * @param id - Its id.
 * @param targetId - The object its `to` end attaches to.
 * @param from - Its free start, in its own frame (at the board root, board units).
 * @returns The `object` input.
 */
export function newConnectorTo(id: string, targetId: string, from: Point): NewObjectInput {
  return {
    type: 'connector',
    id,
    parentId: null,
    x: 0,
    y: 0,
    from: { kind: 'point', ...from },
    to: { kind: 'object', objectId: targetId, anchor: null },
    route: 'straight',
    stroke: { color: [0.1, 0.1, 0.12, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
}

/**
 * A comment pin for `createObject`, anchored to an object at an offset in its frame.
 *
 * @param id - Its id.
 * @param targetId - The object it is pinned to.
 * @returns The `object` input.
 */
export function newCommentOn(id: string, targetId: string): NewObjectInput {
  return {
    type: 'comment',
    id,
    parentId: null,
    x: 0,
    y: 0,
    threadId: 'thread-card',
    anchor: { kind: 'object', objectId: targetId, offset: { x: 10, y: 10 } },
  };
}

/**
 * Creates one object through `createObject`.
 *
 * @param store - The store.
 * @param object - The object to create.
 * @param origin - Who creates it; Ada by default.
 * @param environment - The clock and ids; the default environment unless given.
 * @returns The new object's id.
 */
export function createChild(
  store: DocumentStore,
  object: NewObjectInput,
  origin: TransactionOrigin = ADA,
  environment: CommandEnvironment = testEnvironment(),
): ObjectId {
  return applyCommand(store, createObjectCommand, { object }, origin, environment).result.id;
}

/** What {@link seedMainWithChildren} takes. */
export interface SeedMainOptions {
  /** The prefix of the children's ids (`<prefix>-note`, ...) and the default main id. */
  readonly prefix?: string;
  /** The component's id; `main-<prefix>` by default. */
  readonly mainId?: string;
  /** The component's name; `Card` by default. */
  readonly name?: string;
  /** Who creates everything; Ada by default. */
  readonly origin?: TransactionOrigin;
  /** Where the card's origin goes on the board; {@link CARD_BOX}'s by default. */
  readonly at?: Point;
}

/**
 * Seeds the card: four root objects created with `createObject` (a sticky, a rectangle, a text
 * and an image at the corners of {@link CARD_BOX}), then `createComponent` over them, so the main
 * is at the selection's bounds and the children are inside it at {@link CARD_CHILD_BOXES}.
 *
 * @param store - The store.
 * @param options - The ids, name, origin and place.
 * @returns The main's and the children's ids.
 */
export function seedMainWithChildren(
  store: DocumentStore,
  options: SeedMainOptions = {},
): SeededMain {
  const { prefix = 'card', name = 'Card', origin = ADA } = options;
  const mainId = options.mainId ?? `main-${prefix}`;
  const at = options.at ?? { x: CARD_BOX.x, y: CARD_BOX.y };
  const onBoard = (box: Box): Box => ({ ...box, x: at.x + box.x, y: at.y + box.y });
  const ids = {
    noteId: `${prefix}-note`,
    boxId: `${prefix}-box`,
    captionId: `${prefix}-caption`,
    photoId: `${prefix}-photo`,
  };
  createChild(store, newSticky(ids.noteId, null, onBoard(CARD_CHILD_BOXES.note)), origin);
  createChild(store, newRectangle(ids.boxId, null, onBoard(CARD_CHILD_BOXES.box)), origin);
  createChild(store, newText(ids.captionId, null, onBoard(CARD_CHILD_BOXES.caption)), origin);
  createChild(store, newImage(ids.photoId, null, onBoard(CARD_CHILD_BOXES.photo)), origin);
  applyCommand(
    store,
    mustFindCommand('createComponent'),
    { ids: Object.values(ids), name, componentId: mainId },
    origin,
  );
  return { mainId, ...ids };
}

/**
 * Seeds a main of one sticky: a 160 × 160 sticky at `at`, wrapped in a component of that box.
 *
 * @param store - The store.
 * @param mainId - The component's id; its sticky is `<mainId>-leaf`.
 * @param at - Where the sticky, and so the main, goes on the board root.
 * @param origin - Who creates both; Ada by default.
 * @returns The sticky's id.
 */
export function seedLeafMain(
  store: DocumentStore,
  mainId: string,
  at: Point,
  origin: TransactionOrigin = ADA,
): ObjectId {
  const leafId = createChild(
    store,
    newSticky(`${mainId}-leaf`, null, { ...at, width: 160, height: 160 }),
    origin,
  );
  applyCommand(
    store,
    mustFindCommand('createComponent'),
    { ids: [leafId], name: mainId, componentId: mainId },
    origin,
  );
  return leafId;
}

/**
 * Places an instance through `createInstance`.
 *
 * @param store - The store.
 * @param componentId - The main.
 * @param input - The rest of the input: `x`, `y` (0 unless given), `instanceId`, `parentId`, ...
 * @param origin - Who places it; Ada by default.
 * @param environment - The clock and ids; the default environment unless given.
 * @returns The new instance's id.
 */
export function placeInstance(
  store: DocumentStore,
  componentId: string,
  input: Readonly<Record<string, unknown>> = {},
  origin: TransactionOrigin = ADA,
  environment: CommandEnvironment = testEnvironment(),
): ObjectId {
  const { result } = applyCommand(
    store,
    mustFindCommand('createInstance'),
    { componentId, x: 0, y: 0, ...input },
    origin,
    environment,
  );
  return (result as { readonly instanceId: ObjectId }).instanceId;
}

/**
 * Two synced stores with fixed Yjs client ids: Ada's is seeded by `seed`, Bob's gets its state.
 * The ids decide which concurrent write of one key wins, so the sync tests run both orders.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @param seed - Writes the board on Ada's store, through the command layer.
 * @returns Ada's store and Bob's.
 */
export function createComponentPair(
  adaClientId: number,
  bobClientId: number,
  seed: (ada: YjsDocumentStore) => void,
): [YjsDocumentStore, YjsDocumentStore] {
  const ada = new YjsDocumentStore({ clientId: adaClientId });
  seed(ada);
  const bob = new YjsDocumentStore({ clientId: bobClientId });
  bob.applyUpdate(ada.encodeState(), RELAY);
  return [ada, bob];
}
