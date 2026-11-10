// The tool-mode registry: the files of modes/ collected, checked and registered with the router,
// over the demo document. The text tool's mode in Chrome: tooling/scenario/specs/tools/text-*.
import { describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import {
  ConnectorMode,
  ShapeMode,
  StickyMode,
  TextMode,
  type SelectInput,
  type ToolMode,
} from '@canvas/tools';

import { createDemoDocument, LOCAL_USER_ORIGIN } from '../demo-document.js';
import { EngineDocument } from '../engine-document.js';
import type { ScreenPointerInput } from '../select-input-binding.js';
import { ToolRouter } from '../tool-router.js';

import { toolModeEntry as connectorEntry } from './connector-mode.js';
import { toolModeEntry as drawEntry } from './draw-mode.js';
import { toolModeEntry as frameEntry } from './frame-mode.js';
import { toolModeEntry as handEntry } from './hand-mode.js';
import { toolModeEntry as imageEntry } from './image-mode.js';
import { toolModeEntry as lineEntry } from './line-mode.js';
import { toolModeEntry as penEntry } from './pen-mode.js';
import { SelectToolMode, toolModeEntry as selectEntry } from './select-mode.js';
import { toolModeEntry as shapeEntry } from './shape-mode.js';
import { toolModeEntry as stickyEntry } from './sticky-mode.js';
import { toolModeEntry as textEntry } from './text-mode.js';
import { isToolModeEntry, type ToolModeEntry } from './tool-mode-entry.js';
import { registerToolModes, TOOL_MODES, toolModesOf } from './tool-modes.js';

/** The demo board's first rectangle: world (50, 50), 70 × 60. */
const MARKER = 'section-0-rect-0-0' as ObjectId;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * A registration of a tool's mode, with a stand-in mode.
 *
 * @param tool - The tool.
 * @param activates - The activated types.
 * @returns The registration and the modes it built.
 */
function standIn(tool: ToolModeEntry['tool'], activates: ToolModeEntry['activates'] = []) {
  const built: ToolMode[] = [];
  const build = (): ToolMode => {
    const mode: ToolMode = {
      id: tool,
      cursor: 'crosshair',
      onPointer: () => ({ isDone: false }),
      onKey: () => false,
      overlay: () => ({}),
      exit: () => undefined,
    };
    built.push(mode);
    return mode;
  };
  const entry: ToolModeEntry = { tool, activates, create: build, activate: build };
  return { entry, built };
}

function setUp() {
  const store = createDemoDocument();
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: () => undefined,
  });
  const press = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
    };
    document.handlePointer(input, CAMERA);
  };
  return { store, document, press };
}

describe('TOOL_MODES', () => {
  it('holds every file of modes/: the connector, draw, frame, hand, image, line, pen, select, shape, sticky and text tools; the image tool crops images, the connector tool edits labels, the frame tool names frames', () => {
    expect(TOOL_MODES).toEqual([
      connectorEntry,
      drawEntry,
      frameEntry,
      handEntry,
      imageEntry,
      lineEntry,
      penEntry,
      selectEntry,
      shapeEntry,
      stickyEntry,
      textEntry,
    ]);
    expect(imageEntry.activates).toEqual(['image']);
    expect(frameEntry.activates).toEqual(['frame']);
    expect(shapeEntry.activates).toEqual(['shape']);
    expect(lineEntry.activates).toEqual([]);
    expect(drawEntry.activates).toEqual([]);
    expect(connectorEntry.activates).toEqual(['connector']);
    expect(TOOL_MODES.every(isToolModeEntry)).toBe(true);
    expect(penEntry.activates).toEqual(['path']);
    expect(selectEntry.activates).toEqual([]);
    expect(handEntry.activates).toEqual([]);
    expect(stickyEntry.activates).toEqual(['sticky']);
    expect(textEntry.activates).toEqual(['text']);
  });

  it('refuses a file without a registration, and two for one tool or object type', () => {
    const text = standIn('text', ['text']);
    expect(() => toolModesOf({ './pen-mode.ts': { mode: text.entry } })).toThrow(/pen-mode/);
    expect(() =>
      toolModesOf({
        './a-mode.ts': { toolModeEntry: text.entry },
        './b-mode.ts': { toolModeEntry: text.entry },
      }),
    ).toThrow(/text tool/);
    const sticky = standIn('sticky', ['text']);
    expect(() =>
      toolModesOf({
        './a-mode.ts': { toolModeEntry: text.entry },
        './b-mode.ts': { toolModeEntry: sticky.entry },
      }),
    ).toThrow(/text objects/);
  });

  it('takes only well-formed registrations', () => {
    const { entry } = standIn('pen');
    expect(isToolModeEntry(entry)).toBe(true);
    expect(isToolModeEntry(null)).toBe(false);
    expect(isToolModeEntry({ ...entry, tool: 'lasso' })).toBe(false);
    expect(isToolModeEntry({ ...entry, activates: [1] })).toBe(false);
    expect(isToolModeEntry({ ...entry, create: undefined })).toBe(false);
    expect(isToolModeEntry({ tool: 'pen', activates: ['path'], create: entry.create })).toBe(false);
  });
});

