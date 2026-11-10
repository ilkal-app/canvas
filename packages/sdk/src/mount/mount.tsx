import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  AppShell,
  createLocalBoardConnection,
  setFontFileResolver,
  type BoardConnection,
  type ChromeFontSet,
  type HelpLinks,
} from '@canvas/app';

import { createCanvasDocument, type CanvasDocument } from '../document/canvas-document.js';
import {
  changeEventOf,
  createCanvasEventHub,
  type CanvasEventHub,
  type CanvasEvents,
  type CanvasListener,
} from '../events/canvas-events.js';

import { DEFAULT_FONTS_URL, FONT_FILE_SCHEME, fontFileUrl, fontsFolder } from './fonts-url.js';

/** Where a mounted board keeps its content (v0 is local only). */
export type BoardPersistence =
  /** Nowhere: the board lives in memory and is gone when the instance is destroyed. */
  | 'memory'
  /** On the device, in IndexedDB, under its board id: the board is there again next time. */
  | 'device';

/** The board's theme: light (Vellum), dark (Graphite), or whichever the system prefers. */
export type CanvasTheme = 'light' | 'dark' | 'system';

/** What {@link mount} is given besides the element. */
export interface MountOptions {
  /**
   * The board's id: the key a device board is kept under. A memory board's id only names it.
   * `board` if absent.
   */
  readonly boardId?: string;
  /** Where the board keeps its content; `memory` if absent. */
  readonly persistence?: BoardPersistence;
  /** The theme to start in; the system's if absent. Changed later with `setTheme`. */
  readonly theme?: CanvasTheme;
  /**
   * The fonts the board's chrome is set in; the shell's own, open Geist and Geist Mono
   * (`NEUTRAL_CHROME_FONTS`), if absent. Changed later with `setChromeFonts`.
   */
  readonly chromeFonts?: ChromeFontSet;
  /**
   * Where the board's font files are served from: a folder holding the `@ilkal/fonts` package's
   * files (copied from its npm package into the host's public folder, say), absolute or relative
   * to the page, such as `/fonts/`. jsDelivr's copy of `@ilkal/fonts` at this SDK's version,
   * `https://cdn.jsdelivr.net/npm/@ilkal/fonts@<version>/`, if absent. The fonts are the page's,
   * shared by every board on it: give every board on a page the same `fontsUrl`.
   */
  readonly fontsUrl?: string;
  /** Where the board menu's Help and feedback goes; no Help and feedback if absent. */
  readonly helpLinks?: HelpLinks;
  /**
   * Receives errors from the start, before `mount` resolves (a device board's storage failing
   * to open), as an `error` listener added then would; the page's `reportError` if absent and no
   * `error` listener is added later.
   */
  readonly onError?: CanvasListener<'error'>;
}

/** A board mounted in a host element, as {@link mount} returns it. */
export interface CanvasInstance {
  /** The board's id. */
  readonly boardId: string;
  /** The board's objects and the commands that change them. */
  readonly document: CanvasDocument;
  /**
   * Listens to the board's changes, the person's selection, or its errors.
   *
   * @param type - `change`, `selection` or `error`.
   * @param listener - Called with each event of that type.
   * @returns A function that stops listening.
   */
  on<Type extends keyof CanvasEvents>(type: Type, listener: CanvasListener<Type>): () => void;
  /**
   * Changes the board's theme now, as the person's own choice in its menu would.
   *
   * @param theme - The theme.
   */
  setTheme(theme: CanvasTheme): void;
  /**
   * Changes the fonts the board's chrome is set in now.
   *
   * @param fonts - The fonts.
   */
  setChromeFonts(fonts: ChromeFontSet): void;
  /** Unmounts the board and closes its storage; the element is left empty. Idempotent. */
  destroy(): void;
}

/** The id a board is given when the host gives none. */
const DEFAULT_BOARD_ID = 'board';

/**
 * Where the page's font files are fetched from: the host's `fontsUrl`, or jsDelivr's copy of the
 * fonts package. Read before the board opens, so a `fontsUrl` that is not a URL refuses the mount
 * with nothing opened; set on the page only once it has opened, so a mount that fails leaves the
 * page's fonts where they were. Unbuilt, the fonts are named where they are served, and stay so.
 *
 * @param fontsUrl - The host's `fontsUrl`, if any.
 * @returns Points the page's font files there; does nothing unbuilt.
 * @throws {TypeError} When `fontsUrl` is not a URL.
 */
