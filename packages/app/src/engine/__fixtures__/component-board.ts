// A board with components for the app's tests, seeded through the command layer (the
// document's own component fixtures are private to it): a main "Badge" of one outlined dot, and
// a main "Card" holding a title text, an outlined body rectangle, a sticky, an image and an
// instance of the badge; then an instance of the card, on the first page or on a second one.
import {
  findCommand,
  runCommand,
  YjsDocumentStore,
  type CommandEnvironment,
  type DocumentStore,
} from '@canvas/document';
import type { ObjectId, PageId, TextStyle } from '@canvas/schema';

import { LOCAL_USER_ORIGIN } from '../demo-document.js';

/** The text style of the card's title and sticky. */
const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  weight: 400,
  italic: false,
};

/**
 * A fixed clock and ids `id-1`, `id-2`, … for the commands the fixture and its tests run.
 *
 * @returns The environment.
 */
export function componentEnvironment(): CommandEnvironment {
  let next = 1;
  return {
    clock: () => 1_790_000_000_000,
    createId: () => `id-${String(next++)}` as ObjectId,
  };
}

/**
 * Runs a command by name as the local user, and fails the test when it is refused.
 *
 * @param store - The document.
 * @param name - The command.
 * @param input - Its input.
 * @param environment - The clock and ids.
 * @returns The command's result.
 * @throws {Error} When there is no such command, or it is refused.
 */
export function mustRun(
  store: DocumentStore,
  name: string,
  input: unknown,
  environment: CommandEnvironment = componentEnvironment(),
): unknown {
  const command = findCommand(name);
  if (command === undefined) throw new Error(`no command ${name}`);
  const outcome = runCommand(store, LOCAL_USER_ORIGIN, command, input as never, environment);
  if (outcome.status !== 'applied') throw new Error(`${name} refused: ${JSON.stringify(outcome)}`);
  return outcome.result;
}

/** A box: placement and size in the parent's frame, world units. */
interface Box {
  /** Left. */
  readonly x: number;
  /** Top. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/**
 * Creates a rectangle through `createObject`.
 *
 * @param store - The document.
 * @param id - Its id.
 * @param parentId - Its parent, or null for the board root.
 * @param box - Where it goes.
 * @param isOutlined - Whether it has a black outline, 2 wide.
 */
export function createRectangle(
  store: DocumentStore,
  id: string,
  parentId: string | null,
  box: Box,
  isOutlined = false,
): void {
  const stroke = isOutlined ? { color: [0, 0, 0, 1], width: 2 } : null;
  mustRun(store, 'createObject', {
    object: {
      ...{ type: 'shape', id, parentId, ...box, kind: 'rectangle', stroke, fill: [1, 0, 0, 1] },
      ...{ cornerRadius: 0, sides: 4, label: null },
    },
  });
}

/**
 * Creates the card's title, sticky and image through `createObject`.
 *
 * @param store - The document.
 */
function createCardContent(store: DocumentStore): void {
  const text = { runs: [{ length: 5, style: BODY }], autoWidth: false, verticalAlign: 'top' };
  const objects = [
    {
      ...{ type: 'text', id: 'title', parentId: null, x: 100, y: 100, width: 200, height: 40 },
      ...{ ...text, text: 'Title', align: 'left' },
    },
    {
      ...{ type: 'sticky', id: 'note', parentId: null, x: 320, y: 100, width: 120, height: 120 },
      ...{ ...text, text: 'Notes', align: 'center', color: [1, 0.92, 0.55, 1] },
    },
    {
      ...{ type: 'image', id: 'photo', parentId: null, x: 320, y: 240, width: 80, height: 60 },
      ...{ assetId: 'asset-photo', naturalSize: { width: 800, height: 600 }, opacity: 1 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
  ];
  for (const object of objects) mustRun(store, 'createObject', { object });
}

/** What {@link createComponentBoard} made. */
export interface ComponentBoard {
  /** The whole board. */
  readonly store: YjsDocumentStore;
  /** The first page. */
  readonly firstPageId: PageId;
  /** The page the card's instance is on: the first, or a second page. */
  readonly instancePageId: PageId;
}

/**
 * Seeds the board: `badge` (child `dot`), `card` (children `title`, `body`, `note`, `photo` and
 * `badge-in-card`, an instance of the badge), and `inst`, an instance of the card at (100, 600).
 *
 * @param options - Where the card's instance goes.
 * @param options.isInstanceOnSecondPage - Whether it goes on a new second page.
 * @returns The board and its pages.
 */
export function createComponentBoard(
  options: { readonly isInstanceOnSecondPage?: boolean } = {},
): ComponentBoard {
  const store = new YjsDocumentStore();
  createRectangle(store, 'dot', null, { x: 700, y: 100, width: 20, height: 20 }, true);
  mustRun(store, 'createComponent', { ids: ['dot'], name: 'Badge', componentId: 'badge' });
  createRectangle(store, 'body', null, { x: 100, y: 160, width: 200, height: 100 }, true);
  createCardContent(store);
  mustRun(store, 'createInstance', {
    componentId: 'badge',
    x: 420,
    y: 120,
    instanceId: 'badge-in-card',
  });
  mustRun(store, 'createComponent', {
    ids: ['title', 'body', 'note', 'photo', 'badge-in-card'],
    name: 'Card',
    componentId: 'card',
  });
  const firstPageId = [...store.readPages().keys()][0] ?? ('page-1' as PageId);
  let instancePageId = firstPageId;
  if (options.isInstanceOnSecondPage === true) {
    instancePageId = (mustRun(store, 'addPage', {}) as { pageId: PageId }).pageId;
  }
  mustRun(store, 'createInstance', {
    componentId: 'card',
    x: 100,
    y: 600,
    instanceId: 'inst',
    pageId: instancePageId,
  });
  return { store, firstPageId, instancePageId };
}
