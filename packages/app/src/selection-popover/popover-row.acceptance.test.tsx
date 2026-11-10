// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, StickyObject, TextObject } from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleContext } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

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
const TEXT = {
  ...BASE,
  ...TEXT_FIELDS,
  id: 'text-1' as ObjectId,
  type: 'text',
  height: 50,
  autoWidth: true,
} as TextObject;
const NOTE_2 = { ...NOTE, id: 'note-2' as ObjectId, x: 420 } as StickyObject;
const TEXT_2 = { ...TEXT, id: 'text-2' as ObjectId, x: 420 } as TextObject;
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
 * Builds a mounted popover with the selected objects in its board store.
 *
 * @param selection - Objects to target.
 * @param overrides - Props varied by the case.
 * @returns The popover props.
 */
function propsOf(
  selection: readonly BoardObject[],
  overrides: Partial<SelectionPopoverProps> = {},
): SelectionPopoverProps {
  const store = new YjsDocumentStore({ clientId: 627 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of selection) transaction.setObject(object);
  });
  const engine = new FakeMountedEngine(
    document.createElement('canvas'),
    { store },
    Promise.resolve(),
  );
  engine.currentCamera = {
    x: 0,
    y: 0,
    zoom: 1,
    viewportWidthPx: 1000,
    viewportHeightPx: 800,
    dpr: 1,
  };
  return {
    engine,
    camera: createCameraSource(),
    selection,
    canEdit: true,
    isEditingText: false,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch: vi.fn(),
    textStyle: STYLE,
    onTextStyle: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders a signed-in popover and completes its initial placement.
 *
 * @param props - The selection and handlers.
 * @returns The Selection toolbar.
 */
function mount(props: SelectionPopoverProps): HTMLElement {
  const data = {
    connection: { store: { read: () => ({ objects: new Map() }) } },
    selectedId: undefined,
    placement: undefined,
    place: vi.fn(),
  } as unknown as CommentData;
  const mode = {
    isPlacing: false,
    canWrite: true,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  } satisfies CommentMode;
  render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={data}>
        <main>
          <canvas />
          <SelectionPopover {...props} />
        </main>
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  flushFrames();
  return screen.getByRole('toolbar', { name: 'Selection' });
}

/**
 * Reads the Selection toolbar's button labels in DOM order.
 *
 * @param toolbar - The Selection toolbar.
 * @returns The buttons' aria-label values.
 */
function buttonNamesOf(toolbar: HTMLElement): (string | null)[] {
  return [...toolbar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
}

/**
 * Reads button labels and the rules between them in DOM order.
 *
 * @param toolbar - The Selection toolbar.
 * @returns Labels with a pipe for each popover divider.
 */
function rowOf(toolbar: HTMLElement): (string | null)[] {
  return [...toolbar.querySelectorAll('button, [data-popover-divider]')].map((element) =>
    element.hasAttribute('data-popover-divider') ? '|' : element.getAttribute('aria-label'),
  );
}

describe('selection popover row acceptance', () => {
  it('orders two texts’ row, including Comment, with rules after Alignment and Link', () => {
    const toolbar = mount(propsOf([TEXT, TEXT_2]));
    expect(buttonNamesOf(toolbar)).toEqual([
      'Font: Lora',
      'Font size: 16',
      'Bold',
      'Italic',
      expect.stringMatching(/^Text colour: /),
      'Alignment',
      'Link',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
      'Comment',
      'More',
    ]);
    expect(rowOf(toolbar)).toEqual([
      'Font: Lora',
      'Font size: 16',
      'Bold',
      'Italic',
      expect.stringMatching(/^Text colour: /),
      'Alignment',
      '|',
      'Link',
      '|',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
      'Comment',
      'More',
    ]);
    // Two texts: the rule after Alignment, and one before arrange and Group (item 13).
    expect(toolbar.querySelectorAll('[data-popover-divider]')).toHaveLength(2);
  });

  it('orders two stickies’ row, including Comment, with rules after colour, Alignment and Vote', () => {
    const toolbar = mount(propsOf([NOTE, NOTE_2]));
    expect(buttonNamesOf(toolbar)).toEqual([
      expect.stringMatching(/^Note colour: /),
      'Font: Lora',
      'Font size: 16',
      'Alignment',
      'Author — not available yet',
      'Vote',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
      'Comment',
      'More',
    ]);
    expect(rowOf(toolbar)).toEqual([
      expect.stringMatching(/^Note colour: /),
      '|',
      'Font: Lora',
      'Font size: 16',
      'Alignment',
      '|',
      'Author — not available yet',
      'Vote',
      '|',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
      'Comment',
      'More',
    ]);
    expect(toolbar.querySelectorAll('[data-popover-divider]')).toHaveLength(3);
  });

  it.each([
    { weight: 600, italic: true, boldPressed: 'true', italicPressed: 'true' },
    { weight: 400, italic: false, boldPressed: 'false', italicPressed: 'false' },
    { weight: undefined, italic: undefined, boldPressed: 'mixed', italicPressed: 'mixed' },
  ] as const)('shows text emphasis state for weight $weight and italic $italic', (caseStyle) => {
    mount(
      propsOf([TEXT], {
        textStyle: {
          ...STYLE,
          style: {
            ...STYLE.style,
            ...(caseStyle.weight === undefined ? {} : { weight: caseStyle.weight }),
            ...(caseStyle.italic === undefined ? {} : { italic: caseStyle.italic }),
          },
        },
      }),
    );
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe(
      caseStyle.boldPressed,
    );
    expect(screen.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe(
      caseStyle.italicPressed,
    );
  });

  it('sends one toggle action per emphasis click and never dispatches it', () => {
    const onTextStyle = vi.fn();
    const dispatch = vi.fn();
    mount(propsOf([TEXT], { onTextStyle, dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'toggleBold' });
    expect(dispatch).not.toHaveBeenCalled();
    onTextStyle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'toggleItalic' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  // The Link has its own tests (popover-link.acceptance.test.tsx): it opens a dialog.
  it('opens the Link dialog from the text row without restyling anything yet', () => {
    const onTextStyle = vi.fn();
    const dispatch = vi.fn();
    mount(propsOf([TEXT], { onTextStyle, dispatch }));
    const link = screen.getByRole('button', { name: 'Link' });
    expect(link.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(link);
    expect(screen.getByRole('dialog', { name: 'Link' })).toBeTruthy();
    expect(onTextStyle).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps sticky Author and Vote unavailable and inert, with dot-vote guidance', () => {
    const onTextStyle = vi.fn();
    const dispatch = vi.fn();
    mount(propsOf([NOTE], { onTextStyle, dispatch }));
    const author = screen.getByRole('button', { name: 'Author — not available yet' });
    const vote = screen.getByRole('button', { name: 'Vote' });
    expect(author.getAttribute('aria-disabled')).toBe('true');
    expect(vote.getAttribute('aria-disabled')).toBe('true');
    expect(vote.getAttribute('title')).toMatch(/dot vote/i);
    fireEvent.click(author);
    fireEvent.click(vote);
    expect(onTextStyle).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('hides row actions from a commenter and from a mixed sticky and text selection', () => {
    const commenter = mount(propsOf([TEXT], { canEdit: false }));
    expect(buttonNamesOf(commenter)).toEqual(['Comment']);
    expect(
      screen.getByRole('button', { name: 'Comment' }).getAttribute('aria-disabled'),
    ).toBeNull();
    cleanup();
    const mixed = mount(propsOf([NOTE, TEXT]));
    // A mixed selection takes the several-objects row instead, with no sticky or
    // text controls.
    expect(buttonNamesOf(mixed)).toEqual([
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      expect.stringMatching(/^Colour: /),
      'Group',
      'More',
    ]);
  });
});
