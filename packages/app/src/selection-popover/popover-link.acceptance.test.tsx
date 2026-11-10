// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import { normalizeLink, type ObjectId, type TextObject } from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleContext } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';

import { PopoverLinkButton } from './popover-link.js';
import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

const TEXT = {
  id: 'text-1' as ObjectId,
  type: 'text',
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
  height: 50,
  autoWidth: true,
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
} as TextObject;
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
 * Mounts a text selection with a document-backed fake engine.
 *
 * @param selection - Text objects selected in toolbar order.
 * @param overrides - Props varied by the case.
 * @returns The dispatch spy supplied to the popover.
 */
function mount(
  selection: readonly TextObject[],
  overrides: Partial<SelectionPopoverProps> = {},
): ReturnType<typeof vi.fn<(action: ShellAction) => void>> {
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
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props: SelectionPopoverProps = {
    engine,
    camera: createCameraSource(),
    selection,
    canEdit: true,
    isEditingText: false,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch,
    textStyle: STYLE,
    onTextStyle: vi.fn(),
    ...overrides,
  };
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
  return dispatch;
}

/**
 * Opens the Link dialog and returns its textbox.
 *
 * @returns The address field.
 */
function addressInput(): HTMLInputElement {
  // A text whose runs carry links names it "Links (N)".
  fireEvent.click(screen.getByRole('button', { name: /^Links? ?(?:$|:|\(\d+\))/ }));
  const dialog = screen.getByRole('dialog', { name: 'Link' });
  return within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Link address' });
}

describe('popover Link acceptance', () => {
  it('names the 28 px Link button for absent, shared and mixed destinations', () => {
    mount([TEXT, TEXT_2]);
    const absent = screen.getByRole('button', { name: 'Link' });
    expect(absent.getAttribute('aria-haspopup')).toBe('dialog');
    // jsdom applies no CSS-module styles: the 28 px box is pinned in Chrome (popover-controls.spec.ts).
    cleanup();
    mount([
      { ...TEXT, link: 'https://example.com/' },
      { ...TEXT_2, link: 'https://example.com/' },
    ]);
    expect(screen.getByRole('button', { name: 'Link: https://example.com/' })).toBeTruthy();
    cleanup();
    mount([
      { ...TEXT, link: 'https://example.com/' },
      { ...TEXT_2, link: 'https://other.com/' },
    ]);
    expect(screen.getByRole('button', { name: 'Link: Mixed' })).toBeTruthy();
  });

  it('prefills a shared link and shows its destination as text, never a navigation element', () => {
    const link = normalizeLink('https://example.com/?q=<img src=x onerror=alert(1)>');
    if (link === undefined) throw new Error('Fixture link must normalize');
    mount([
      { ...TEXT, link },
      { ...TEXT_2, link },
    ]);
    const input = addressInput();
    const dialog = screen.getByRole('dialog', { name: 'Link' });
    expect(input.value).toBe(link);
    const destination = dialog.querySelector('[data-link-destination]');
    expect(destination?.textContent).toBe(link);
    expect(destination?.tagName).not.toBe('A');
    expect(destination?.hasAttribute('href')).toBe(false);
    expect(dialog.querySelector('a[href], img')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Open link' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Remove link' })).toBeTruthy();
  });

  it('starts with an empty address for absent and mixed links', () => {
    mount([TEXT]);
    expect(addressInput().value).toBe('');
    cleanup();
    mount([{ ...TEXT, link: 'https://example.com/' }, TEXT_2]);
    expect(addressInput().value).toBe('');
  });

  it('normalizes an entered address and dispatches one change per selected text', () => {
    const dispatch = mount([TEXT, TEXT_2]);
    const input = addressInput();
    fireEvent.change(input, { target: { value: ' HTTPS://Example.com ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: TEXT.id, style: { link: 'https://example.com/' } },
        { id: TEXT_2.id, style: { link: 'https://example.com/' } },
      ],
    });
    expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull();
  });

  it('keeps the dialog open and reports an invalid address without dispatching', () => {
    const dispatch = mount([TEXT]);
    const input = addressInput();
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(
      'Use an http, https or mailto address without a user name or password.',
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Link' })).toBeTruthy();
  });

  it('removes the link from every selected text in one dispatch', () => {
    const selection = [
      { ...TEXT, link: 'https://example.com/' },
      { ...TEXT_2, link: 'https://other.com/' },
    ];
    const dispatch = mount(selection);
    addressInput();
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: TEXT.id, style: { link: undefined } },
        { id: TEXT_2.id, style: { link: undefined } },
      ],
    });
    expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull();
  });

  it('opens the exact stored destination with isolation features', () => {
    const link = 'https://example.com/';
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount([{ ...TEXT, link }]);
    addressInput();
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(link, '_blank', 'noopener,noreferrer');
  });

  it('does not offer Link to a commenter', () => {
    mount([TEXT], { canEdit: false });
    expect(screen.queryByRole('button', { name: /^Link(?:$|:)/ })).toBeNull();
  });
});

describe('item 12 run links in the selected text dialog', () => {
  const first = 'https://example.com/first';
  const second = 'mailto:team@example.com';
  const baseStyle = TEXT.runs[0]?.style;
  if (baseStyle === undefined) throw new Error('Missing text style fixture');
  const withLinks = (links: readonly string[], id = TEXT.id): TextObject => ({
    ...TEXT,
    id,
    text: 'x'.repeat(links.length),
    runs: links.map((link) => ({ length: 1, style: { ...baseStyle, link } })),
  });

  it('keeps the Link button reachable with only run links and opens each distinct safe link', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount([withLinks([first, second, first])]);
    // (): the button counts the distinct links.
    expect(screen.getByRole('button', { name: 'Links (2)' })).toBeTruthy();
    addressInput();
    const dialog = screen.getByRole('dialog', { name: 'Link' });
    expect(
      within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Link address' }).value,
    ).toBe('');
    expect(
      Array.from(
        dialog.querySelectorAll('[data-run-link-destination]'),
        (node) => node.textContent,
      ),
    ).toEqual([first, second]);
    expect(dialog.querySelector('[data-run-link-destination] a')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: `Open ${first}` }));
    fireEvent.click(within(dialog).getByRole('button', { name: `Open ${second}` }));
    expect(open.mock.calls).toEqual([
      [first, '_blank', 'noopener,noreferrer'],
      [second, '_blank', 'noopener,noreferrer'],
    ]);
  });

  it('lists at most five safe destinations in text order across selected texts', () => {
    const links = [0, 1, 2, 3, 4, 5].map((index) => `https://example.com/${String(index)}`);
    // Render the existing button directly: the document rejects unsafe stored links, while
    // this tests the dialog's defence when legacy or malformed selected data reaches it.
    render(
      <PopoverLinkButton
        selection={[
          withLinks([links[0] ?? '', 'javascript:alert(1)', links[1] ?? '', links[0] ?? '']),
          withLinks(
            [links[2] ?? '', 'data:text/html,bad', links[3] ?? '', links[4] ?? '', links[5] ?? ''],
            TEXT_2.id,
          ),
        ]}
        dispatch={vi.fn()}
      />,
    );
    flushFrames();
    addressInput();
    const dialog = screen.getByRole('dialog', { name: 'Link' });
    expect(
      Array.from(
        dialog.querySelectorAll('[data-run-link-destination]'),
        (node) => node.textContent,
      ),
    ).toEqual(links.slice(0, 5));
    expect(within(dialog).queryByRole('button', { name: /javascript:|data:/ })).toBeNull();
  });
});
