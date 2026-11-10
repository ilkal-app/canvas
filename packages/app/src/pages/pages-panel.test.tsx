// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { createPageView } from './create-page-view.js';
import { PageRow } from './page-row.js';
import { PagesPanel } from './pages-panel.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

/**
 * A board with a sticky-like rectangle on Page 1, and its pages.
 *
 * @returns The store and the pages.
 */
function board() {
  const store = new YjsDocumentStore();
  const environment = { clock: () => 1, createId: createSeededIdGenerator(9) };
  const { pages, release } = createPageView(store, ORIGIN, environment, {});
  return { store, pages, release };
}

/**
 * A rectangle at the root, on the page shown when the store writes it.
 *
 * @param id - Its id.
 * @returns The object.
 */
function box(id: string): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 10,
    height: 10,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1],
  };
}

/**
 * A drag event carrying a page row's drag data, at a height.
 *
 * @param type - The event type.
 * @param data - The drag data, by type.
 * @param clientY - The pointer's height, CSS px.
 * @returns The event.
 */
function dragEvent(type: string, data: Record<string, string>, clientY = 0): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: Object.keys(data),
      getData: (format: string) => data[format] ?? '',
      setData: (format: string, value: string) => {
        data[format] = value;
      },
    },
  });
  return event;
}

