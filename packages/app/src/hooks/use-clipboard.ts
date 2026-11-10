import { useEffect, useRef, type RefObject } from 'react';

import type { ClipboardAccess } from '../clipboard/clipboard-access.js';
import type { ClipboardMemory } from '../clipboard/clipboard-memory.js';
import { bindClipboardRouter, type ClipboardRouter } from '../clipboard/clipboard-router.js';
import type { ClipboardSource } from '../clipboard/clipboard-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { RecordedCanvasAction } from '../state/shell-reducer.js';

/**
 * What {@link useClipboard} may be given besides the shell's parts: whether the person may edit,
 * and what tests inject.
 */
export interface ClipboardOptions {
  /** Whether the person may edit: copy only while not. True if absent. */
  readonly canEdit?: boolean;
  /** The clipboard for copy, cut and paste asked for as actions; the async Clipboard API if absent. */
  readonly access?: ClipboardAccess;
  /** The page's own clipboard; the page's shared one if absent. */
  readonly memory?: ClipboardMemory;
  /** Receives an action that failed unexpectedly; the page's `reportError` if absent. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Reports an error to the page, as an uncaught error would be.
 *
 * @param error - The error.
 */
function reportPageError(error: unknown): void {
  reportError(error);
}

/**
 * The mounted engine as the clipboard's source.
 *
 * @param engine - The mounted engine.
 * @returns The source.
 */
function clipboardSourceOf(engine: MountedEngine): ClipboardSource {
  return {
    copy: () => engine.copySelection(),
    prepareCut: () => engine.prepareCut(),
    pasteTarget: () => engine.pasteTarget(),
  };
}

/**
 * The shell's clipboard: binds the clipboard router to the document for the native
 * shortcuts (copy, cut and paste events, off while `isEnabled` is false), and runs copy, cut and
 * paste actions dispatched by other means (a button, a menu) through the same router (`runAction`:
 * the async Clipboard API, the router's handlers, the page's memory). Duplicate is the engine's (it
 * never touches the clipboard).
 *
 * @param rootRef - The shell's root element.
 * @param engineRef - The mounted engine.
 * @param lastCanvasAction - The shell's latest canvas action; a new `sequence` is a new action.
 * @param isEnabled - Whether the canvas takes clipboard events (not while a dialog is open).
 * @param options - Another clipboard, memory and error sink, for tests.
 */
export function useClipboard(
  rootRef: RefObject<HTMLElement | null>,
  engineRef: RefObject<MountedEngine | undefined>,
  lastCanvasAction: RecordedCanvasAction | undefined,
  isEnabled: boolean,
  options: ClipboardOptions = {},
): void {
  const latestRef = useRef({ isEnabled, options });
  useEffect(() => {
    latestRef.current = { isEnabled, options };
  });
  const routerRef = useRef<ClipboardRouter | undefined>(undefined);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const { access, memory } = latestRef.current.options;
    const router = bindClipboardRouter(root, {
      source: () => {
        const engine = engineRef.current;
        return engine === undefined ? undefined : clipboardSourceOf(engine);
      },
      isEnabled: () => latestRef.current.isEnabled,
      canEdit: () => latestRef.current.options.canEdit !== false,
      ...(access === undefined ? {} : { access: () => access }),
      ...(memory === undefined ? {} : { memory }),
    });
    routerRef.current = router;
    return () => {
      router.destroy();
      routerRef.current = undefined;
    };
  }, [rootRef, engineRef]);

  const handledSequenceRef = useRef(0);
  useEffect(() => {
    if (lastCanvasAction === undefined) return;
    if (lastCanvasAction.sequence <= handledSequenceRef.current) return;
    handledSequenceRef.current = lastCanvasAction.sequence;
    const { action } = lastCanvasAction;
    if (action.type !== 'selection') return;
    const { command } = action;
    if (command !== 'copy' && command !== 'cut' && command !== 'paste') return;
    const { onError = reportPageError } = latestRef.current.options;
    routerRef.current?.runAction(command).catch(onError);
  }, [lastCanvasAction]);
}
