// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';
import { isSameData } from './stable-style-controls.js';

const controls = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./popover-controls.js', () => {
  function PopoverStyleControls() {
    controls.renders += 1;
    return null;
  }
  return { PopoverStyleControls };
});

const SHAPE = {
  id: 'shape-1' as ObjectId,
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
} as BoardObject;

beforeEach(() => {
  controls.renders = 0;
});
afterEach(() => {
  cleanup();
});

describe('StableStyleControls', () => {
  it('renders the controls again when the board document changes under the same selection', () => {
    const store = new YjsDocumentStore({ clientId: 692 });
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(SHAPE);
    });
    const engine = new FakeMountedEngine(
      document.createElement('canvas'),
      { store },
      Promise.resolve(),
    );
    const props: SelectionPopoverProps = {
      engine,
      camera: createCameraSource(),
      selection: [SHAPE],
      canEdit: true,
      isEditingText: false,
      shortcuts: createDefaultShortcutRegistry('mac'),
      dispatch: vi.fn(),
      textStyle: undefined,
      onTextStyle: undefined,
    };
    render(
      <main>
        <canvas />
        <SelectionPopover {...props} />
      </main>,
    );
    expect(controls.renders).toBe(1);
    // Another object on the board (a child a section's Fit to content reads, say).
    act(() => {
      store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.setObject({ ...SHAPE, id: 'shape-2' as ObjectId });
      });
    });
    expect(controls.renders).toBe(2);
  });
});

describe('isSameData', () => {
  it('compares arrays and plain objects by their data, anything else by identity', () => {
    expect(isSameData({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] })).toBe(true);
    expect(isSameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(isSameData([1, 2], [1, 3])).toBe(false);
    expect(isSameData([1], { 0: 1 })).toBe(false);
    expect(isSameData(new Map(), new Map())).toBe(false);
    const fn = (): void => undefined;
    expect(isSameData({ fn }, { fn })).toBe(true);
    expect(isSameData({ fn }, { fn: (): void => undefined })).toBe(false);
  });
});
