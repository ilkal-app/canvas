import {
  findCommand,
  type CommandEnvironment,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { firstPageIdOf } from '@canvas/schema';

import { PageIndex } from './page-index.js';
import { PageNavigator, type PageNavigatorOptions } from './page-navigator.js';
import { PageScopedStore } from './page-scoped-store.js';

/**
 * How many objects one task of a page switch announces in the app after its first slice of 500:
 * a 50k board's 10k-object page in three more tasks. Each task costs about as
 * much as the first, within the 100 ms freeze budget, and fewer tasks mean fewer frames between
 * them, which keeps the switch within its 500 ms.
 */
export const PAGE_SWITCH_SLICE_SIZE = 3_200;

/** A board as one page shows it, the pages' model, and what releases them. */
export interface PageView {
  /** The board as the page shown has it (`PageScopedStore`). */
  readonly view: PageScopedStore;
  /** The pages and the page commands. */
  readonly pages: PageNavigator;
  /** Stops both following the board. */
  readonly release: () => void;
}

/**
 * Shows a board one page at a time: the page index, the page-scoped store over it,
 * starting on the first page, and the pages' model running page commands as `origin`.
 *
 * @param store - The whole board.
 * @param origin - Who page commands are attributed to.
 * @param environment - Their clock and ids.
 * @param callbacks - Where refusals go, what a switch does first, and how it is sliced.
 * @returns The view, the pages and the release.
 */
export function createPageView(
  store: DocumentStore,
  origin: TransactionOrigin,
  environment: CommandEnvironment,
  callbacks: Pick<PageNavigatorOptions, 'onRefused' | 'onNotice' | 'beforeSwitch' | 'slicing'>,
): PageView {
  const first = firstPageIdOf({ objects: new Map(), pages: store.readPages() });
  const view = new PageScopedStore(store, new PageIndex(store), first);
  const pages = new PageNavigator({ store, view, origin, environment, findCommand, ...callbacks });
  return {
    view,
    pages,
    release: () => {
      pages.destroy();
      view.destroy();
    },
  };
}
