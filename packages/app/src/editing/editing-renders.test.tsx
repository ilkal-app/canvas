// @vitest-environment jsdom
// What the editing layers cost when nothing of theirs shows, and while typing: a pan or
// zoom with no label and no text edited renders none of them, and a keystroke renders the text
// bar again only when what it shows (the style, the note's box or colour) changes.
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { TextStyleContext } from '../engine/document-text.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { createCameraSource } from './camera-source.js';
import { EditingLayers } from './editing-layers.js';
import { OverlayLabelFeed } from './overlay-label-feed.js';

const NOTE = 'note' as ObjectId;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1440, viewportHeightPx: 900, dpr: 1 };

/**
 * An engine whose board holds one note, whose listeners the test calls as the document would.
 *
 * @returns The engine, the listeners and a way to replace the note.
 */
function fakeEngine() {
  let note = {
    id: NOTE,
    type: 'sticky',
    parentId: null,
    x: 386,
    y: 276,
    rotation: 0,
    width: 180,
    height: 116,
    color: [1, 0.92, 0.55, 1],
  } as unknown as BoardObject;
  const listeners = new Set<() => void>();
  let version = 0;
  const engine = {
    overlayLabels: new OverlayLabelFeed(),
    board: {
      board: { get: (id: ObjectId) => (id === NOTE ? note : undefined) },
      state: () => ({ documentVersion: version, selectedIds: [], enteredGroupId: null }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as MountedEngine;
  const change = (next?: Partial<Record<string, unknown>>) => {
    if (next) note = { ...note, ...next };
    version += 1;
    for (const listener of listeners) listener();
  };
  return { engine, change };
}

function setUp(context: TextStyleContext | undefined) {
  const { engine, change } = fakeEngine();
  const camera = createCameraSource();
  camera.write(CAMERA);
  let renders = 0;
  const layers = (style: TextStyleContext | undefined) => (
    <Profiler
      id="editing"
      onRender={() => {
        renders += 1;
      }}
    >
      <EditingLayers
        engine={engine}
        camera={camera}
        textStyle={style}
        canEdit
        onTextStyle={() => undefined}
        dispatch={() => undefined}
      />
    </Profiler>
  );
  const view = render(layers(context));
  return { camera, change, view, layers, renders: () => renders };
}

afterEach(cleanup);

const EDITING: TextStyleContext = {
  style: { fontSize: 14, weight: 400, italic: false },
  align: 'left',
  isEditing: true,
  edited: { id: NOTE, type: 'sticky' },
};

describe('EditingLayers: cost', () => {
  it('renders nothing for camera-only frames with no label shown and no text edited', () => {
    const { camera, change, view, renders } = setUp(undefined);
    expect(view.container.innerHTML).toBe('');
    const before = renders();
    for (let step = 1; step <= 100; step += 1) {
      act(() => {
        camera.write({ ...CAMERA, x: step, zoom: 1 + step / 100 });
        change();
      });
    }
    expect(renders()).toBe(before);
  });

  it('renders the text bar again on a keystroke only when what it shows changes', () => {
    const { camera, change, view, layers, renders } = setUp(EDITING);
    expect(view.container.querySelector('[role="toolbar"]')).not.toBeNull();
    const before = renders();
    // Fifty keystrokes, each its own commit: the document changes, the note's box and colour do
    // not.
    for (let key = 0; key < 50; key += 1) {
      act(() => {
        change();
      });
    }
    expect(renders()).toBe(before);
    // The same style context object (DocumentText keeps it while the style holds).
    view.rerender(layers(EDITING));
    expect(renders()).toBe(before + 1);
    // A style change, the note's colour and a pan each render it again.
    view.rerender(layers({ ...EDITING, style: { ...EDITING.style, weight: 700 } }));
    expect(renders()).toBe(before + 2);
    act(() => {
      change({ color: [1, 0.74, 0.8, 1] });
    });
    expect(renders()).toBe(before + 3);
    act(() => {
      camera.write({ ...CAMERA, x: 10 });
    });
    expect(renders()).toBe(before + 4);
  });
});
