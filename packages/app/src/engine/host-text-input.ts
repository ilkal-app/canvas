import { worldToScreen, type Camera } from '@canvas/engine';
import { sessionCaretBox } from '@canvas/tools';

import { detectKeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { CanvasAction } from '../state/shell-action.js';
import { bindTextInput, type TextInputBridge } from '../text-input/text-input-bridge.js';

import type { EngineDocument } from './engine-document.js';

/**
 * Puts the text editor's hidden input beside a mount's canvas (`bindTextInput`), driving
 * the document side's text: the session being edited, the caret's place on screen at the camera
 * now, undo and redo (the typing step ends first), Escape, and bold and italic. A finger's tap on
 * the canvas keeps the editor's focus (`keepEditorFocusOnTap`). Main thread.
 *
 * @param canvas - The mount's canvas; the input goes in its container.
 * @param document - The engine's document side.
 * @param camera - The camera on screen now.
 * @param runAction - Where undo, redo and Escape go: the mount's input queue; the
 *   document side at once when absent.
 * @returns The bridge; `sync` after every change, `destroy` with the mount.
 */
export function attachTextInput(
  canvas: HTMLCanvasElement,
  document: EngineDocument,
  camera: () => Camera,
  runAction = (action: CanvasAction): void => {
    document.runCanvasAction(action, camera().zoom);
  },
): TextInputBridge {
  const container = canvas.parentElement ?? canvas.ownerDocument.body;
  const { text } = document.tools;
  const keepFocus = keepEditorFocusOnTap(canvas, () => text.session() !== undefined);
  const bridge = bindTextInput(
    container,
    {
      session: () => text.session(),
      caretOnScreen: () => {
        const session = text.session();
        const box = session && sessionCaretBox(session);
        if (box === undefined) return undefined;
        const view = camera();
        const { x, y } = worldToScreen(view, box);
        return {
          x: x + canvas.offsetLeft,
          y: y + canvas.offsetTop,
          height: box.height * view.zoom,
        };
      },
      run: (action) => {
        switch (action.kind) {
          case 'undo':
          case 'redo':
            // The typing step ends where the person pressed it, though the step may wait.
            text.policy.endStep();
            runAction({ type: 'history', command: action.kind });
            return;
          case 'escape':
            runAction({ type: 'selection', command: 'deselect' });
            return;
          case 'toggleBold':
          case 'toggleItalic':
          case 'toggleUnderline':
          case 'toggleStrikethrough':
            text.apply({ kind: action.kind });
            return;
          case 'indentList':
          case 'outdentList':
            text.apply({ kind: 'listLevel', delta: action.kind === 'indentList' ? 1 : -1 });
        }
      },
    },
    detectKeyboardPlatform(navigator.userAgent),
  );
  return {
    element: bridge.element,
    sync: () => {
      bridge.sync();
    },
    destroy: () => {
      keepFocus();
      bridge.destroy();
    },
  };
}

/**
 * Keeps the text editor's focus through a finger's or pen's tap on the canvas: the
 * browser sends the tap's compatibility `mousedown` after `pointerup`, when the tap has already
 * placed (or stacked) a note and focused its editor, and that mousedown's default would move
 * focus to the page and take the keyboard away. While a text is being edited, such a mousedown's
 * default is prevented; a mouse's own press (its `pointerdown` comes first) is left alone.
 *
 * @param canvas - The mount's canvas.
 * @param isEditing - Whether a text is being edited now.
 * @returns A function that removes the listeners.
 */
function keepEditorFocusOnTap(canvas: HTMLCanvasElement, isEditing: () => boolean): () => void {
  let pointerType = 'mouse';
  const onPointerDown = (event: PointerEvent): void => {
    ({ pointerType } = event);
  };
  const onMouseDown = (event: MouseEvent): void => {
    if (pointerType !== 'mouse' && isEditing()) event.preventDefault();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('mousedown', onMouseDown);
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('mousedown', onMouseDown);
  };
}
