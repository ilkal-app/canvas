// The frame tool's registration: the tool's mode draws frames; a double-click on a
// frame's title band edits its name, while one on its body, and Enter, leave the frame alone.
import { describe, expect, it } from 'vitest';

import type { FrameObject, ObjectId, Point } from '@canvas/schema';
import { FrameMode, FrameNameMode, type SelectActivation } from '@canvas/tools';

import { frameContextOf, toolModeEntry } from './frame-mode.js';
import type { ToolModeServices } from './tool-mode-entry.js';

const FRAME = {
  id: 'f' as ObjectId,
  type: 'frame',
  parentId: null,
  x: 0,
  y: 100,
  rotation: 0,
  width: 200,
  height: 100,
  name: 'Frame 1',
} as FrameObject;

/**
 * Services over a document holding the frame, with or without the hit-test index.
 *
 * @param hasIndex - Whether the services carry the index.
 * @returns The services.
 */
function services(hasIndex = true): ToolModeServices {
  const source = { get: (id: ObjectId) => (id === FRAME.id ? FRAME : undefined) };
  return {
    store: source,
    selectTool: { source },
    ...(hasIndex ? { snapIndex: { searchRect: () => [] } } : {}),
  } as unknown as ToolModeServices;
}

/**
 * A double press on the frame at a point, or Enter.
 *
 * @param world - The press.
 * @param isEnter - Whether Enter activated it.
 * @returns The activation.
 */
function activation(world: Point, isEnter = false): SelectActivation {
  return { type: 'activate', id: FRAME.id, world, ...(isEnter ? { source: 'enter' } : {}) };
}

describe('the frame tool entry', () => {
  it('builds the frame mode for the tool, with the index when there is one', () => {
    expect(toolModeEntry).toMatchObject({ tool: 'frame', activates: ['frame'] });
    expect(toolModeEntry.create(services())).toBeInstanceOf(FrameMode);
    expect(frameContextOf(services()).board).toBeDefined();
    expect(frameContextOf(services(false)).board).toBeUndefined();
  });

  it('edits the name on a double-click on the title band only', () => {
    const { activate } = toolModeEntry;
    const onTitle = activate?.(services(), activation({ x: 50, y: 90 }), FRAME);
    expect(onTitle).toBeInstanceOf(FrameNameMode);
    expect((onTitle as FrameNameMode).frameId).toBe('f');
    expect(activate?.(services(), activation({ x: 50, y: 150 }), FRAME)).toBeUndefined();
    expect(activate?.(services(), activation({ x: 50, y: 90 }, true), FRAME)).toBeUndefined();
  });

  it('edits no hidden name: above a frame with showName false is not a title band', () => {
    const { activate } = toolModeEntry;
    const hidden = { ...FRAME, showName: false };
    expect(activate?.(services(), activation({ x: 50, y: 90 }), hidden)).toBeUndefined();
    // A frame whose parent is a frame hides its name by default; the lookup finds FRAME.
    const nested = { ...FRAME, id: 'n' as ObjectId, parentId: FRAME.id };
    expect(activate?.(services(), activation({ x: 50, y: 90 }), nested)).toBeUndefined();
  });
});