const PAGE_DRAG_TYPE = 'application/x-canvas-page';

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('PagesPanel', () => {
  it('adds, shows and renames pages', () => {
    const { store, pages, release } = board();
    render(<PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Pages' });
    // The + is the shared plus icon, as the Layers section's × is the close icon.
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(add.querySelector('svg')?.dataset.icon).toBe('plus');
    expect(add.textContent).toBe('');
    act(() => {
      fireEvent.click(add);
    });
    expect(region.textContent).toContain('Page 2');
    expect(pages.current()).not.toBe('page-1');
    act(() => {
      fireEvent.click(screen.getByText('Page 1'));
    });
    expect(pages.current()).toBe('page-1');
    act(() => {
      fireEvent.doubleClick(screen.getByText('Page 1'));
    });
    const input = screen.getByRole('textbox', { name: 'Page name' });
    act(() => {
      fireEvent.change(input, { target: { value: 'Plan' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(store.readPages().get('page-1' as PageId)?.name).toBe('Plan');
    release();
    store.destroy();
  });

  it('duplicates, refuses deleting the only page, deletes after confirming, and moves a selection', () => {
    const { store, pages, release } = board();
    const notice = vi.fn();
    store.transact(ORIGIN, (tx) => {
      tx.setObject({
        id: 'box' as ObjectId,
        type: 'shape',
        parentId: null,
        x: 0,
        y: 0,
        rotation: 0,
        z: 'a0',
        locked: false,
        createdBy: ORIGIN.principalId,
        createdAt: 1,
        updatedAt: 1,
        width: 10,
        height: 10,
        kind: 'rectangle',
        cornerRadius: 0,
        sides: 4,
        label: null,
        stroke: null,
        fill: [1, 0, 0, 1],
      });
    });
    const view = render(
      <PagesPanel pages={pages} canEdit selectedIds={['box' as ObjectId]} onNotice={notice} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'));
    });
    expect(screen.getByRole('menuitem', { name: 'Delete page' })).toHaveProperty('disabled', true);
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate page' }));
    });
    expect(screen.getByText('Page 1 copy')).toBeDefined();
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1 copy'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move selection here' }));
    });
    expect(notice).toHaveBeenCalledWith('Moved to Page 1 copy.', expect.anything());
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1 copy'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    expect(screen.getByRole('dialog').textContent).toContain('2 objects');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(store.readPages().size).toBe(1);
    view.unmount();
    release();
    store.destroy();
  });

  it('lets a viewer switch pages but not edit them', () => {
    const { store, pages, release } = board();
    pages.run('addPage', {});
    render(<PagesPanel pages={pages} canEdit={false} selectedIds={[]} onNotice={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add page' })).toBeNull();
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 2'));
      fireEvent.doubleClick(screen.getByText('Page 2'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    release();
    store.destroy();
  });

  it('reorders a page dragged onto the upper or lower half of another', () => {
    const { store, pages, release } = board();
    const second = (pages.run('addPage', {}) as { pageId: PageId }).pageId;
    const third = (pages.run('addPage', {}) as { pageId: PageId }).pageId;
    render(<PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={vi.fn()} />);
    const rowOf = (name: string): HTMLElement => {
      const row = screen.getByText(name).closest('li');
      if (row === null) throw new Error(`${name} has a row`);
      return row;
    };
    const data: Record<string, string> = {};
    act(() => {
      fireEvent(rowOf('Page 3'), dragEvent('dragstart', data));
    });
    expect(data[PAGE_DRAG_TYPE]).toBe(third);
    const plain = dragEvent('dragover', { 'text/plain': 'x' });
    act(() => {
      fireEvent(rowOf('Page 1'), plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(rowOf('Page 1').dataset.drop).toBe('false');
    act(() => {
      fireEvent(rowOf('Page 1'), dragEvent('dragover', data));
    });
    expect(rowOf('Page 1').dataset.drop).toBe('true');
    act(() => {
      fireEvent(rowOf('Page 1'), dragEvent('dragleave', data));
    });
    expect(rowOf('Page 1').dataset.drop).toBe('false');
    act(() => {
      fireEvent(rowOf('Page 1'), dragEvent('drop', data, -1));
    });
    expect(pages.pages().map(({ id }) => id)).toEqual([third, 'page-1', second]);
    act(() => {
      fireEvent(rowOf('Page 1'), dragEvent('drop', { [PAGE_DRAG_TYPE]: third }, 1));
    });
    expect(pages.pages().map(({ id }) => id)).toEqual(['page-1', third, second]);
    act(() => {
      fireEvent(rowOf('Page 3'), dragEvent('drop', data));
      fireEvent(rowOf('Page 2'), dragEvent('drop', {}));
    });
    expect(pages.pages().map(({ id }) => id)).toEqual(['page-1', third, second]);
    release();
    store.destroy();
  });

  it('renames from the menu, which Escape, a press outside or a choice closes', () => {
    const { store, pages, release } = board();
    render(<PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={vi.fn()} />);
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'));
    });
    const menu = screen.getByRole('menu', { name: 'Page Page 1' });
    act(() => {
      fireEvent.pointerDown(menu);
    });
    expect(screen.queryByRole('menu')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
    });
    expect(screen.queryByRole('menu')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'));
    });
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename page' }));
    });
    const input = screen.getByRole('textbox', { name: 'Page name' });
    act(() => {
      fireEvent.click(input);
      fireEvent.change(input, { target: { value: 'Dropped' } });
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(store.readPages().get('page-1' as PageId)?.name ?? 'Page 1').toBe('Page 1');
    release();
    store.destroy();
  });

  it('keeps a page when its deletion is cancelled, and counts one object or none', () => {
    const { store, pages, release } = board();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(box('one'));
    });
    pages.run('addPage', {});
    const view = render(<PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={vi.fn()} />);
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    expect(screen.getByRole('dialog').textContent).toContain('the 1 object on it');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.readPages().size).toBe(2);
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    view.rerender(<PagesPanel pages={undefined} canEdit selectedIds={[]} onNotice={vi.fn()} />);
    expect(screen.getByRole('dialog').textContent).toContain('the 0 objects on it');
    view.unmount();
    release();
    store.destroy();
  });

  it('offers to go to the page a selection moved to, and says nothing of a refused move', () => {
    const { store, pages, release } = board();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(box('one'));
    });
    pages.run('addPage', {});
    const notice = vi.fn();
    const view = render(
      <PagesPanel pages={pages} canEdit selectedIds={['ghost' as ObjectId]} onNotice={notice} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 2'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move selection here' }));
    });
    expect(notice).not.toHaveBeenCalled();
    view.rerender(
      <PagesPanel pages={pages} canEdit selectedIds={['one' as ObjectId]} onNotice={notice} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 2'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move selection here' }));
    });
    const action = notice.mock.calls[0]?.[1] as { label: string; run: () => void };
    expect(action.label).toBe('Go to Page 2');
    expect(pages.current()).toBe('page-1');
    act(() => {
      action.run();
    });
    expect(pages.current()).not.toBe('page-1');
    view.unmount();
    release();
    store.destroy();
  });
});

describe('PageRow', () => {
  it('ends a rename once, whatever ends it, and ignores other keys', () => {
    const onRename = vi.fn();
    const page = { id: 'page-1' as PageId, name: 'Plan', order: 'a0' } as never;
    render(
      <ol>
        <PageRow
          page={page}
          isCurrent
          isRenaming
          canEdit
          onShow={vi.fn()}
          onStartRename={vi.fn()}
          onRename={onRename}
          onMenu={vi.fn()}
          onDropPage={vi.fn()}
        />
      </ol>,
    );
    const input = screen.getByRole('textbox', { name: 'Page name' });
    act(() => {
      fireEvent.keyDown(input, { key: 'a' });
    });
    expect(onRename).not.toHaveBeenCalled();
    act(() => {
      fireEvent.change(input, { target: { value: 'Kept' } });
      fireEvent.blur(input);
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Kept');
  });
});
