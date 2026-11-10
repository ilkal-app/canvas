// @vitest-environment jsdom
// An editable phone selection uses the compact sheet form.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { fakeViewport } from '../shell/__fixtures__/fake-media.js';

import { SelectionPopover } from './selection-popover.js';

const SHAPE = {
  id: 'mobile-shape' as ObjectId,
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 200,
  y: 200,
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('marks the phone Selection toolbar as a sheet and removes the mark at 768 px', () => {
  const viewport = fakeViewport(390);
  vi.stubGlobal('matchMedia', viewport.matchMedia);
  render(
    <main>
      <canvas />
      <SelectionPopover
        engine={undefined}
        camera={createCameraSource()}
        selection={[SHAPE]}
        canEdit
        isEditingText={false}
        shortcuts={createDefaultShortcutRegistry('mac')}
        dispatch={vi.fn()}
      />
    </main>,
  );
  const toolbar = screen.getByRole('toolbar', { name: 'Selection', hidden: true });
  expect(toolbar.hasAttribute('data-sheet')).toBe(true);
  act(() => {
    viewport.resize(768);
  });
  expect(toolbar.hasAttribute('data-sheet')).toBe(false);
});
