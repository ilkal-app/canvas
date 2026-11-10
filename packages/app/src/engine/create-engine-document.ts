import { yieldToBrowser } from '@canvas/collab';
import {
  createHistory,
  createRandomObjectId,
  type CommandError,
  type DocumentStore,
} from '@canvas/document';
import type { ObjectId, PageId, PrincipalId } from '@canvas/schema';

import { refusalNotice } from '../notices/refusal-notice.js';
import { createPageView, PAGE_SWITCH_SLICE_SIZE } from '../pages/create-page-view.js';
import { PageBoardStore } from '../pages/page-board-store.js';
import type { PageNavigator } from '../pages/page-navigator.js';
import { followBoardFonts } from '../text-input/follow-board-fonts.js';
import { PAGE_TEXT_LAYOUT } from '../text-input/page-fonts.js';

import type { CanvasInputContext } from './canvas-input-checks.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';
import { DocumentInputQueue } from './document-input-queue.js';
import { EngineDocument, type EngineDocumentOptions } from './engine-document.js';
import type { MountEngineOptions } from './mounted-engine.js';
import { TYPING_CAPTURE_WINDOW_MS } from './typing-undo-policy.js';

/** The document side of a mount: the engine document and its clipboard side. */
export interface EngineDocumentParts {
  /** The engine's document side: the scene feed, the select tool and history. */
  readonly document: EngineDocument;
  /** Copy, cut, the paste location and duplicate over the same document and selection. */
  readonly clipboard: DocumentClipboard;
  /** The pages: which one is shown, and the page commands. */
  readonly pages: PageNavigator;
  /**
   * The person's input that would write, in one order, held during a stepped run, and
   * where its checks read the board.
   */
  readonly input: { readonly queue: DocumentInputQueue; readonly context: CanvasInputContext };
}

/** What the mount gives the document side beside its options: see {@link createEngineDocument}. */
type MountDocumentServices = Pick<
  EngineDocumentOptions,
  | 'onContextMenu'
  | 'onDoubleTap'
  | 'pickImages'
  | 'panView'
  | 'viewCentre'
  | 'creationInk'
  | 'liveInk'
  | 'hasDesignTools'
> & {
  /** Sends what a page switch's slice changed to the renderer at once. */
  readonly afterPageSlice?: () => void;
};

/**
 * The document side of the engine host mount: the given store, or a new one holding the board
 * (`createDemoDocument`); the given history, or the local user's over the store, with the typing
 * capture window (`TYPING_CAPTURE_WINDOW_MS`, which the typing undo policy keeps to typing). What the mount
 * creates here is released when the document side is destroyed; what it was given is not.
 * Main thread.
 *
 * @param options - The mount's options.
 * @param onChange - Called when anything on screen changes.
 * @param services - Where the select tool's context menu and double-tap requests go, the image
 *   tool's picker, the hand tool's pan, the view's centre for the sticky tool's Enter, the
 *   viewer's theme for new strokes' and text's default colour, the live ink overlay, and
 *   whether the chrome has the design tools, and what sends a page switch's slice to the
 *   renderer at once.
 * @returns The engine's document side and its clipboard side.
 */
export function createEngineDocument(
  options: MountEngineOptions,
  onChange: () => void,
  services: MountDocumentServices = {},
): EngineDocumentParts {
  const { afterPageSlice, ...touch } = services;
  const releases: (() => void)[] = [];
  const store = options.store ?? createDemoDocument(options.board);
  if (options.store === undefined) {
    releases.push(() => {
      store.destroy();
    });
  }
  if (options.textLayout === PAGE_TEXT_LAYOUT) releases.unshift(followBoardFonts(store));
  const origin = options.origin ?? LOCAL_USER_ORIGIN;
  const history =
    options.history ?? ownHistory(store, origin.principalId, options.operatedWriters, releases);
  const environment = { clock: () => Date.now(), createId: createRandomObjectId };
  const { onNotice } = options;
  // The engine side sees one page; history and sync keep the whole board.
  const shown: { document?: EngineDocument } = {};
  const { view, pages, release } = createPageView(store, origin, environment, {
    onRefused: (errors) => onNotice?.(refusalNotice(errors)),
    ...(onNotice === undefined ? {} : { onNotice }),
    beforeSwitch: () => {
      shown.document?.tools.router.abandonActiveMode();
      shown.document?.selectTool.select([]);
    },
    // A 50k board's page is 10k objects: announced a slice per task. Each slice goes to
    // the renderer at once, not at the frame its tasks hold back.
    slicing: {
      ...{ sliceSize: PAGE_SWITCH_SLICE_SIZE, firstSliceSize: 500, yieldToBrowser },
      ...(afterPageSlice === undefined ? {} : { afterSlice: afterPageSlice }),
    },
  });
  releases.unshift(release);
  const board = new PageBoardStore(store, () => view.page); // Cross-page commands.
  const selection = (): readonly ObjectId[] => document.selectTool.selection.ids;
  const input = inputOf(store, () => view.page, selection, onNotice);
  const document = new EngineDocument({
    store: view,
    definitions: board,
    origin,
    history,
    environment,
    onChange,
    input,
    ...(onNotice === undefined
      ? {}
      : {
          onNotice,
          onCommandRefused: (errors: readonly CommandError[]) => {
            onNotice(refusalNotice(errors));
          },
        }),
    ...(options.onToolChange === undefined ? {} : { onToolChange: options.onToolChange }),
    ...(options.textLayout === undefined ? {} : { textLayout: options.textLayout }),
    ...touch,
    // "Go to main", and board search's results, show the object's page first.
    showPageOf: (id) => {
      const page = view.pageOf(id);
      if (page !== undefined && page !== pages.current()) pages.show(page);
    },
    release: () => {
      for (const release of releases) release();
    },
  });
  shown.document = document;
  const clipboard = new DocumentClipboard({
    store: view,
    origin,
    environment,
    controller: document.selectTool,
    canEdit: () => document.canEdit,
    deletions: document.panels.deletions, // A cut of a main with instances asks.
    board,
    ...(onNotice === undefined ? {} : { onNotice }),
  });
  return { document, clipboard, pages, input };
}

/**
 * A history the mount makes and releases: the local user's, with the typing capture window,
 * recording the remote changes of agents they operate too.
 *
 * @param store - The whole board.
 * @param principalId - The local user.
 * @param operatedWriters - Which client ids write for agents they operate, if any.
 * @param releases - Where its release goes, first.
 * @returns The history.
 */
function ownHistory(
  store: DocumentStore,
  principalId: PrincipalId,
  operatedWriters: MountEngineOptions['operatedWriters'],
  releases: (() => void)[],
): EngineDocumentOptions['history'] {
  const created = createHistory(store, principalId, {
    captureTimeout: TYPING_CAPTURE_WINDOW_MS,
    ...(operatedWriters === undefined ? {} : { operatedWriters }),
  });
  releases.unshift(() => {
    created.destroy();
  });
  return created;
}

/**
 * The person's input queue over the whole board, and where its checks read the board, the page
 * shown and the selection.
 *
 * @param store - The whole board.
 * @param page - The page shown now.
 * @param selection - The selection now.
 * @param onNotice - Where notices go.
 * @returns The queue and its checks' context.
 */
function inputOf(
  store: DocumentStore,
  page: () => PageId,
  selection: () => readonly ObjectId[],
  onNotice: ((message: string) => void) | undefined,
): EngineDocumentParts['input'] {
  const queue = new DocumentInputQueue({ store, onNotice: (message) => onNotice?.(message) });
  return { queue, context: { board: store, page, selection } };
}
