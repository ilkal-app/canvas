import { isEditableTarget } from '../focus/editable-target.js';

import { createBrowserClipboardAccess, type ClipboardAccess } from './clipboard-access.js';
import { runClipboardAction, type ClipboardActionCommand } from './clipboard-actions.js';
import { PAGE_CLIPBOARD_MEMORY, type ClipboardMemory } from './clipboard-memory.js';
import { isOverPasteLimit, TOO_LARGE_NOTICE } from './clipboard-notice.js';
import type { ClipboardSource } from './clipboard-source.js';
import { DEFAULT_PASTE_HANDLERS } from './default-paste-handlers.js';
import { embeddedAttributeOf } from './html-flavour.js';
import { sourceBoardOf } from './linked-paste.js';
import type { PasteHandlerRegistry, PasteItem, PasteTarget } from './paste-handlers.js';

/** What the router needs besides the shell's root. */
export interface ClipboardRouterOptions {
  /** The engine's clipboard side, or `undefined` while no engine runs. */
  readonly source: () => ClipboardSource | undefined;
  /** Whether the canvas takes clipboard events now (not while a dialog is open). */
  readonly isEnabled: () => boolean;
  /**
   * Whether the person may edit the board now: while not, a cut or a paste is left to
   * the browser, which does nothing with the canvas, and copy still works. True if absent.
   */
  readonly canEdit?: () => boolean;
  /** The paste handlers; `DEFAULT_PASTE_HANDLERS` if absent. */
  readonly handlers?: PasteHandlerRegistry;
  /** The system clipboard for actions; the async Clipboard API, made when first needed, if absent. */
  readonly access?: () => ClipboardAccess;
  /** The page's own clipboard; `PAGE_CLIPBOARD_MEMORY` if absent. */
  readonly memory?: ClipboardMemory;
}

/** A shell's bound clipboard router. */
export interface ClipboardRouter {
  /**
   * Runs copy, cut or paste asked for as an action (a button, a menu) through the system
   * clipboard, with the router's handlers and memory; nothing while the shell is disabled or no
   * engine runs.
   *
   * @param command - Copy, cut or paste.
   * @returns Settles when done.
   */
  runAction(command: ClipboardActionCommand): Promise<void>;
  /** Removes the listeners. */
  destroy(): void;
}

/**
 * The shells on the page with a router bound, the one used last at the end: a clipboard event
 * whose target is the page itself (focus on the body) goes to that shell alone.
 */
const boundRoots: HTMLElement[] = [];

/** The mouse button that pans the view, and on Linux pastes the primary selection on release. */
const MIDDLE_BUTTON = 1;

/**
 * Makes a shell the one page-level clipboard events go to.
 *
 * @param root - The shell's root.
 */
function activate(root: HTMLElement): void {
  const index = boundRoots.indexOf(root);
  if (index !== -1) boundRoots.splice(index, 1);
  boundRoots.push(root);
}

/**
 * Tells whether a clipboard event is this shell's: its target is inside the shell, or it is the
 * page itself and this shell was used last.
 *
 * @param root - The shell's root.
 * @param target - The event's target.
 * @returns Whether the shell handles it.
 */
function isOwnEvent(root: HTMLElement, target: EventTarget | null): boolean {
  if (target instanceof Node && root.contains(target)) return true;
  const document = root.ownerDocument;
  const isPageLevel =
    target === document || target === document.body || target === document.documentElement;
  return isPageLevel && boundRoots.at(-1) === root;
}

/**
 * The items of a paste: every string flavour, then every file.
 *
 * @param data - The event's clipboard data.
 * @returns The items.
 */
function pasteItemsOf(data: DataTransfer): PasteItem[] {
  const strings = [...data.types]
    .filter((type) => type !== 'Files')
    .map((type): PasteItem => ({ kind: 'string', type, data: data.getData(type) }));
  const files = [...data.files].map((file): PasteItem => ({ kind: 'file', type: file.type, file }));
  return [...strings, ...files];
}

/** The pastes of one router, in order: each supersedes the one before. */
interface PasteSequence {
  /**
   * Begins a paste.
   *
   * @returns Whether it is still the latest: false once a later one began or the router ended.
   */
  begin(): () => boolean;
  /** Ends the router: no paste is current any more. */
  end(): void;
}

/**
 * The pastes of one router: a large paste still being read in stages stops once a later one
 * begins, or the router ends.
 *
 * @returns The sequence.
 */
function createPasteSequence(): PasteSequence {
  let latest = 0;
  let isEnded = false;
  return {
    begin: () => {
      const mine = (latest += 1);
      return () => !isEnded && latest === mine;
    },
    end: () => {
      isEnded = true;
    },
  };
}

