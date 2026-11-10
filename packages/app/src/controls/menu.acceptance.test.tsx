// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPopupStack } from '../focus/popup-stack.js';

import { AnchoredPopover } from './anchored-popover.js';
import { Menu, type MenuCloseReason, type MenuEntry } from './menu.js';

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(220);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
  return () => {
    vi.restoreAllMocks();
  };
});

/**
 * Sends a key to the focused control.
 *
 * @param key - Keyboard key to send.
 */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/**
 * Opens the board menu with its opener focused.
 *
 * @returns The root menu.
 */
function openMenu(): HTMLElement {
  const opener = screen.getByRole('button', { name: 'Open board menu' });
  opener.focus();
  fireEvent.click(opener);
  return screen.getByRole('menu', { name: 'Board actions' });
}

/**
 * Keeps the root open state in sync with close requests.
 *
 * @param props - Entries and close observer.
 * @param props.entries - The menu's rows.
 * @param props.onClose - Receives the close reason.
 * @returns The opener and menu.
 */
function MenuHarness(props: {
  readonly entries: readonly MenuEntry[];
  readonly onClose: (reason: MenuCloseReason) => void;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open board menu
      </button>
      <Menu
        label="Board actions"
        entries={props.entries}
        anchor={anchor}
        isOpen={isOpen}
        onClose={(reason) => {
          props.onClose(reason);
          setOpen(false);
        }}
      />
    </>
  );
}

const ENTRIES: readonly MenuEntry[] = [
  { kind: 'item', id: 'rename', label: 'Rename', meta: '⌘R' },
  { kind: 'separator', id: 'rule' },
  {
    kind: 'item',
    id: 'export',
    label: 'Export',
    submenu: [
      { kind: 'item', id: 'png', label: 'PNG' },
      { kind: 'item', id: 'svg', label: 'SVG' },
    ],
  },
  { kind: 'item', id: 'disabled', label: 'Locked', isDisabled: true },
  { kind: 'item', id: 'delete', label: 'Delete', isDanger: true },
];

