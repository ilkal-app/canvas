import { describe, expect, it } from 'vitest';

import type { OverlayRect, SelectController, SelectionOverlayModel } from '@canvas/tools';

import { SelectToolMode, type EndpointEditor } from './select-mode.js';

/**
 * A rectangle to tell the editors' apart.
 *
 * @param x - Its left.
 * @returns The rectangle.
 */
function rectAt(x: number): OverlayRect {
  return { box: { x, y: 0, width: 1, height: 1, rotation: 0 }, color: [0, 0, 0, 1] };
}

/**
 * An editor that shows a fixed overlay.
 *
 * @param shown - What it shows, or none.
 * @returns The editor.
 */
function editorShowing(shown: Partial<SelectionOverlayModel> | undefined): EndpointEditor {
  return {
    isDragging: false,
    handleAt: () => undefined,
    press: () => false,
    follow: () => undefined,
    cancel: () => undefined,
    followZoom: () => false,
    overlay: () => shown,
  };
}

/**
 * The select mode over editors, for a person who can edit or not.
 *
 * @param editors - The editors.
 * @param canEdit - Whether the person may edit.
 * @returns The mode.
 */
function modeOf(editors: readonly EndpointEditor[], canEdit = true): SelectToolMode {
  return new SelectToolMode({ canEdit } as SelectController, editors);
}

describe('SelectToolMode overlay', () => {
  it('shows every editor’s handles, an earlier one’s fields winning and its rectangles on top', () => {
    const routeHandle = editorShowing({ frame: undefined, toolRects: [rectAt(1)] });
    const ends = editorShowing({ frame: undefined, toolRects: [rectAt(2)], guides: [] });
    const overlay = modeOf([routeHandle, editorShowing(undefined), ends]).overlay();
    expect(overlay.toolRects).toEqual([rectAt(2), rectAt(1)]);
    expect(overlay).toHaveProperty('guides', []);
    expect(overlay).toHaveProperty('frame', undefined);
  });

  it('hides an editor that asks to, while another one drags', () => {
    const routeHandle = {
      ...editorShowing({ toolRects: [rectAt(1)] }),
      isHiddenDuringOtherDrags: true,
    };
    const ends = editorShowing({ toolRects: [rectAt(2)] });
    expect(modeOf([routeHandle, ends]).overlay().toolRects).toEqual([rectAt(2), rectAt(1)]);
    const endDrag = { ...ends, isDragging: true };
    expect(modeOf([routeHandle, endDrag]).overlay().toolRects).toEqual([rectAt(2)]);
    const ownDrag = { ...routeHandle, isDragging: true };
    expect(modeOf([ownDrag, ends]).overlay().toolRects).toEqual([rectAt(2), rectAt(1)]);
  });

  it('adds nothing without handles, or for a person who cannot edit', () => {
    expect(modeOf([editorShowing(undefined)]).overlay()).toEqual({});
    const shown = editorShowing({ toolRects: [rectAt(1)] });
    expect(modeOf([shown], false).overlay()).toEqual({});
    expect(modeOf([editorShowing({ frame: undefined })]).overlay()).toEqual({
      frame: undefined,
      toolRects: [],
    });
  });
});
