// The tool router over the demo document, with stand-in tool modes. The text tool's mode in
// Chrome: tooling/scenario/specs/tools/text-*.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import {
  SELECTION_COLOR,
  SNAPPING_OFF,
  type SelectionOverlayModel,
  type ToolId,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from '@canvas/tools';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';
import { SelectToolMode } from './modes/select-mode.js';
import type { ScreenPointerInput } from './select-input-binding.js';

/** The demo board's first rectangle: world (50, 50), 70 × 60. */
const MARKER = 'section-0-rect-0-0' as ObjectId;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const CARET = { box: { x: 1, y: 2, width: 1, height: 10, rotation: 0 }, color: SELECTION_COLOR };

/** A stand-in mode that records its input and answers with the steps it is given. */
class RecordingMode implements ToolMode {
  readonly id = 'text' as const;
  readonly cursor = 'text' as const;
  readonly pointers: ToolPointerInput[] = [];
  readonly keys: ToolKeyInput[] = [];
  isExited = false;
  constructor(
    private readonly steps: ToolStep[] = [],
    private readonly isKeyUsed = true,
  ) {}
  onPointer(input: ToolPointerInput): ToolStep {
    this.pointers.push(input);
    return this.steps.shift() ?? { isDone: false };
  }
  onKey(input: ToolKeyInput): boolean {
    this.keys.push(input);
    return this.isKeyUsed;
  }
  overlay(): Partial<SelectionOverlayModel> {
    return { toolRects: [CARET] };
  }
  exit(): void {
    this.isExited = true;
  }
}

function setUp() {
  const store = createDemoDocument();
  const onToolChange = vi.fn();
  const shown: unknown[] = [];
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: () => undefined,
    onToolChange,
  });
  document.attach({ enqueue: () => undefined, showOverlay: (model) => shown.push(model) });
  const at = (kind: 'pointerDown' | 'pointerUp', x: number, y: number, timeStamp = 0) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
      timeStamp,
    };
    document.handlePointer(input, CAMERA);
  };
  return { document, onToolChange, shown, at };
}

