// @vitest-environment jsdom
// The Link dialog's list and the link shortcut: "Links (N)", each link's Open, Copy,
// Edit and Remove over every range that carries it, ⌘K / Ctrl+K opening the dialog, and the
// editing popover's chip while the caret is in a link.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId, PrincipalId, ShapeObject, StickyObject, TextObject } from '@canvas/schema';

import type { ShellAction } from '../state/shell-action.js';

import { EditingLinkButton } from './editing-link.js';
import type { PopoverStyleControlsProps } from './popover-controls.js';
import { PopoverLinkButton, runLinkEntriesOf } from './popover-link.js';

const A = 'https://example.com/a';
const B = 'mailto:team@example.com';
const STYLE = {
  fontFamily: 'Lora',
  fontSize: 16,
  color: [0.1, 0.2, 0.3, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};
const TEXT: TextObject = {
  id: 'text-1' as ObjectId,
  type: 'text',
  parentId: null,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  autoWidth: true,
  verticalAlign: 'top',
  text: 'ab cd ef',
  runs: [
    { length: 2, style: { ...STYLE, link: A } },
    { length: 4, style: STYLE },
    { length: 2, style: { ...STYLE, link: B } },
  ],
  align: 'left',
};
const NOTE = {
  ...TEXT,
  id: 'note-1' as ObjectId,
  type: 'sticky',
  color: [1, 0.9, 0.5, 1],
  autoWidth: false,
  aspect: 'square',
  text: 'xy',
  runs: [{ length: 2, style: { ...STYLE, link: A } }],
} as StickyObject;

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Runs the frames the popovers asked for. */
function flushFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/**
 * Renders the text row's Link for a selection.
 *
 * @param selection - The selected objects.
 * @returns The dispatch spy.
 */
function mountLinks(selection: readonly (TextObject | StickyObject)[]) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  render(<PopoverLinkButton selection={selection} dispatch={dispatch} />);
  flushFrames();
  return dispatch;
}

/**
 * Opens the dialog by its button.
 *
 * @returns The dialog.
 */
function openDialog(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /^Links \(\d+\)$/ }));
  flushFrames();
  return screen.getByRole('dialog', { name: 'Link' });
}

describe('runLinkEntriesOf', () => {
  it("gathers each link's ranges across selected texts and notes, in reading order", () => {
    const entries = runLinkEntriesOf([TEXT, NOTE]);
    expect(entries.map((entry) => entry.link)).toEqual([A, B]);
    expect([...(entries[0]?.ranges ?? [])]).toEqual([
      [TEXT.id, [{ start: 0, end: 2 }]],
      [NOTE.id, [{ start: 0, end: 2 }]],
    ]);
  });
});

describe('the Links list', () => {
  it('names the button by how many links the text carries', () => {
    mountLinks([TEXT]);
    expect(screen.getByRole('button', { name: 'Links (2)' })).toBeTruthy();
  });

  it('removes a link from every range that carries it, one action for every text', () => {
    const dispatch = mountLinks([TEXT, NOTE]);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: `Remove ${A}` }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'relinkText',
      targets: [
        { id: TEXT.id, ranges: [{ start: 0, end: 2 }] },
        { id: NOTE.id, ranges: [{ start: 0, end: 2 }] },
      ],
      from: A,
      link: null,
    });
  });

  it('edits a link in place, refusing an unsafe address', () => {
    const dispatch = mountLinks([TEXT]);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: `Edit ${B}` }));
    const fields = within(dialog).getAllByRole<HTMLInputElement>('textbox', {
      name: 'Link address',
    });
    const field = fields.at(-1);
    if (field === undefined) throw new Error('No field');
    expect(field.value).toBe(B);
    fireEvent.change(field, { target: { value: 'data:text/html,hi' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'https://example.com/c' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'relinkText',
      targets: [{ id: TEXT.id, ranges: [{ start: 6, end: 8 }] }],
      from: B,
      link: 'https://example.com/c',
    });
  });

  it('copies a link and says so on its button', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mountLinks([TEXT]);
    const dialog = openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: `Copy ${A}` }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(A);
    expect(within(dialog).getByRole('button', { name: `Copy ${A}` }).textContent).toBe('Copied');
  });
});

