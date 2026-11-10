// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, StickyObject, TextObject } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleContext } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

const BASE = {
  parentId: null,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 300,
  y: 250,
  width: 100,
  height: 100,
};
const TEXT_FIELDS = {
  verticalAlign: 'top',
  text: '',
  runs: [
    {
      length: 0,
      style: {
        fontFamily: 'Lora',
        fontSize: 16,
        color: [0.1, 0.2, 0.3, 1],
        weight: 400,
        italic: false,
      },
    },
  ],
  align: 'left',
};
const NOTE = {
  ...BASE,
  ...TEXT_FIELDS,
  id: 'note-1' as ObjectId,
  type: 'sticky',
  color: [1, 0.9, 0.5, 1],
  autoWidth: false,
} as StickyObject;
const NOTE_2 = {
  ...NOTE,
  id: 'note-2' as ObjectId,
  x: 420,
  color: [1, 0.8, 0.5, 1],
  verticalAlign: 'bottom',
} as StickyObject;
const TEXT = {
  ...BASE,
  ...TEXT_FIELDS,
  id: 'text-1' as ObjectId,
  type: 'text',
  height: 50,
  autoWidth: true,
} as TextObject;
const TEXT_2 = { ...TEXT, id: 'text-2' as ObjectId, x: 420 } as TextObject;
const SHAPE = {
  ...BASE,
  id: 'shape-1' as ObjectId,
  type: 'shape',
  kind: 'rectangle',
  stroke: null,
  fill: null,
  cornerRadius: 0,
  sides: 4,
  label: null,
} as BoardObject;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
const SHORTCUTS = createDefaultShortcutRegistry('mac');
const STYLE: TextStyleContext = {
  style: { fontFamily: 'Lora', fontSize: 16, color: [0.1, 0.2, 0.3, 1] },
  align: 'left',
  isEditing: false,
};
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Runs placement frames requested by the popover. */
function flushFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/**
 * Builds a mounted popover with the given selected objects.
 *
 * @param selection - Objects to target.
 * @param overrides - Props varied by the case.
 * @returns The popover props.
 */
function propsOf(
  selection: readonly BoardObject[],
  overrides: Partial<SelectionPopoverProps> = {},
): SelectionPopoverProps {
  const store = new YjsDocumentStore({ clientId: 626 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of selection) transaction.setObject(object);
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
    selection,
    canEdit: true,
    isEditingText: false,
    shortcuts: SHORTCUTS,
    dispatch: vi.fn(),
    textStyle: STYLE,
    onTextStyle: vi.fn(),
    ...overrides,
  };
}

/**
 * Opens a rendered popover and completes its initial placement.
 *
 * @param props - The selection and handlers.
 */
function mount(props: SelectionPopoverProps): void {
  render(
    <main>
      <canvas />
      <SelectionPopover {...props} />
    </main>,
  );
  flushFrames();
}

describe('selection popover controls acceptance', () => {
  it('orders all-sticky style controls before Comment and More and shows mixed note values', () => {
    mount(propsOf([NOTE, NOTE_2], { textStyle: { ...STYLE, style: {}, align: undefined } }));
    const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
    const names = [...toolbar.querySelectorAll('button')].map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(names.slice(0, 4)).toEqual([
      'Note colour: Mixed',
      'Font: Mixed',
      'Font size: Mixed',
      'Alignment',
    ]);
    expect(names.at(-1)).toBe('More');
    expect(screen.queryByRole('button', { name: /^Text colour:/ })).toBeNull();
  });

  it('shows text controls in their own order, with no vertical alignment choices', () => {
    mount(propsOf([TEXT, TEXT_2]));
    const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
    const names = [...toolbar.querySelectorAll('button')].map((button) =>
      button.getAttribute('aria-label'),
    );
    // Puts Bold and Italic between the size and the colour (the TEXT card).
    expect(names.slice(0, 6)).toEqual([
      'Font: Lora',
      'Font size: 16',
      'Bold',
      'Italic',
      expect.stringMatching(/^Text colour:/),
      'Alignment',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Alignment' }));
    expect(screen.queryByRole('menuitemradio', { name: 'Top' })).toBeNull();
  });

  it('leaves style controls off mixed object types and non-editors', () => {
    const props = propsOf([NOTE, SHAPE]);
    mount(props);
    expect(screen.queryByRole('button', { name: /^Font:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'More' })).not.toBeNull();
    cleanup();
    mount(propsOf([NOTE], { canEdit: false }));
    expect(screen.queryByRole('button', { name: /^Font:/ })).toBeNull();
  });

  it('emits one text action for a font, size and horizontal alignment choice', () => {
    const onTextStyle = vi.fn();
    mount(propsOf([TEXT, TEXT_2], { onTextStyle }));
    fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Liberation Sans' }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { fontFamily: 'Liberation Sans' },
    });
    onTextStyle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Large/ }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'style', patch: { fontSize: 24 } });
    onTextStyle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Alignment' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Right' }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'align', align: 'right' });
  });

  it('dispatches one action containing a change for every selected sticky', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([NOTE, NOTE_2], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Alignment' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Middle' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: NOTE.id, style: { verticalAlign: 'middle' } },
        { id: NOTE_2.id, style: { verticalAlign: 'middle' } },
      ],
    });
  });

  it('converts a custom text colour to normalized RGBA in one style change', () => {
    const onTextStyle = vi.fn();
    mount(propsOf([TEXT], { onTextStyle }));
    fireEvent.click(screen.getByRole('button', { name: /^Text colour:/ }));
    const palette = screen.getByRole('dialog', { name: 'Text colour colours' });
    const custom = within(palette).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(custom, { target: { value: '#ff8040' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { color: [1, 128 / 255, 64 / 255, 1] },
    });
  });

  it('applies one note colour action across a sticky selection', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([NOTE, NOTE_2], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: /^Note colour:/ }));
    const palette = screen.getByRole('dialog', { name: 'Note colour colours' });
    const choice = palette.querySelector<HTMLButtonElement>('[data-swatch]');
    expect(choice).not.toBeNull();
    if (choice === null) throw new Error('No note colour choice');
    fireEvent.click(choice);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0]?.[0];
    expect(action?.type).toBe('style');
    if (action?.type !== 'style') return;
    expect(action.changes.map((change) => change.id)).toEqual([NOTE.id, NOTE_2.id]);
    expect(action.changes[0]?.style.color).toEqual(action.changes[1]?.style.color);
  });
});
