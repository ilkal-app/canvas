// @vitest-environment jsdom
// The inspector's contents by selection (Figma "Inspector by selection"): each kind's
// sections in order, several of a kind and of several kinds, a locked selection, nothing
// selected with and without a tool, collapsible sections remembered per kind, and the header's
// lock and "more" menu. The arrange buttons: sections/arrange-section.test.tsx; the layout
// fields' commands: engine/engine-document-layout.test.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { BoardViewSnapshot } from '../hooks/use-board-view-state.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';

import { memoryShape } from './__fixtures__/memory-board.js';
import { createDefaultStylePanelRegistry } from './default-style-sections.js';
import { InspectorHeaderActions, moreMenuEntries } from './inspector-header.js';
import { panelContextOf, selectionContextOf } from './panel-sections.js';
import { SectionCollapseStore } from './section-collapse.js';
import { StylePanel } from './style-panel.js';

const REGISTRY = createDefaultStylePanelRegistry();
const SHORTCUTS = createDefaultShortcutRegistry('mac');

afterEach(cleanup);

const STROKE = { color: [0, 0, 0, 1], width: 2 };

/** One object of each kind the frames show, with the fields its sections read. */
const KINDS: Readonly<Record<string, Record<string, unknown>>> = {
  note: { type: 'sticky', color: [1, 0.9, 0.5, 1] },
  text: { type: 'text' },
  shape: { type: 'shape' },
  star: { type: 'shape', kind: 'star', sides: 5 },
  path: { type: 'path', stroke: STROKE, fill: null, vertices: [], segments: [] },
  line: {
    type: 'line',
    stroke: STROKE,
    startCap: 'none',
    endCap: 'arrow',
    route: 'straight',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  },
  connector: {
    type: 'connector',
    stroke: STROKE,
    startCap: 'none',
    endCap: 'arrow',
    route: 'straight',
    from: { kind: 'point', x: 0, y: 0 },
    to: { kind: 'point', x: 10, y: 0 },
  },
  image: { type: 'image', opacity: 1, assetId: 'asset' },
  frame: { type: 'frame', name: 'Story map', background: null, clip: true },
  group: { type: 'group' },
};

function objectOf(kind: string, id = kind, fields: Record<string, unknown> = {}): BoardObject {
  return { ...memoryShape(id, 'a0'), ...KINDS[kind], ...fields };
}

interface Rendered {
  readonly dispatch: ReturnType<typeof vi.fn<(action: ShellAction) => void>>;
  readonly collapse: SectionCollapseStore;
}

function renderPanel(
  selection: readonly BoardObject[],
  options: { activeTool?: ToolId; collapse?: SectionCollapseStore } = {},
): Rendered {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const byId = new Map(selection.map((object) => [object.id, object]));
  const reader = { get: (id: ObjectId) => byId.get(id) };
  const activeTool = options.activeTool ?? 'select';
  const context = panelContextOf(
    selectionContextOf(
      selection.map(({ id }) => id),
      reader,
    ),
    activeTool,
  );
  const collapse = options.collapse ?? new SectionCollapseStore();
  const board = {
    documentVersion: 0,
    selectedIds: selection.map(({ id }) => id),
    enteredGroupId: null,
    board: reader,
  } as unknown as BoardViewSnapshot;
  render(
    <StylePanel
      registry={REGISTRY}
      context={context}
      board={board}
      selection={selection}
      activeTool={activeTool}
      toolStyles={{}}
      dispatch={dispatch}
      shortcuts={SHORTCUTS}
      collapse={collapse}
    />,
  );
  return { dispatch, collapse };
}

const sectionIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-section]')].map((s) => s.dataset.section);

const collapsedIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-section][data-collapsed]')].map(
    (s) => s.dataset.section,
  );

const toggleOf = (title: string): HTMLElement =>
  screen.getByRole('region', { name: title }).querySelector('h3 button') ?? document.body;