describe('the link shortcut', () => {
  it('opens the Link dialog on Ctrl+K off a Mac', () => {
    mountLinks([TEXT]);
    const key = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(key);
    });
    flushFrames();
    expect(key.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Link' })).toBeTruthy();
  });

  it('leaves a key typed in a field to the field', () => {
    mountLinks([TEXT]);
    const field = document.createElement('input');
    document.body.append(field);
    const key = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      field.dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull();
    field.remove();
  });

  it.each([
    ['with Shift', { shiftKey: true }],
    ['with Alt', { altKey: true }],
    ['as ⌘ off a Mac', { metaKey: true, ctrlKey: false }],
  ])('ignores the key %s', (ignored, fields) => {
    mountLinks([TEXT]);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, ...fields }),
      );
    });
    expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull();
  });
});

/**
 * Renders the editing popover's Link for a text whose selection shares `style`.
 *
 * @param style - The selection's shared style.
 * @returns The text style spy.
 */
function mountEditing(style: Readonly<Record<string, unknown>>) {
  const onTextStyle = vi.fn();
  const controls = {
    textStyle: { style, align: 'left', isEditing: true },
    onTextStyle,
  } as unknown as PopoverStyleControlsProps;
  render(<EditingLinkButton controls={controls} />);
  flushFrames();
  return onTextStyle;
}

describe('the editing popover link chip', () => {
  it('shows the link the caret is in, with Open, Edit and Remove', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onTextStyle = mountEditing({ link: A });
    const chip = screen.getByRole('group', { name: 'Link' });
    expect(chip.querySelector('[data-link-chip-address]')?.textContent).toBe('example.com/a');
    fireEvent.click(within(chip).getByRole('button', { name: `Open ${A}` }));
    expect(open).toHaveBeenCalledExactlyOnceWith(A, '_blank', 'noopener,noreferrer');
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove link' }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { link: null },
    });
  });

  it("opens the Link dialog from the chip's Edit", () => {
    mountEditing({ link: A });
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    flushFrames();
    expect(screen.getByRole('dialog', { name: 'Link' })).toBeTruthy();
  });

  it.each([
    ['no link', { link: undefined }],
    ['a mixed link', {}],
  ])('shows no chip for %s', (ignored, style) => {
    mountEditing(style);
    expect(screen.queryByRole('group', { name: 'Link' })).toBeNull();
  });

  it("opens the Link dialog on Ctrl+K from the edited text's input", () => {
    mountEditing({ link: undefined });
    const input = document.createElement('textarea');
    input.setAttribute('data-text-input', '');
    document.body.append(input);
    const key = new KeyboardEvent('keydown', {
      key: 'K',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(key);
    });
    flushFrames();
    expect(key.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Link' })).toBeTruthy();
    input.remove();
  });
});

describe("a shape's or connector's label links (owner feedback)", () => {
  const shapeLabel = { text: TEXT.text, runs: TEXT.runs };
  const shape = {
    ...TEXT,
    id: 'shape-1' as ObjectId,
    type: 'shape',
    kind: 'rectangle',
    stroke: null,
    fill: null,
    cornerRadius: 0,
    sides: 4,
    label: shapeLabel,
  } as unknown as ShapeObject;

  it('gathers a label’s links', () => {
    expect(runLinkEntriesOf([shape]).map((entry) => entry.link)).toEqual([A, B]);
    expect(runLinkEntriesOf([{ ...shape, label: null }])).toEqual([]);
  });

  it('lists the label’s links alone, with no address field', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(<PopoverLinkButton selection={[shape]} dispatch={dispatch} isListOnly />);
    flushFrames();
    const dialog = openDialog();
    expect(within(dialog).queryByRole('textbox', { name: 'Link address' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: `Remove ${B}` }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'relinkText',
      targets: [{ id: shape.id, ranges: [{ start: 6, end: 8 }] }],
      from: B,
      link: null,
    });
  });
});
