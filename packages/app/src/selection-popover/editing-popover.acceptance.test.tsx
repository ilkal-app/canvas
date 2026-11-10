// @vitest-environment jsdom
// The floating selection popover becomes the edited text's toolbar.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, StickyObject, TextObject } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { EditingLayers } from '../editing/editing-layers.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleChange, TextStyleContext } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { shellBoardModeContext, type ShellBoardMode } from '../shell/shell-board-mode.js';
import { whiteboardChromeContext } from '../shell/whiteboard-chrome.js';
import { panelLayoutFor } from '../state/dock-layout.js';
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
  width: 160,
  height: 80,
};
const RUN_STYLE = {
  fontFamily: 'Lora',
  fontSize: 16,
  color: [0.1, 0.2, 0.3, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};
const TEXT_FIELDS = {
  text: 'Hello',
  runs: [{ length: 5, style: RUN_STYLE }],
  align: 'left',
  verticalAlign: 'top',
};
const TEXT = {
  ...BASE,
  ...TEXT_FIELDS,
  id: 'text-1' as ObjectId,
  type: 'text',
  autoWidth: true,
} as TextObject;
const NOTE = {
  ...BASE,
  ...TEXT_FIELDS,
  id: 'note-1' as ObjectId,
  type: 'sticky',
  autoWidth: false,
  color: [1, 0.9, 0.5, 1],
} as StickyObject;
const SHAPE = {
  ...BASE,
  id: 'shape-1' as ObjectId,
  type: 'shape',
  kind: 'rectangle',
  stroke: null,
  fill: null,
  cornerRadius: 0,
  sides: 4,
  label: { text: 'Hello', runs: [{ length: 5, style: RUN_STYLE }] },
} as BoardObject;
const CONNECTOR = {
  parentId: null,
  rotation: 0,
  z: 'a1',
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 300,
  y: 250,
  id: 'connector-1' as ObjectId,
  type: 'connector',
  from: { kind: 'point', x: 300, y: 250 },
  to: { kind: 'point', x: 460, y: 330 },
  route: 'straight',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  label: { text: 'Hello', runs: [{ length: 5, style: RUN_STYLE }] },
} as unknown as BoardObject;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
const STYLE: TextStyleContext = {
  style: RUN_STYLE,
  align: 'left',
  isEditing: true,
  edited: { id: TEXT.id, type: 'text' },
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
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Completes the placement work requested by a mounted popover. */
function flushFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/**
 * Provides a board containing the edited object, even when selection is empty.
 *
 * @param object - The object whose text is edited.
 * @returns Its mounted engine.
 */
function engineWith(object: BoardObject): FakeMountedEngine {
  const store = new YjsDocumentStore({ clientId: 653 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(object);
  });
  const engine = new FakeMountedEngine(
    document.createElement('canvas'),
    { store },
    Promise.resolve(),
  );
  engine.currentCamera = CAMERA;
  return engine;
}

/**
 * Builds editing props for one object and an optional board selection.
 *
 * @param object - The object whose text is edited.
 * @param selection - The current board selection.
 * @param overrides - Case-specific props.
 * @returns The popover props.
 */
function propsOf(
  object: BoardObject,
  selection: readonly BoardObject[] = [],
  overrides: Partial<SelectionPopoverProps> = {},
): SelectionPopoverProps {
  return {
    engine: engineWith(object),
    camera: createCameraSource(),
    selection,
    canEdit: true,
    isEditingText: true,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch: vi.fn(),
    textStyle: { ...STYLE, edited: { id: object.id, type: object.type } },
    onTextStyle: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the popover and lets its placement complete.
 *
 * @param props - The popover's props.
 * @returns The edited text toolbar.
 */
function mount(props: SelectionPopoverProps): HTMLElement {
  render(
    <main>
      <canvas />
      <SelectionPopover {...props} />
    </main>,
  );
  flushFrames();
  return screen.getByRole('toolbar', { name: 'Text' });
}

/**
 * Lists the names of buttons in the edited text row.
 *
 * @param toolbar - The editing popover.
 * @returns Its buttons' accessible labels in DOM order.
 */
function buttonNames(toolbar: HTMLElement): (string | null)[] {
  return [...toolbar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
}

describe('editing popover acceptance', () => {
  it('follows the edited id without selection and identifies itself as a text bar', () => {
    const toolbar = mount(propsOf(TEXT));
    expect(toolbar.getAttribute('data-selection-popover')).toBe('');
    expect(toolbar.getAttribute('data-editing')).toBe('');
    expect(toolbar.getAttribute('data-text-bar')).toBe('');
    expect(toolbar.getAttribute('aria-keyshortcuts')).toBe('Alt+F10');
    expect(toolbar.hasAttribute('data-hidden')).toBe(false);
  });

  it.each([
    {
      object: TEXT,
      labels: [
        'Font: Lora',
        'Font size: 16',
        'Bold',
        'Italic',
        'Text colour:',
        'Link',
        'Alignment',
      ],
    },
    {
      object: NOTE,
      labels: [
        'Note colour:',
        'Font: Lora',
        'Font size: 16',
        'Bold',
        'Italic',
        'Text colour:',
        'Link',
        'Alignment',
      ],
    },
    {
      object: SHAPE,
      labels: ['Font: Lora', 'Font size: 16', 'Bold', 'Italic', 'Text colour:', 'Link'],
    },
    {
      object: CONNECTOR,
      labels: ['Font: Lora', 'Font size: 16', 'Bold', 'Italic', 'Text colour:', 'Link'],
    },
  ])('shows only text controls while editing $object.type', ({ object, labels }) => {
    const toolbar = mount(propsOf(object));
    const names = buttonNames(toolbar);
    expect(names).toHaveLength(labels.length);
    for (const [index, label] of labels.entries()) {
      expect(names[index]).toContain(label);
      expect(within(toolbar).getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    if (object.type === 'shape' || object.type === 'connector') {
      expect(within(toolbar).queryByRole('button', { name: 'Alignment' })).toBeNull();
    }
    expect(within(toolbar).queryByRole('button', { name: /^(More|Comment|Vote)$/ })).toBeNull();
    expect(toolbar.querySelectorAll('[data-popover-divider]')).toHaveLength(
      object.type === 'sticky' ? 1 : 0,
    );
  });

  it('routes emphasis, size, alignment and sticky colours through the edited target', () => {
    const onTextStyle = vi.fn<(change: TextStyleChange) => void>();
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const toolbar = mount(propsOf(NOTE, [], { onTextStyle, dispatch }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Bold' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Italic' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Font size: 16' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Large/ }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Alignment' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Right' }));
    expect(onTextStyle.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'toggleBold' },
      { kind: 'toggleItalic' },
      { kind: 'style', patch: { fontSize: 24 } },
      { kind: 'align', align: 'right' },
    ]);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Alignment' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Middle' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Note colour:/ }));
    const colour = screen.getByRole('dialog', { name: 'Note colour colours' });
    fireEvent.click(within(colour).getByRole('button', { name: 'Pink' }));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({
      type: 'style',
      changes: [{ id: NOTE.id, style: { verticalAlign: 'middle' } }],
    });
    const colourAction = dispatch.mock.calls[1]?.[0];
    expect(colourAction?.type).toBe('style');
    if (colourAction?.type === 'style') {
      expect(colourAction.changes.map((change) => change.id)).toEqual([NOTE.id]);
      expect(colourAction.changes[0]?.style.color).toBeDefined();
    }
  });

  it('shows mixed range values instead of the edited object’s first run', () => {
    const toolbar = mount(
      propsOf(TEXT, [], {
        textStyle: {
          ...STYLE,
          style: { color: RUN_STYLE.color },
          edited: { id: TEXT.id, type: 'text' },
        },
      }),
    );
    expect(within(toolbar).getByRole('button', { name: 'Font size: Mixed' })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe(
      'mixed',
    );
    expect(
      within(toolbar).getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed'),
    ).toBe('mixed');
  });

  it('keeps the selection form when text is not being edited', () => {
    const props = propsOf(TEXT, [TEXT], {
      isEditingText: false,
      textStyle: { style: RUN_STYLE, align: 'left', isEditing: false },
    });
    render(<SelectionPopover {...props} />);
    flushFrames();
    const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
    expect(toolbar.hasAttribute('data-editing')).toBe(false);
    expect(within(toolbar).getByRole('button', { name: 'More' })).toBeTruthy();
  });
});

describe('editing layer acceptance', () => {
  it.each([
    { chrome: 'floating', hasClassicBar: false },
    { chrome: 'classic', hasClassicBar: true },
  ] as const)(
    'shows classic text bar under $chrome chrome only when expected',
    ({ chrome, hasClassicBar }) => {
      const props = propsOf(TEXT);
      const mode: ShellBoardMode = {
        mode: 'whiteboard',
        changeMode: vi.fn(),
        drawers: panelLayoutFor('whiteboard', chrome),
      };
      props.camera.write(CAMERA);
      render(
        <whiteboardChromeContext.Provider value={chrome}>
          <shellBoardModeContext.Provider value={mode}>
            <EditingLayers
              engine={props.engine}
              camera={props.camera}
              textStyle={props.textStyle}
              canEdit
              onTextStyle={vi.fn()}
              dispatch={vi.fn()}
            />
          </shellBoardModeContext.Provider>
        </whiteboardChromeContext.Provider>,
      );
      const classicBar = screen.queryByRole('toolbar', { name: 'Text' });
      expect(classicBar !== null).toBe(hasClassicBar);
      if (classicBar) expect(classicBar.hasAttribute('data-selection-popover')).toBe(false);
    },
  );
});