describe('the inspector’s sections by selection', () => {
  it.each<[string, string[], string[]]>([
    ['note', ['note', 'layer', 'text-style', 'layout', 'arrange'], ['layout']],
    ['text', ['layer', 'text-style', 'layout', 'arrange'], []],
    [
      'shape',
      ['shape', 'layer', 'fill-stroke', 'text-style', 'effects', 'layout', 'arrange'],
      ['text-style'],
    ],
    [
      'star',
      ['shape', 'layer', 'fill-stroke', 'text-style', 'effects', 'layout', 'arrange'],
      ['text-style'],
    ],
    ['path', ['layer', 'fill-stroke', 'layout', 'arrange'], []],
    ['line', ['layer', 'line', 'arrange'], []],
    ['connector', ['layer', 'line', 'arrange'], []],
    ['image', ['layer', 'image', 'layout', 'arrange'], []],
    [
      'frame',
      [
        'frame',
        'layer',
        'auto-layout',
        'colour-mode',
        'fill-stroke',
        'effects',
        'layout',
        'arrange',
      ],
      [],
    ],
    ['group', ['layer', 'layout', 'arrange'], []],
  ])('shows a %s its sections in order, %j, collapsed %j', (kind, ids, collapsed) => {
    renderPanel([objectOf(kind)]);
    expect(sectionIds()).toEqual(ids);
    expect(collapsedIds()).toEqual(collapsed);
  });

  it('shows auto layout for frames and mains together, and not beside other kinds', () => {
    const main = objectOf('frame', 'main', { type: 'component', retired: false });
    renderPanel([objectOf('frame'), main]);
    expect(sectionIds()).toContain('auto-layout');
    cleanup();
    renderPanel([objectOf('frame'), objectOf('shape')]);
    expect(sectionIds()).not.toContain('auto-layout');
  });

  it('heads the fill and stroke section Stroke for a frame, Fill and stroke for a shape', () => {
    renderPanel([objectOf('frame')]);
    expect(screen.getByRole('region', { name: 'Stroke' })).toBeTruthy();
    cleanup();
    renderPanel([objectOf('shape')]);
    expect(screen.getByRole('region', { name: 'Fill and stroke' })).toBeTruthy();
  });

  it('shows a shape’s text expanded once the shape has a label', () => {
    renderPanel([objectOf('shape', 'shape', { label: { text: 'Go', runs: [] } })]);
    expect(collapsedIds()).toEqual([]);
  });

  it('shows a star its points and a polygon its sides', () => {
    renderPanel([objectOf('star')]);
    expect(screen.getByLabelText('Points')).toBeInstanceOf(HTMLInputElement);
    cleanup();
    renderPanel([objectOf('shape', 'p', { kind: 'polygon', sides: 6 })]);
    expect(screen.getByLabelText('Sides')).toBeInstanceOf(HTMLInputElement);
  });

  it('enables Ungroup for a group', () => {
    renderPanel([objectOf('group')]);
    expect(screen.getByRole('button', { name: /^Ungroup/ }).getAttribute('aria-disabled')).toBe(
      null,
    );
  });

  it('shows several of one kind that kind’s sections, “Mixed” where they differ', () => {
    renderPanel([
      objectOf('note', 'a', { color: [1, 0.9, 0.5, 1] }),
      objectOf('note', 'b', { color: [0.6, 0.8, 1, 1], x: 40 }),
    ]);
    expect(sectionIds()).toEqual(['note', 'layer', 'text-style', 'layout', 'arrange']);
    // No swatch pressed while the colours differ.
    const palette = screen.getByRole('group', { name: 'Note colour' });
    for (const swatch of within(palette).getAllByRole('button')) {
      expect(swatch.getAttribute('aria-pressed')).toBe('false');
    }
    // The layout says so collapsed, and each field that differs reads Mixed when open.
    expect(screen.getByRole('region', { name: 'Layout' }).textContent).toContain('Mixed');
    fireEvent.click(toggleOf('Layout'));
    expect(screen.getByLabelText('X (mixed)')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText<HTMLInputElement>('Y').value).toBe('0');
  });

  it('shows several kinds a note to select one kind, and the arrange section', () => {
    renderPanel([objectOf('note'), objectOf('shape'), objectOf('connector')]);
    expect(sectionIds()).toEqual(['mixed-kinds', 'layer', 'arrange']);
    expect(screen.getByText('Select one kind of object to change its style.')).toBeInstanceOf(
      HTMLElement,
    );
  });

  it('disables every section of a locked selection, under a banner, the sections still opening', () => {
    renderPanel([objectOf('note', 'n', { locked: true })]);
    // The Layer section's slider read-out is a status too (an <output>): find the banner by text.
    expect(screen.getAllByRole('status').map(({ textContent }) => textContent)).toContain(
      'Locked — unlock to edit · ⇧⌘L',
    );
    for (const region of screen.getAllByRole('region')) {
      const body = region.querySelector('fieldset');
      if (body === null) continue;
      const controls = within(body).queryAllByRole('button');
      if (region.dataset.section === 'arrange') {
        for (const control of controls) expect(control.getAttribute('aria-disabled')).toBe('true');
      } else {
        expect(body.disabled, region.dataset.section).toBe(true);
      }
    }
    // The collapsed layout still opens, its fields disabled.
    fireEvent.click(toggleOf('Layout'));
    const layout = screen.getByRole('region', { name: 'Layout' });
    expect(layout.querySelector('fieldset')?.disabled).toBe(true);
  });

  it('asks for a selection with no tool, with the connector preference as a switch', () => {
    const { dispatch } = renderPanel([]);
    // The board's colours are the one section with nothing selected.
    expect(sectionIds()).toEqual(['board-colours']);
    expect(screen.getByText('Select an object to change its style.')).toBeInstanceOf(HTMLElement);
    fireEvent.click(screen.getByRole('switch', { name: 'Delete connectors with their objects' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleDeleteConnectors' });
  });

  it('shows a creation tool’s style with nothing selected, without the selection’s sections', () => {
    renderPanel([], { activeTool: 'sticky' });
    expect(sectionIds()).toEqual(['note', 'text-style']);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('collapsible sections', () => {
  it('collapses and expands a section from its header, remembered per kind for the session', () => {
    const collapse = new SectionCollapseStore();
    renderPanel([objectOf('shape')], { collapse });
    const toggle = toggleOf('Fill and stroke');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(collapsedIds()).toEqual(['fill-stroke', 'text-style']);
    expect(toggleOf('Fill and stroke').getAttribute('aria-expanded')).toBe('false');
    // The note's layout, collapsed by default, opens; a shape keeps its own choices.
    cleanup();
    renderPanel([objectOf('note')], { collapse });
    fireEvent.click(toggleOf('Layout'));
    expect(collapsedIds()).toEqual([]);
    cleanup();
    renderPanel([objectOf('shape', 'other')], { collapse });
    expect(collapsedIds()).toEqual(['fill-stroke', 'text-style']);
    cleanup();
    renderPanel([objectOf('note', 'other')], { collapse });
    expect(collapsedIds()).toEqual([]);
    // Another kind with the same section starts from its own default.
    cleanup();
    renderPanel([objectOf('path')], { collapse });
    expect(collapsedIds()).toEqual([]);
  });

  it('keeps the focus where it was when a section header is pressed', () => {
    renderPanel([objectOf('shape')]);
    const toggle = toggleOf('Fill and stroke');
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    toggle.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('summarises the collapsed layout in its header', () => {
    renderPanel([objectOf('note', 'n', { x: 412, y: 268, width: 176, height: 120 })]);
    expect(toggleOf('Layout').textContent).toBe('Layout176 × 120 at 412, 268');
  });

  it('re-renders every mounted panel when a choice is recorded elsewhere', () => {
    const collapse = new SectionCollapseStore();
    renderPanel([objectOf('shape')], { collapse });
    act(() => {
      collapse.choose('shape', 'arrange', true);
    });
    expect(collapsedIds()).toContain('arrange');
  });
});

describe('the inspector header’s actions', () => {
  function renderActions(selection: readonly BoardObject[]) {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(
      <InspectorHeaderActions selection={selection} shortcuts={SHORTCUTS} dispatch={dispatch} />,
    );
    return dispatch;
  }

  it('locks and unlocks the selection with toggleLock (⇧⌘L), pressed while it is locked', () => {
    const dispatch = renderActions([objectOf('shape')]);
    const lock = screen.getByRole('button', { name: 'Lock (⇧⌘L)' });
    expect(lock.getAttribute('aria-pressed')).toBe('false');
    expect(lock.getAttribute('aria-keyshortcuts')).toBe('Shift+Meta+L');
    expect(document.getElementById(lock.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Lock⇧⌘L',
    );
    fireEvent.click(lock);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'selection', command: 'toggleLock' });
    cleanup();
    renderActions([objectOf('shape', 'a', { locked: true })]);
    const locked = screen.getByRole('button', { name: 'Lock (⇧⌘L)' });
    expect(locked.getAttribute('aria-pressed')).toBe('true');
    expect(
      document.getElementById(locked.getAttribute('aria-describedby') ?? '')?.firstChild
        ?.textContent,
    ).toBe('Unlock');
  });

  it('keeps the focus where it was when the lock is pressed', () => {
    const dispatch = renderActions([objectOf('shape')]);
    const lock = screen.getByRole('button', { name: 'Lock (⇧⌘L)' });
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    lock.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('opens a “more” menu of the selection’s commands, each dispatching its shortcut’s action', () => {
    const dispatch = renderActions([objectOf('shape')]);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.firstChild?.textContent)).toEqual(
      moreMenuEntries(SHORTCUTS, [objectOf('shape')]).map((entry) => entry.label),
    );
    expect(items.map((item) => item.firstChild?.textContent)).toContain('Duplicate');
    const duplicate = within(menu).getByRole('menuitem', { name: /^Duplicate/ });
    fireEvent.click(duplicate);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'selection', command: 'duplicate' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers no lock with nothing selected, and the empty canvas’s commands in its menu', () => {
    renderActions([]);
    expect(screen.queryByRole('button', { name: /^Lock/ })).toBeNull();
    expect(moreMenuEntries(SHORTCUTS, []).map((entry) => entry.label)).toEqual([
      'Select all',
      'Paste',
    ]);
    expect(moreMenuEntries(SHORTCUTS, [objectOf('shape')]).map((e) => e.label)).not.toContain(
      'Lock or unlock',
    );
  });

  it('offers a locked selection only the commands that change nothing: no duplicate, cut or delete', () => {
    const lockedShape = objectOf('shape', 'a', { locked: true });
    const locked = [lockedShape, objectOf('note', 'b', { locked: true })];
    const labels = moreMenuEntries(SHORTCUTS, locked).map((entry) => entry.label);
    expect(labels).toContain('Copy');
    for (const label of ['Duplicate', 'Cut', 'Delete']) expect(labels).not.toContain(label);
    renderActions(locked);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'More' });
    expect(within(menu).queryByRole('menuitem', { name: /^Duplicate/ })).toBeNull();
    // One unlocked object in the selection keeps the full menu, as the sections do.
    expect(
      moreMenuEntries(SHORTCUTS, [lockedShape, objectOf('note', 'c')]).map((entry) => entry.label),
    ).toContain('Duplicate');
  });
});