function fontFilesLocator(fontsUrl: string | undefined): () => void {
  const scheme = FONT_FILE_SCHEME;
  const url = fontsUrl ?? DEFAULT_FONTS_URL;
  if (scheme === undefined || url === undefined) return () => undefined;
  const folder = fontsFolder(url, document.baseURI);
  return () => {
    setFontFileResolver((named) => fontFileUrl(named, scheme, folder));
  };
}

/**
 * Opens a local board, empty, with no font catalogue, its storage's failures sent as errors.
 *
 * @param boardId - The board's id.
 * @param persistence - Where it is kept; in memory if absent.
 * @param events - Where its errors go.
 * @param onOpen - Called once it has opened, not when it fails.
 * @returns The board's connection.
 */
async function openLocalBoard(
  boardId: string,
  persistence: BoardPersistence | undefined,
  events: CanvasEventHub,
  onOpen: () => void,
): Promise<BoardConnection> {
  const connection = await createLocalBoardConnection(boardId, {
    shouldSeedDemoBoard: false,
    // No font service: only the SDK's own fonts (`fontsUrl`), and no request for a catalogue.
    hasFontCatalogue: false,
    ...(persistence === 'device' ? {} : { openCache: () => Promise.resolve(undefined) }),
    onError: (error) => {
      events.emit('error', { source: 'storage', error });
    },
  });
  onOpen();
  return connection;
}

/**
 * Puts a canvas board into a host element: the whole editing shell, with a board of its
 * own. v0 is local only: one person, no network but the font files (from `fontsUrl`, no font
 * catalogue); the board starts empty and lives in memory unless `persistence: 'device'` keeps it
 * in IndexedDB under its id. Each instance has its own document, shell state, theme, events and
 * React root, so two on one page share nothing.
 *
 * @param element - The host element; the board fills it.
 * @param options - The board's id, where it is kept, its theme and fonts, where the font files
 *   are served from, the help links.
 * @returns The mounted board, once its storage has opened and its engine has mounted with the
 *   undo history (or failed to start, which is sent as an error).
 * @throws {TypeError} When `fontsUrl` is not a URL (as a rejection).
 */
export async function mount(
  element: HTMLElement,
  options: MountOptions = {},
): Promise<CanvasInstance> {
  const boardId = options.boardId ?? DEFAULT_BOARD_ID;
  const locateFontFiles = fontFilesLocator(options.fontsUrl);
  const events = createCanvasEventHub();
  if (options.onError !== undefined) events.on('error', options.onError);
  const connection = await openLocalBoard(boardId, options.persistence, events, locateFontFiles);
  const stopChanges = connection.store.subscribe((changes) => {
    events.emit('change', changeEventOf(changes));
  });
  // Resolves once the shell's engine has mounted with its undo history, so a command run as soon
  // as `mount` resolves is one the person can undo; or once the engine has failed to start.
  let markMounted = (): void => undefined;
  const isMounted = new Promise<void>((resolve) => {
    markMounted = resolve;
  });
  const root = createRoot(element);
  let theme: CanvasTheme = options.theme ?? 'system';
  let chromeFonts = options.chromeFonts;
  const render = (): void => {
    root.render(
      <StrictMode>
        <AppShell
          connection={connection}
          initialThemePreference={theme}
          // The theme is this board's own: a change on one board leaves the host's others, and
          // the host's storage, alone; `setTheme` changes it.
          themeScope="shell"
          // The address bar is the host's: the board never writes or reads `?page=` in it.
          isPageInAddress={false}
          {...(chromeFonts === undefined ? {} : { chromeFonts })}
          {...(options.helpLinks === undefined ? {} : { helpLinks: options.helpLinks })}
          onSelectionChange={(ids) => {
            events.emit('selection', { ids });
          }}
          onThemePreferenceChange={(preference) => {
            // The person's choice in the board menu becomes the shell's starting preference,
            // so a later `setTheme` is always a change the shell follows.
            if (preference === theme) return;
            theme = preference;
            render();
          }}
          onEngineMount={markMounted}
          onEngineError={(error) => {
            events.emit('error', { source: 'engine', error });
            markMounted();
          }}
        />
      </StrictMode>,
    );
  };
  render();
  await isMounted;
  let isDestroyed = false;
  return {
    boardId,
    document: createCanvasDocument(connection.store, connection.origin),
    on: (type, listener) => events.on(type, listener),
    setTheme(next) {
      if (isDestroyed || next === theme) return;
      theme = next;
      render();
    },
    setChromeFonts(fonts) {
      if (isDestroyed || fonts === chromeFonts) return;
      chromeFonts = fonts;
      render();
    },
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      stopChanges();
      root.unmount();
      connection.destroy();
      events.clear();
    },
  };
}