describe('ToolRouter', () => {
  it('gives the primary button to the active tool mode instead of the select tool', () => {
    const { document, at } = setUp();
    const mode = new RecordingMode();
    document.tools.router.registerToolMode('text', () => mode);
    document.setActiveTool('text');
    at('pointerDown', 60, 60);
    expect(mode.pointers).toEqual([expect.objectContaining({ kind: 'pointerDown', zoom: 1 })]);
    expect(document.inspect().selectedIds).toEqual([]);
    expect(document.cursor()).toBe('text');
  });

  it('hands a mode the person’s snapping with each press, none until it is set', () => {
    const { document, at } = setUp();
    const mode = new RecordingMode();
    document.tools.router.registerToolMode('text', () => mode);
    document.setActiveTool('text');
    at('pointerDown', 60, 60);
    const snapping = { isEnabled: true, isGridVisible: true };
    document.setSnapping(snapping);
    at('pointerUp', 60, 60);
    expect(mode.pointers).toEqual([
      expect.objectContaining({ kind: 'pointerDown', snapping: SNAPPING_OFF }),
      expect.objectContaining({ kind: 'pointerUp', snapping }),
    ]);
  });

  it('hands back to select when the mode finishes, passing the input on when asked', () => {
    const { document, at, onToolChange } = setUp();
    const mode = new RecordingMode([{ isDone: true, isPassedOn: true }]);
    document.tools.router.registerToolMode('text', () => mode);
    document.setActiveTool('text');
    at('pointerDown', 60, 60);
    expect(mode.isExited).toBe(true);
    expect(onToolChange).toHaveBeenCalledWith('select');
    expect(document.inspect().selectedIds).toEqual([MARKER]);
    expect(document.tools.router.activeTool).toBe('select');
    expect(document.tools.router.activeMode).toBeInstanceOf(SelectToolMode);
  });

  it('ends the mode when another tool is chosen, and keeps a mode already active for its tool', () => {
    const { document } = setUp();
    const factory = vi.fn(() => new RecordingMode());
    document.tools.router.registerToolMode('text', factory);
    document.setActiveTool('text');
    document.setActiveTool('text');
    expect(factory).toHaveBeenCalledTimes(1);
    const mode = document.tools.router.activeMode as RecordingMode;
    document.setActiveTool('select');
    expect(mode.isExited).toBe(true);
    expect(document.cursor()).toBe('default');
  });

  it('starts the mode registered for an object type on a double-click and on Enter', () => {
    const { document, at, onToolChange } = setUp();
    const modes: RecordingMode[] = [];
    document.tools.router.registerActivation('shape', (activation, object) => {
      expect(object.id).toBe(activation.id);
      const mode = new RecordingMode();
      modes.push(mode);
      return mode;
    });
    at('pointerDown', 60, 60, 1000);
    at('pointerUp', 60, 60, 1050);
    at('pointerDown', 61, 60, 1200);
    at('pointerUp', 61, 60, 1250);
    expect(modes).toHaveLength(1);
    expect(onToolChange).toHaveBeenLastCalledWith('text');
    document.setActiveTool('select');
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(modes).toHaveLength(2);
    expect(modes[0]?.isExited).toBe(true);
  });

  it('says which objects an activation would edit: unlocked, of a type with a mode', () => {
    const { document } = setUp();
    const { router } = document.tools;
    const frame = 'section-0' as ObjectId;
    // A frame's name is edited by the frame tool's mode.
    expect(router.canActivate(frame)).toBe(true);
    // A shape's label is edited by the shape tool's mode, unless the shape is locked.
    expect(router.canActivate(MARKER)).toBe(true);
    document.panels.toggleLock([MARKER, frame]);
    expect(router.canActivate(frame)).toBe(false);
    expect(router.canActivate(MARKER)).toBe(false);
    expect(router.canActivate('gone' as ObjectId)).toBe(false);
  });

  it('offers canvas keys to the mode first, and the select tool takes what it declines', () => {
    const { document, at } = setUp();
    const declining = new RecordingMode([], false);
    at('pointerDown', 60, 60);
    at('pointerUp', 60, 60);
    document.tools.router.registerToolMode('text', () => declining);
    document.setActiveTool('text');
    document.runCanvasAction({ type: 'nudge', direction: 'left', isLarge: false }, 1);
    expect(declining.keys).toEqual([{ kind: 'nudge', direction: 'left', isLarge: false }]);
    expect(document.inspect().selectedObjects[0]).toMatchObject({ x: 9 });
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(declining.keys.at(-1)).toEqual({ kind: 'escape' });
  });

  it("lays the mode's overlay over the select tool's, tool rectangles appended", () => {
    const { document, shown } = setUp();
    document.tools.router.registerToolMode('text', () => new RecordingMode());
    document.setActiveTool('text');
    expect(shown.at(-1)).toMatchObject({ frame: undefined, toolRects: [CARET] });
    document.destroy();
  });

  it('hands a lost pointer to the mode, and ends it without passing the input on', () => {
    const { document, at, onToolChange } = setUp();
    const mode = new RecordingMode([{ isDone: false }, { isDone: true }]);
    document.tools.router.registerToolMode('text', () => mode);
    document.setActiveTool('text');
    document.handlePointer({ kind: 'pointerCancel' }, CAMERA);
    expect(mode.pointers).toEqual([{ kind: 'pointerCancel' }]);
    at('pointerDown', 60, 60);
    expect(mode.isExited).toBe(true);
    expect(onToolChange).toHaveBeenCalledWith('select');
    expect(document.inspect().selectedIds).toEqual([]);
  });

  it('gives actions that are not keys to the select tool while a mode is active', () => {
    const { document } = setUp();
    const mode = new RecordingMode();
    mode.overlay = () => ({});
    document.tools.router.registerToolMode('text', () => mode);
    document.setActiveTool('text');
    expect(document.tools.router.overlay().toolRects).toEqual([]);
    expect(document.runCanvasAction({ type: 'history', command: 'undo' }, 1)).toBe(true);
    expect(mode.keys).toEqual([]);
  });
});

