// Written before the code. CONTRACT: the floating editing row edits the selected run link with's dialog and returns focus to text. Deliberately not asserted: stored run splitting, which the scenario and tools tests cover.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { ObjectId, TextObject, PrincipalId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { TextStyleChange } from '../engine/text-style-types.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

const STYLE = {
  fontFamily: 'Lora',
  fontSize: 16,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};
const TEXT: TextObject = {
  id: 'text' as ObjectId,
  type: 'text',
  parentId: null,
  x: 300,
  y: 250,
  width: 100,
  height: 30,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  text: 'Hello',
  runs: [{ length: 5, style: STYLE }],
  align: 'left',
  verticalAlign: 'top',
  autoWidth: true,
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

function mount(link: string | undefined, isMixed = false) {
  const store = new YjsDocumentStore({ clientId: 649 });
  const object = isMixed
    ? {
        ...TEXT,
        runs: [
          { length: 2, style: { ...STYLE, link: 'https://example.com/guide' } },
          { length: 3, style: STYLE },
        ],
      }
    : TEXT;
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(object);
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
  const onTextStyle = vi.fn<(change: TextStyleChange) => void>();
  const props: SelectionPopoverProps = {
    engine,
    camera: createCameraSource(),
    selection: [],
    canEdit: true,
    isEditingText: true,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch: vi.fn(),
    textStyle: {
      style: { ...STYLE, ...(isMixed ? {} : { link }) },
      align: 'left',
      isEditing: true,
      edited: { id: TEXT.id, type: 'text' },
    },
    onTextStyle,
  };
  render(
    <main>
      <textarea data-text-input="" />
      <SelectionPopover {...props} />
    </main>,
  );
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
  const toolbar = screen.getByRole('toolbar', { name: 'Text' });
  return { toolbar, onTextStyle };
}

function editor(toolbar: HTMLElement) {
  fireEvent.click(within(toolbar).getByRole('button', { name: /^Link(?:$|:)/ }));
  const dialog = screen.getByRole('dialog', { name: 'Link' });
  return {
    dialog,
    field: within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Link address' }),
  };
}

describe('editing Link control', () => {
  it('comes after text colour, normalizes on Enter, and returns focus to the editing input', () => {
    const { toolbar, onTextStyle } = mount(undefined);
    const labels = [...toolbar.querySelectorAll('button')].map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(labels.indexOf('Link')).toBe(
      labels.findIndex((label) => label?.startsWith('Text colour:')) + 1,
    );
    const { field } = editor(toolbar);
    fireEvent.change(field, { target: { value: ' HTTPS://Example.com/guide ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { link: 'https://example.com/guide' },
    });
    expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(document.body.contains(toolbar)).toBe(true);
  });

  it('shows the destination as text, opens it, and removes it with a null patch', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { toolbar, onTextStyle } = mount('https://example.com/guide');
    const { dialog, field } = editor(toolbar);
    expect(field.value).toBe('https://example.com/guide');
    expect(dialog.querySelector('[data-link-destination]')?.textContent).toBe(field.value);
    expect(dialog.querySelector('a[href]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open link' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(field.value, '_blank', 'noopener,noreferrer');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove link' }));
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'style', patch: { link: null } });
  });

  it('offers Remove for a mixed range but starts with an empty field', () => {
    const { toolbar } = mount(undefined, true);
    const { dialog, field } = editor(toolbar);
    expect(field.value).toBe('');
    expect(within(dialog).getByRole('button', { name: 'Remove link' })).toBeTruthy();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/plain,x',
    'https://user:pass@example.com/',
    'bareword',
  ])('refuses %s with the shared invalid message', (bad) => {
    const { toolbar, onTextStyle } = mount(undefined);
    const { dialog, field } = editor(toolbar);
    fireEvent.change(field, { target: { value: bad } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Use an http, https or mailto address without a user name or password.',
    );
    expect(onTextStyle).not.toHaveBeenCalled();
  });
});
