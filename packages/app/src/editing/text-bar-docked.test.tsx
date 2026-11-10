// @vitest-environment jsdom
// The format bar below 768 px wide (Figma MX1): docked on the on-screen keyboard, its top
// following the keyboard as it resizes, with Done, which ends editing as Escape in the text does.
// In Chrome: tooling/scenario/specs/app/mobile-states.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { TextStyleContext } from '../engine/document-text.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { fakeViewport } from '../shell/__fixtures__/fake-media.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';

import { createCameraSource } from './camera-source.js';
import { TextBar } from './text-bar.js';

const NOTE = 'note' as ObjectId;

const STICKY = {
  id: NOTE,
  type: 'sticky',
  parentId: null,
  x: 40,
  y: 600,
  rotation: 0,
  width: 150,
  height: 112,
  color: [0.9, 0.85, 0.6, 1],
} as unknown as BoardObject;

const EDITING: TextStyleContext = {
  style: { fontSize: 14, weight: 700, italic: false },
  align: 'left',
  isEditing: true,
  edited: { id: NOTE, type: 'sticky' },
};

/** A visual viewport a test resizes, as an on-screen keyboard does. */
class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
}

let viewport: FakeVisualViewport;

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: fakeViewport(390).matchMedia,
    configurable: true,
    writable: true,
  });
  viewport = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(window, 'visualViewport');
});

/**
 * Renders the bar over a note being edited.
 *
 * @returns The dispatch.
 */
function renderBar() {
  const camera = createCameraSource();
  camera.write({ x: 0, y: 0, zoom: 1, viewportWidthPx: 390, viewportHeightPx: 844, dpr: 1 });
  const dispatch = vi.fn();
  const engine = {
    board: {
      board: { get: (id: ObjectId) => (id === NOTE ? STICKY : undefined) },
      state: () => ({ documentVersion: 0, selectedIds: [], enteredGroupId: null }),
      subscribe: () => () => undefined,
    },
  } as unknown as MountedEngine;
  render(
    <TextBar
      engine={engine}
      camera={camera}
      context={EDITING}
      canEdit
      onChange={vi.fn()}
      dispatch={dispatch}
    />,
  );
  return { dispatch, bar: screen.getByRole('toolbar', { name: 'Text' }) };
}

describe('the format bar below 768 px wide', () => {
  it('sits on the keyboard and follows it as it opens and resizes', () => {
    const { bar } = renderBar();
    expect(bar.style.bottom).toBe('0px');
    act(() => {
      viewport.height = 544;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(bar.style.bottom).toBe('300px');
    act(() => {
      viewport.height = 484;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(bar.style.bottom).toBe('360px');
    expect(bar.hasAttribute(BOTTOM_CHROME_ATTRIBUTE)).toBe(true);
  });

  it('offers the size, bold, italic, the note’s colours and Done, without the Esc hint', () => {
    const { bar } = renderBar();
    expect(within(bar).getByRole('combobox')).toBeDefined();
    expect(within(bar).getByRole('button', { name: 'Bold' })).toBeDefined();
    expect(within(bar).getByRole('button', { name: 'Italic' })).toBeDefined();
    expect(within(bar).getByRole('group', { name: 'Note colour' })).toBeDefined();
    expect(within(bar).getByRole('button', { name: 'Done' })).toBeDefined();
    expect(screen.queryByText('to finish')).toBeNull();
  });

  it('ends editing on Done, as Escape in the text does', () => {
    const { bar, dispatch } = renderBar();
    const done = within(bar).getByRole('button', { name: 'Done' });
    // A press keeps the keyboard in the text until Done acts.
    expect(fireEvent.mouseDown(done)).toBe(false);
    fireEvent.click(done);
    expect(dispatch).toHaveBeenCalledWith({ type: 'selection', command: 'deselect' });
  });
});