/**
 * A stand-in mode with sub-tools: it offers `switchTo`'s answer for a tool (`onToolSwitch`).
 */
class SubToolMode implements ToolMode {
  readonly cursor = 'default' as const;
  switchTo: Partial<Record<ToolId, ToolMode>> = {};
  isExited = false;
  constructor(readonly id: ToolId) {}
  onPointer(): ToolStep {
    return { isDone: false };
  }
  onKey(): boolean {
    return false;
  }
  overlay(): Partial<SelectionOverlayModel> {
    return {};
  }
  onToolSwitch(tool: ToolId): ToolMode | undefined {
    return this.switchTo[tool];
  }
  exit(): void {
    this.isExited = true;
  }
}

describe('ToolRouter: sub-tools and modes the toolbar did not start', () => {
  /**
   * The router with a text-tool mode whose V switch hands over to a move sub-tool that shows
   * the select tool, as the pen and vector editing do.
   *
   * @returns The document, the two modes and the shell's tool-change spy.
   */
  function withSubTools() {
    const { document, onToolChange } = setUp();
    const { router } = document.tools;
    const drawing = new SubToolMode('text');
    const moving = new SubToolMode('select');
    drawing.switchTo = { select: moving };
    moving.switchTo = { text: drawing };
    router.registerToolMode('text', () => drawing);
    document.setActiveTool('text');
    return { document, router, drawing, moving, onToolChange };
  }

  it('offers a toolbar tool to the active mode first, which carries on as the mode it returns', () => {
    const { document, router, drawing, moving, onToolChange } = withSubTools();
    document.setActiveTool('select');
    expect(router.activeMode).toBe(moving);
    expect(router.activeTool).toBe('select');
    expect(drawing.isExited).toBe(false);
    expect(onToolChange).not.toHaveBeenCalled();
    document.setActiveTool('text');
    expect(router.activeMode).toBe(drawing);
    expect(moving.isExited).toBe(false);
  });

  it('tells the shell the tool a mode keeps instead of the one asked for', () => {
    const { document, router, drawing, onToolChange } = withSubTools();
    drawing.switchTo = { select: drawing };
    document.setActiveTool('select');
    expect(router.activeMode).toBe(drawing);
    expect(router.activeTool).toBe('text');
    expect(onToolChange).toHaveBeenCalledWith('text');
  });

  it('ends the mode as usual when it offers nothing for the tool', () => {
    const { document, router, drawing } = withSubTools();
    drawing.switchTo = {};
    document.setActiveTool('select');
    expect(drawing.isExited).toBe(true);
    expect(router.activeMode).toBeInstanceOf(SelectToolMode);
  });

  it('ends a switched-to mode showing the select tool on Escape, but never the select tool’s own', () => {
    const { document, router, moving, onToolChange } = withSubTools();
    document.setActiveTool('select');
    router.finishActiveMode();
    expect(moving.isExited).toBe(true);
    const select = router.activeMode;
    expect(select).toBeInstanceOf(SelectToolMode);
    expect(onToolChange).toHaveBeenLastCalledWith('select');
    router.finishActiveMode();
    expect(router.activeMode).toBe(select);
  });

  it('leaves the switched-to mode on the Select button pressed again, not on its key', () => {
    const { document, router, moving } = withSubTools();
    document.setActiveTool('select');
    // The key: the shell's tool is already the select tool, so the router keeps the mode.
    document.setActiveTool('select');
    expect(router.activeMode).toBe(moving);
    // The button pressed again, of another tool than the active one: nothing.
    expect(document.runCanvasAction({ type: 'reselectTool', tool: 'text' }, 1)).toBe(true);
    expect(router.activeMode).toBe(moving);
    document.runCanvasAction({ type: 'reselectTool', tool: 'select' }, 1);
    expect(moving.isExited).toBe(true);
    const select = router.activeMode;
    expect(select).toBeInstanceOf(SelectToolMode);
    // The select tool's own mode carries on.
    document.runCanvasAction({ type: 'reselectTool', tool: 'select' }, 1);
    expect(router.activeMode).toBe(select);
  });
});