/**
 * Offers a paste's items to the handlers, at the source's paste location with the board the
 * items were copied from (`sourceBoardOf`, worked out on its first read), and tells the person
 * when nothing was pasted because a flavour was over its limit.
 *
 * @param handlers - The paste handlers.
 * @param source - The engine's clipboard side.
 * @param items - The paste's items.
 * @param isCurrent - Whether the paste is still the router's latest (`PasteTarget.isCurrent`); a
 *   superseded paste pastes nothing.
 * @param isPlainText - Whether the person asked for plain text (Mod+Shift+V).
 * @returns Whether the paste was handled (or refused as too large).
 */
function pasteItems(
  handlers: PasteHandlerRegistry,
  source: ClipboardSource,
  items: readonly PasteItem[],
  isCurrent: () => boolean,
  isPlainText = false,
): boolean {
  // A paste a later one superseded while its clipboard was read pastes nothing.
  if (!isCurrent()) return false;
  // The source board is read only by a paste that links images (`createLinkedPaste`): without a
  // board flavour it means parsing the whole HTML, 11 ms of a 1,000-object paste, so it
  // is worked out on its first read, at most once.
  const read: { isDone: boolean; board?: string | undefined } = { isDone: false };
  const target: PasteTarget = {
    ...source.pasteTarget(),
    isCurrent,
    isPlainText,
    get sourceBoard() {
      if (!read.isDone) read.board = sourceBoardOf(items, embeddedAttributeOf);
      read.isDone = true;
      return read.board;
    },
  };
  if (handlers.dispatch(items, target)) return true;
  const isTooLarge = items.some(
    (item) => item.kind === 'string' && isOverPasteLimit(item.type, item.data),
  );
  if (isTooLarge) target.notify(TOO_LARGE_NOTICE.message);
  return isTooLarge;
}

/**
 * Drops the paste a middle-button release on the shell's canvas makes: on Linux the
 * browser pastes the primary selection where the middle button is released, which after a
 * middle-button pan would drop whatever text was last selected anywhere onto the board. Chrome
 * makes that paste on mouse-up, after the event handlers, in the same task as the pointerup; so a
 * pointerup on the canvas arms the drop until the next task (a message, which the scenario
 * suite's frozen clock does not hold back), and a paste in that window is stopped before the
 * router (a capturing listener on the document) with its default prevented. A paste later on (a
 * menu's, the system's) is never touched, nor a release that made no paste, nor a middle-click
 * into a text field. Pointer events, not mouse events: the camera cancels the middle button's
 * pointerdown, which suppresses the mouse events.
 *
 * @param root - The shell's root.
 * @returns Stops listening.
 */
function dropMiddleReleasePaste(root: HTMLElement): () => void {
  const document = root.ownerDocument;
  const nextTask = new MessageChannel();
  let isArmed = false;
  nextTask.port1.onmessage = () => {
    isArmed = false;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button !== MIDDLE_BUTTON || !(event.target instanceof HTMLCanvasElement)) return;
    isArmed = true;
    nextTask.port2.postMessage(undefined);
  };
  const onPaste = (event: Event): void => {
    if (!isArmed) return;
    isArmed = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  root.addEventListener('pointerup', onPointerUp, { capture: true });
  document.addEventListener('paste', onPaste, { capture: true });
  return () => {
    root.removeEventListener('pointerup', onPointerUp, { capture: true });
    document.removeEventListener('paste', onPaste, { capture: true });
    nextTask.port1.close();
  };
}

/**
 * Notes Mod+Shift+V: the browser's plain-text paste fires a paste event that does not
 * say so, so the chord is noted on its way down and read once by the paste that follows.
 *
 * @param document - The page.
 * @returns Whether the next paste is plain text (read once), and how to stop listening.
 */
function trackPlainPasteChord(document: Document): {
  readonly take: () => boolean;
  readonly stop: () => void;
} {
  let isPlainNext = false;
  const onKeyDown = (event: KeyboardEvent): void => {
    // By the key's place: Option on a Mac, whose Chrome pastes plain text on ⌥⇧⌘V, changes the
    // character it types.
    isPlainNext =
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      (event.code === 'KeyV' || event.key.toLowerCase() === 'v');
  };
  document.addEventListener('keydown', onKeyDown, { capture: true });
  return {
    take: () => {
      const isPlain = isPlainNext;
      isPlainNext = false;
      return isPlain;
    },
    stop: () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    },
  };
}

/**
 * The router's clipboard events and actions ({@link bindClipboardRouter}, which adds the drop of
 * a middle-button release's paste).
 *
 * @param root - The shell's root element.
 * @param options - The engine's clipboard side, whether the shell is enabled, the handlers.
 * @returns The router.
 */