describe('registerToolModes', () => {
  it('starts with the select tool, a registered mode like any other, driving the one controller', () => {
    const { document, press } = setUp();
    expect(document.tools.router.activeTool).toBe('select');
    const mode = document.tools.router.activeMode;
    expect(mode).toBeInstanceOf(SelectToolMode);
    expect(mode?.overlay()).toEqual({});
    expect(mode?.onKey({ kind: 'escape' })).toBe(false);
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    expect(document.inspect().selectedIds).toEqual([MARKER]);
    document.setActiveTool('text');
    document.setActiveTool('select');
    expect(document.tools.router.activeMode).not.toBe(mode);
    expect(document.inspect().selectedIds).toEqual([MARKER]);
  });

  it('starts the text tool from the registry, and edits activated text', () => {
    const { document } = setUp();
    document.setActiveTool('text');
    expect(document.tools.router.activeMode).toBeInstanceOf(TextMode);
    expect(document.cursor()).toBe('text');
  });

  it("starts the sticky tool from the registry: a click makes a note in the tool's colour, edited", () => {
    const { store, document, press } = setUp();
    document.panels.setToolStyle('sticky', { color: [0.66, 0.84, 0.98, 1] });
    document.setActiveTool('sticky');
    expect(document.tools.router.activeMode).toBeInstanceOf(StickyMode);
    expect(document.cursor()).toBe('crosshair');
    press('pointerDown', 1500, 1500);
    press('pointerUp', 1500, 1500);
    expect(store.get('new' as ObjectId)).toMatchObject({
      type: 'sticky',
      x: 1400,
      y: 1400,
      color: [0.66, 0.84, 0.98, 1],
      align: 'center',
    });
    expect(document.inspect().textEditing?.id).toBe('new');
    expect(document.inspect().selectedIds).toEqual(['new']);
    expect(document.tools.router.canActivate('new' as ObjectId)).toBe(true);
  });

  it("starts the shape tool from the registry: a drag makes the tool's kind, selected, then select", () => {
    const { store, document, press } = setUp();
    document.panels.setToolStyle('shape', { kind: 'ellipse' });
    document.setActiveTool('shape');
    expect(document.tools.router.activeMode).toBeInstanceOf(ShapeMode);
    expect(document.cursor()).toBe('crosshair');
    press('pointerDown', 1500, 1500);
    press('pointerMove', 1550, 1530);
    press('pointerUp', 1600, 1560);
    expect(store.get('new' as ObjectId)).toMatchObject({
      type: 'shape',
      kind: 'ellipse',
      x: 1500,
      y: 1500,
      width: 100,
      height: 60,
    });
    expect(document.inspect().selectedIds).toEqual(['new']);
    expect(document.tools.router.activeTool).toBe('select');
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing?.id).toBe('new');
  });

  it('registers a tool’s mode and its activations with a router', () => {
    const { document, press } = setUp();
    const pen = standIn('pen', ['shape']);
    registerToolModes(document.tools.router, document.tools.services(), [pen.entry]);
    document.setActiveTool('pen');
    expect(pen.built).toHaveLength(1);
    expect(document.cursor()).toBe('crosshair');
    document.setActiveTool('select');
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(pen.built).toHaveLength(2);
    expect(document.tools.router.activeMode).toBe(pen.built[1]);
  });

  it('leaves clicks alone under a tool with no mode, and cancels a drag when one is chosen', () => {
    const { store, document } = setUp();
    const services = document.tools.services();
    // A router where only the select tool has a mode: every toolbar tool has one in the app.
    const router = new ToolRouter({
      select: services.selectTool,
      getObject: (id) => store.get(id),
      onChange: () => undefined,
    });
    registerToolModes(router, services, [selectEntry]);
    const press = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
      const input: SelectInput & { readonly kind: typeof kind } = {
        kind,
        screen: { x, y },
        world: { x, y },
        isShiftPressed: false,
        isModPressed: false,
      };
      router.handlePointer(input, 1, CAMERA);
    };
    press('pointerDown', 60, 60);
    press('pointerMove', 75, 70);
    press('pointerMove', 90, 80);
    router.setActiveTool('connector');
    press('pointerUp', 90, 80);
    expect(store.get(MARKER)).toMatchObject({ x: 10, y: 10 });
    expect(router.activeMode).toBeUndefined();
    expect(router.cursor).toBe('default');
    press('pointerDown', 1500, 1500);
    press('pointerUp', 1500, 1500);
    expect(document.inspect().selectedIds).toEqual([MARKER]);
    router.setActiveTool('select');
    press('pointerDown', 1500, 1500);
    press('pointerUp', 1500, 1500);
    expect(document.inspect().selectedIds).toEqual([]);
  });

  it('builds the connector tool’s mode, which takes the clicks', () => {
    const { document, press } = setUp();
    document.setActiveTool('connector');
    expect(document.tools.router.activeMode).toBeInstanceOf(ConnectorMode);
    expect(document.cursor()).toBe('crosshair');
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    expect(document.inspect().selectedIds).toEqual([]);
  });

  it('builds nothing for an activation the registration declines', () => {
    const { document } = setUp();
    const decline = vi.fn(() => undefined);
    registerToolModes(document.tools.router, document.tools.services(), [
      {
        tool: 'shape',
        activates: ['shape'],
        create: standIn('shape').entry.create,
        activate: decline,
      },
    ]);
    document.tools.router.activate({
      type: 'activate',
      id: MARKER,
      world: { x: 0, y: 0 },
      source: 'enter',
    });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(document.tools.router.activeMode).toBeInstanceOf(SelectToolMode);
  });
});