describe('Menu acceptance', () => {
  it('renders stack semantics and keeps all items out of the Tab order', () => {
    render(<MenuHarness entries={ENTRIES} onClose={vi.fn()} />);
    const menu = openMenu();
    expect(menu.dataset.shape).toBe('stack');
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.tabIndex === -1)).toBe(true);
    expect(items[0]?.lastElementChild?.textContent).toBe('⌘R');
    expect(items[1]?.lastElementChild?.textContent).toBe('›');
    expect(items[1]?.getAttribute('aria-haspopup')).toBe('menu');
    expect(items[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(items[2]?.getAttribute('aria-disabled')).toBe('true');
    expect(items[3]?.dataset.danger).toBe('');
    fireEvent.click(items[2] ?? menu);
    expect(screen.getByRole('menu', { name: 'Board actions' })).toBeTruthy();
  });

  it('announces a disabled item and ignores its click', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <MenuHarness
        entries={[{ kind: 'item', id: 'locked', label: 'Locked', isDisabled: true, onSelect }]}
        onClose={onClose}
      />,
    );
    openMenu();
    const locked = screen.getByRole('menuitem', { name: 'Locked' });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Board actions' })).toBeTruthy();
  });

  it('wraps arrows, jumps Home and End, and selects with Space exactly once', () => {
    const order: string[] = [];
    const entries: readonly MenuEntry[] = [
      {
        kind: 'item',
        id: 'a',
        label: 'Alpha',
        onSelect: () => {
          order.push('select');
        },
      },
      {
        kind: 'item',
        id: 'b',
        label: 'Beta',
        onSelect: () => {
          order.push('beta');
        },
      },
    ];
    render(
      <MenuHarness
        entries={entries}
        onClose={(reason) => {
          order.push(reason);
        }}
      />,
    );
    openMenu();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Alpha' }));
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Beta' }));
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Alpha' }));
    press('End');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Beta' }));
    press('Home');
    press(' ');
    // jsdom does not perform the button's native Space activation after a synthetic keydown.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }));
    expect(order).toEqual(['choose', 'select']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open board menu' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens in the page direction and returns only from the submenu on the back arrow', () => {
    render(<MenuHarness entries={ENTRIES} onClose={vi.fn()} />);
    const root = openMenu();
    const exportItem = within(root).getByRole('menuitem', { name: 'Export›' });
    exportItem.style.direction = 'rtl';
    exportItem.focus();
    press('ArrowLeft');
    const child = screen.getByRole('menu', { name: 'Export' });
    expect(exportItem.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(child).getByRole('menuitem', { name: 'PNG' }));
    child.style.direction = 'rtl';
    press('ArrowRight');
    expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Board actions' })).toBeTruthy();
    expect(document.activeElement).toBe(exportItem);
  });

  it('Escape closes one level at a time and returns focus to the opener', () => {
    const onClose = vi.fn<(reason: MenuCloseReason) => void>();
    render(<MenuHarness entries={ENTRIES} onClose={onClose} />);
    const root = openMenu();
    const exportItem = within(root).getByRole('menuitem', { name: 'Export›' });
    exportItem.focus();
    fireEvent.click(exportItem);
    press('Escape');
    expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(exportItem);
    press('Escape');
    expect(onClose).toHaveBeenCalledExactlyOnceWith('escape');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open board menu' }));
  });

  it('Tab from a submenu closes every level with one root notification', () => {
    const onClose = vi.fn<(reason: MenuCloseReason) => void>();
    render(<MenuHarness entries={ENTRIES} onClose={onClose} />);
    const root = openMenu();
    const exportItem = within(root).getByRole('menuitem', { name: 'Export›' });
    exportItem.focus();
    fireEvent.click(exportItem);
    press('Tab');
    expect(onClose).toHaveBeenCalledExactlyOnceWith('tab');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes all levels and restores opener focus before selecting a submenu item once', () => {
    const events: string[] = [];
    const onSelect = vi.fn(() => {
      events.push(`select:${document.activeElement?.textContent ?? ''}`);
    });
    const entries: readonly MenuEntry[] = [
      {
        kind: 'item',
        id: 'more',
        label: 'More',
        submenu: [{ kind: 'item', id: 'action', label: 'Action', onSelect }],
      },
    ];
    render(
      <MenuHarness
        entries={entries}
        onClose={(reason) => {
          events.push(`close:${reason}`);
        }}
      />,
    );
    const root = openMenu();
    const more = within(root).getByRole('menuitem', { name: 'More›' });
    more.focus();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Action' }));
    expect(events).toEqual(['close:choose', 'select:Open board menu']);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes an open submenu when pointing at a plain item', () => {
    render(<MenuHarness entries={ENTRIES} onClose={vi.fn()} />);
    const root = openMenu();
    fireEvent.pointerEnter(within(root).getByRole('menuitem', { name: 'Export›' }));
    expect(screen.getByRole('menu', { name: 'Export' })).toBeTruthy();
    fireEvent.pointerEnter(within(root).getByRole('menuitem', { name: 'Rename⌘R' }));
    expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
  });

  it('honours initialFocus and keeps an enclosing popover on the popup stack', () => {
    const stack = createPopupStack();
    const onClose = vi.fn();
    function Nested(props: {
      readonly isChildOpen: boolean;
      readonly initialFocus: string;
    }): ReactElement {
      return (
        <AnchoredPopover
          anchor={{ x: 100, y: 100, width: 20, height: 20 }}
          isOpen
          label="Outer"
          stack={stack}
          onClose={onClose}
        >
          <button type="button">First</button>
          <button type="button" data-target="">
            Second
          </button>
          <AnchoredPopover
            anchor={{ x: 120, y: 120, width: 20, height: 20 }}
            isOpen={props.isChildOpen}
            label="Inner"
            stack={stack}
            initialFocus={props.initialFocus}
            onClose={vi.fn()}
          >
            <button type="button">Child first</button>
            <button type="button" data-target="">
              Child second
            </button>
          </AnchoredPopover>
        </AnchoredPopover>
      );
    }
    const { rerender } = render(<Nested isChildOpen={false} initialFocus="[data-target]" />);
    rerender(<Nested isChildOpen initialFocus="[data-target]" />);
    expect(document.activeElement).toBe(
      within(screen.getByRole('dialog', { name: 'Inner' })).getByRole('button', {
        name: 'Child second',
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(stack.size()).toBe(2);
    rerender(<Nested isChildOpen initialFocus="[data-missing]" />);
    expect(document.activeElement).toBe(
      within(screen.getByRole('dialog', { name: 'Inner' })).getByRole('button', {
        name: 'Child first',
      }),
    );
  });
});
