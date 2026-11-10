// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleChange, TextStyleContext } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

const controls = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./popover-controls.js', () => {
  function PopoverStyleControls(props: {
    readonly onTextStyle?: (change: TextStyleChange) => void;
  }) {
    controls.renders += 1;
    return (
      <button type="button" onClick={() => props.onTextStyle?.({ kind: 'toggleBold' })}>
        Mock text style
      </button>
    );
  }
  return { PopoverStyleControls };
});

const BASE = {
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 300,
  y: 250,
  z: 'a0',
  type: 'shape',
  kind: 'rectangle',
  width: 100,
  height: 50,
  stroke: null,
  fill: [1, 0, 0, 1],
  cornerRadius: 0,
  sides: 4,
  label: null,
};
const FIRST = { ...BASE, id: 'shape-1' as ObjectId } as BoardObject;
const SECOND = { ...BASE, id: 'shape-2' as ObjectId } as BoardObject;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
const SHORTCUTS = createDefaultShortcutRegistry('mac');
const TEXT_STYLE: TextStyleContext = {
  style: { fontFamily: 'Lora', fontSize: 16, color: [1, 0, 0, 1], weight: 400, italic: false },
  align: 'left',
  isEditing: false,
};

beforeEach(() => {
  controls.renders = 0;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function propsOf(): SelectionPopoverProps {
  const store = new YjsDocumentStore({ clientId: 673 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(FIRST);
    transaction.setObject(SECOND);
  });
  const engine = new FakeMountedEngine(
    document.createElement('canvas'),
    { store },
    Promise.resolve(),
  );
  engine.currentCamera = CAMERA;
  return {
    engine,
    camera: createCameraSource(),
    selection: [FIRST],
    canEdit: true,
    isEditingText: false,
    shortcuts: SHORTCUTS,
    dispatch: vi.fn(),
    textStyle: TEXT_STYLE,
    onTextStyle: vi.fn(),
  };
}

function Tree({ popoverProps }: { readonly popoverProps: SelectionPopoverProps }) {
  return (
    <main>
      <canvas />
      <SelectionPopover {...popoverProps} />
    </main>
  );
}

describe('selection popover render identity', () => {
  it('keeps controls and sheet stable for equal selection and text style while using the latest callback, then updates for a real change', () => {
    const initial = propsOf();
    const { rerender } = render(<Tree popoverProps={initial} />);
    const sheet = screen.getByRole('toolbar', { name: 'Selection', hidden: true });
    expect(controls.renders).toBe(1);
    const oldCallback = vi.fn<(change: TextStyleChange) => void>();
    const newCallback = vi.fn<(change: TextStyleChange) => void>();
    rerender(
      <Tree
        popoverProps={{
          ...initial,
          selection: [FIRST],
          textStyle: { ...TEXT_STYLE, style: { ...TEXT_STYLE.style } },
          onTextStyle: oldCallback,
          dispatch: vi.fn(),
        }}
      />,
    );
    rerender(
      <Tree
        popoverProps={{
          ...initial,
          selection: [FIRST],
          textStyle: { ...TEXT_STYLE, style: { ...TEXT_STYLE.style } },
          onTextStyle: newCallback,
          dispatch: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('toolbar', { name: 'Selection', hidden: true })).toBe(sheet);
    expect(controls.renders).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mock text style', hidden: true }));
    expect(newCallback).toHaveBeenCalledExactlyOnceWith({ kind: 'toggleBold' });
    expect(oldCallback).not.toHaveBeenCalled();
    rerender(
      <Tree
        popoverProps={{
          ...initial,
          selection: [SECOND],
          textStyle: { ...TEXT_STYLE, style: { ...TEXT_STYLE.style, fontSize: 20 } },
          onTextStyle: newCallback,
        }}
      />,
    );
    expect(controls.renders).toBe(2);
  });
});