function bindClipboardEvents(root: HTMLElement, options: ClipboardRouterOptions): ClipboardRouter {
  const document = root.ownerDocument;
  const handlers = options.handlers ?? DEFAULT_PASTE_HANDLERS;
  const memory = options.memory ?? PAGE_CLIPBOARD_MEMORY;
  const pastes = createPasteSequence();
  const paste = (source: ClipboardSource, items: readonly PasteItem[], isCurrent: () => boolean) =>
    pasteItems(handlers, source, items, isCurrent);
  const plainChord = trackPlainPasteChord(document);
  const accepts = (event: ClipboardEvent): boolean =>
    !event.defaultPrevented &&
    event.clipboardData !== null &&
    options.isEnabled() &&
    !isEditableTarget(event.target) &&
    isOwnEvent(root, event.target);
  const canEdit = (): boolean => options.canEdit?.() !== false;
  const onCopyOrCut = (event: ClipboardEvent): void => {
    const source = options.source();
    if (source === undefined || !accepts(event) || (event.type === 'cut' && !canEdit())) return;
    const cut = event.type === 'cut' ? source.prepareCut() : undefined;
    if (cut?.kind === 'refused') {
      event.preventDefault();
      source.pasteTarget().notify(cut.message);
      return;
    }
    const flavours =
      cut === undefined ? source.copy() : cut.kind === 'ready' ? cut.flavours : undefined;
    if (flavours === undefined) return;
    event.preventDefault();
    for (const [type, data] of flavours) event.clipboardData?.setData(type, data);
    memory.remember(flavours, true);
    if (cut?.kind === 'ready') cut.remove();
  };
  const onPaste = (event: ClipboardEvent): void => {
    const source = options.source();
    if (source === undefined || event.clipboardData === null || !accepts(event)) return;
    if (!canEdit()) return;
    const items = pasteItemsOf(event.clipboardData);
    const isHandled = pasteItems(handlers, source, items, pastes.begin(), plainChord.take());
    if (isHandled) event.preventDefault();
  };
  const onUse = (): void => {
    activate(root);
  };
  activate(root);
  document.addEventListener('copy', onCopyOrCut);
  document.addEventListener('cut', onCopyOrCut);
  document.addEventListener('paste', onPaste);
  root.addEventListener('pointerdown', onUse, { capture: true });
  root.addEventListener('focusin', onUse);
  return {
    runAction: async (command) => {
      const source = options.source();
      if (source === undefined || !options.isEnabled()) return;
      if (command !== 'copy' && !canEdit()) return;
      const access = (options.access ?? createBrowserClipboardAccess)();
      // Begun before the clipboard is read, so a paste event meanwhile supersedes this one.
      const isCurrent = command === 'paste' ? pastes.begin() : () => true;
      await runClipboardAction(command, {
        source,
        access,
        memory,
        paste: (items) => void paste(source, items, isCurrent),
        notify: (notice) => {
          source.pasteTarget().notify(notice.message);
        },
      });
    },
    destroy: () => {
      pastes.end();
      document.removeEventListener('copy', onCopyOrCut);
      document.removeEventListener('cut', onCopyOrCut);
      document.removeEventListener('paste', onPaste);
      plainChord.stop();
      root.removeEventListener('pointerdown', onUse, { capture: true });
      root.removeEventListener('focusin', onUse);
      const index = boundRoots.indexOf(root);
      if (index !== -1) boundRoots.splice(index, 1);
    },
  };
}

/**
 * The window-level clipboard router of a shell (copy, paste and duplicate): copy, cut and paste
 * arrive as the document's clipboard events (the shortcuts are native: only these events can read
 * the clipboard, `DEFAULT_SHORTCUTS`). The router leaves an event alone when its target is editable
 * (a text field, the text editor's input, which stops propagation of its own), when something
 * handled it already, while the shell is disabled, and when it belongs to another shell on the
 * page; a cut or a paste too while the person cannot edit (`canEdit`). Copy writes the
 * selection's flavours and keeps the browser from writing its own; with nothing to copy the
 * browser's default runs. Cut writes them and then deletes what it copied; a refused cut (a locked
 * object) writes nothing and tells the person (through the engine's paste target, `notify`). Every
 * copy is also kept in the page's memory. A paste goes to the paste handlers
 * (`registerPasteHandler`); when one takes it, the browser's default is prevented. A flavour over
 * its paste limit is skipped; when nothing was pasted and a flavour was over, the person is told.
 * The same handlers and memory serve copy, cut and paste asked for as actions (`runAction`). The
 * paste a middle-button release makes on Linux is dropped first (`dropMiddleReleasePaste`,
 *). Main thread.
 *
 * @param root - The shell's root element.
 * @param options - The engine's clipboard side, whether the shell is enabled, the handlers.
 * @returns The router.
 */
export function bindClipboardRouter(
  root: HTMLElement,
  options: ClipboardRouterOptions,
): ClipboardRouter {
  const stopDropping = dropMiddleReleasePaste(root);
  const router = bindClipboardEvents(root, options);
  return {
    ...router,
    destroy: () => {
      router.destroy();
      stopDropping();
    },
  };
}
