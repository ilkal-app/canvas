// CONTRACT: a commenter gets an enabled selection Comment.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import type { CommentPlacement } from '../comments/comment-placement.js';
import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

const RECT = {
  id: 'primary' as ObjectId,
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 400,
  y: 300,
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
} as unknown as BoardObject;

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

/** Runs the pending placement frames. */
function runFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/**
 * Makes a selected board whose primary object's centre is (450, 325).
 *
 * @returns The mounted test engine.
 */
function makeEngine(): FakeMountedEngine {
  const store = new YjsDocumentStore({ clientId: 12 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(RECT);
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
  engine.select([RECT.id]);
  return engine;
}

/**
 * Supplies a selection with editable defaults.
 *
 * @param engine - The selected board.
 * @param overrides - Properties for the case.
 * @returns Popover properties.
 */
function propsOf(
  engine: FakeMountedEngine,
  overrides: Partial<SelectionPopoverProps> = {},
): SelectionPopoverProps {
  return {
    engine,
    camera: createCameraSource(),
    selection: [RECT],
    canEdit: true,
    isEditingText: false,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch: vi.fn(),
    ...overrides,
  };
}

/**
 * Places the popover inside the focusable whiteboard shell and canvas mount.
 *
 * @param props - Shell contents.
 * @param props.children - Popover and any adjacent control.
 * @returns The shell.
 */
function Shell(props: { readonly children: ReactNode }): ReactElement {
  return (
    <div data-whiteboard-chrome="floating" tabIndex={-1} data-testid="shell">
      <main aria-label="Canvas">
        <canvas />
        {props.children}
      </main>
    </div>
  );
}

/**
 * Supplies the signed-in comment contexts without starting a service.
 *
 * @param overrides - Comment state or action for the case.
 * @returns Comment data and a writable mode.
 */
function comments(overrides: Partial<CommentData> = {}): {
  readonly data: CommentData;
  readonly mode: CommentMode;
} {
  const data = {
    connection: { store: { read: () => ({ objects: new Map([[RECT.id, RECT]]) }) } },
    selectedId: undefined,
    placement: undefined,
    place: vi.fn(),
    ...overrides,
  } as unknown as CommentData;
  const mode = {
    isPlacing: false,
    canWrite: true,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  return { data, mode };
}

/**
 * Mounts the popover with comment contexts.
 *
 * @param props - Selection properties.
 * @param props.popover - Selection properties.
 * @param props.data - Comment state.
 * @param props.mode - Comment permission.
 * @returns The wrapped popover.
 */
function WithComments(props: {
  readonly popover: SelectionPopoverProps;
  readonly data: CommentData;
  readonly mode: CommentMode;
}): ReactElement {
  return (
    <commentContext.Provider value={props.mode}>
      <commentDataContext.Provider value={props.data}>
        <Shell>
          <SelectionPopover {...props.popover} />
        </Shell>
      </commentDataContext.Provider>
    </commentContext.Provider>
  );
}

/**
 * The popover row's first control, where Tab lands: More on a row with no style controls, the
 * first of a shape's (Fill) since.
 *
 * @returns The control.
 * @throws {Error} When the popover has no control.
 */
function firstControl(): HTMLElement {
  const first = screen.getByRole('toolbar', { name: 'Selection' }).querySelector('button');
  if (first === null) throw new Error('The popover has no control.');
  return first;
}

describe('keyboard acceptance', () => {
  it('plain Tab from the shell enters the placed popover and Escape restores focus without deselecting', () => {
    const engine = makeEngine();
    const dispatch = vi.fn();
    render(
      <Shell>
        <SelectionPopover {...propsOf(engine, { dispatch })} />
      </Shell>,
    );
    runFrames();
    const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
    expect(toolbar.dataset.hidden).toBeUndefined();
    const shell = screen.getByTestId('shell');
    shell.focus();
    const windowKeys = vi.fn();
    window.addEventListener('keydown', windowKeys);
    try {
      expect(fireEvent.keyDown(shell, { key: 'Tab' })).toBe(false);
      const more = firstControl();
      expect(document.activeElement).toBe(more);
      fireEvent.keyDown(more, { key: 'Escape' });
      expect(document.activeElement).toBe(shell);
      expect(
        windowKeys.mock.calls.some(([event]) => (event as KeyboardEvent).key === 'Escape'),
      ).toBe(false);
      expect(engine.board.state().selectedIds).toEqual([RECT.id]);
      expect(dispatch).not.toHaveBeenCalled();
      expect(screen.getByRole('toolbar', { name: 'Selection' })).toBe(toolbar);
    } finally {
      window.removeEventListener('keydown', windowKeys);
    }
  });

  it('Escape falls back to the shell root when Tab began with focus on the document body', () => {
    const engine = makeEngine();
    render(
      <Shell>
        <SelectionPopover {...propsOf(engine)} />
      </Shell>,
    );
    runFrames();
    expect(document.activeElement).toBe(document.body);
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    const more = firstControl();
    expect(document.activeElement).toBe(more);
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByTestId('shell'));
    expect(engine.board.state().selectedIds).toEqual([RECT.id]);
  });

  it('leaves modified Tab and Tab from controls to the browser', () => {
    const engine = makeEngine();
    render(
      <Shell>
        <input aria-label="Name" />
        <SelectionPopover {...propsOf(engine)} />
      </Shell>,
    );
    runFrames();
    const shell = screen.getByTestId('shell');
    for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const) {
      shell.focus();
      expect(fireEvent.keyDown(shell, { key: 'Tab', [modifier]: true })).toBe(true);
      expect(document.activeElement).toBe(shell);
    }
    const input = screen.getByRole('textbox', { name: 'Name' });
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(input);
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    expect(fireEvent.keyDown(more, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(more);
  });

  it('does not intercept Tab before placement or while the popover is not shown', () => {
    const engine = makeEngine();
    const popover = propsOf(engine);
    const { rerender } = render(
      <Shell>
        <SelectionPopover {...popover} />
      </Shell>,
    );
    const shell = screen.getByTestId('shell');
    shell.focus();
    expect(screen.getByRole('toolbar', { name: 'Selection', hidden: true }).dataset.hidden).toBe(
      '',
    );
    expect(fireEvent.keyDown(shell, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(shell);
    rerender(
      <Shell>
        <SelectionPopover {...popover} selection={[]} />
      </Shell>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    expect(fireEvent.keyDown(shell, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(shell);
  });
});

describe('comment acceptance', () => {
  it('shows Comment and More to an editor, Comment alone to a commenter, and nothing to a viewer', () => {
    const engine = makeEngine();
    const place = vi.fn();
    const { data, mode } = comments({ place });
    const { rerender } = render(<WithComments popover={propsOf(engine)} data={data} mode={mode} />);
    runFrames();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    rerender(
      <WithComments popover={propsOf(engine, { canEdit: false })} data={data} mode={mode} />,
    );
    runFrames();
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();
    const commenterComment = screen.getByRole('button', { name: 'Comment' });
    expect(commenterComment.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(commenterComment);
    expect(place).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    rerender(
      <WithComments
        popover={propsOf(engine, { canEdit: false })}
        data={data}
        mode={{ ...mode, canWrite: false }}
      />,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
  });

  it('places one comment at the primary selected object’s world-bounds centre', () => {
    const engine = makeEngine();
    const other = { ...RECT, id: 'secondary' as ObjectId, x: 700, y: 600 };
    engine.store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(other);
    });
    engine.select([RECT.id, other.id]);
    const place = vi.fn<(placement: CommentPlacement) => void>();
    const { data, mode } = comments({ place });
    render(
      <WithComments
        popover={propsOf(engine, { selection: [RECT, other] })}
        data={data}
        mode={mode}
      />,
    );
    runFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(place).toHaveBeenCalledOnce();
    expect(place.mock.calls[0]?.[0].point).toEqual({ x: 450, y: 325 });
  });

  it.each(['selectedId', 'placement'] as const)(
    'closes the popover and clears engine selection when %s opens',
    (opened) => {
      const engine = makeEngine();
      const select = vi.spyOn(engine.board, 'select');
      const { data, mode } = comments();
      const popover = propsOf(engine);
      const { rerender } = render(<WithComments popover={popover} data={data} mode={mode} />);
      runFrames();
      expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();
      expect(engine.board.state().selectedIds).toEqual([RECT.id]);
      const nextData =
        opened === 'selectedId'
          ? { ...data, selectedId: 'thread-1' }
          : {
              ...data,
              placement: {
                id: 'comment-1' as ObjectId,
                point: { x: 450, y: 325 },
                anchor: { kind: 'point' as const },
              },
            };
      rerender(<WithComments popover={popover} data={nextData} mode={mode} />);
      expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
      expect(select).toHaveBeenCalledWith([]);
      expect(engine.board.state().selectedIds).toEqual([]);
    },
  );
});
