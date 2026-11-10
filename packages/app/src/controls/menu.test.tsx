// @vitest-environment jsdom
// The menu primitive: items, meta, danger, separators, submenus and the keys of
// WAI-ARIA's menu pattern. Geometry in a real browser is the scenario's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Menu, type MenuCloseReason, type MenuEntry } from './menu.js';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  return () => {
    vi.restoreAllMocks();
  };
});

/**
 * Presses a key on the focused element, as a person would.
 *
 * @param key - The key.
 */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/**
 * The words of what has focus.
 *
 * @returns Its text, or null.
 */
function focusedName(): string | null {
  return document.activeElement?.textContent ?? null;
}

/**
 * A button that opens a menu of these entries, recording how it closed.
 *
 * @param props - The entries and the close recorder.
 * @param props.entries - The menu's lines.
 * @param props.onClose - Receives each close's reason.
 * @returns The harness.
 */
function Harness(props: {
  readonly entries: readonly MenuEntry[];
  readonly onClose?: (reason: MenuCloseReason) => void;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <Menu
        label="Board menu"
        entries={props.entries}
        anchor={ref}
        isOpen={isOpen}
        onClose={(reason) => {
          props.onClose?.(reason);
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * Opens the harness's menu from its focused button.
 *
 * @returns The menu.
 */
function open(): HTMLElement {
  const button = screen.getByRole('button', { name: 'Open' });
  button.focus();
  fireEvent.click(button);
  return screen.getByRole('menu', { name: 'Board menu' });
}

const chosen: string[] = [];

/**
 * An item that records its choice.
 *
 * @param label - Its name.
 * @param extra - More of the entry.
 * @returns The entry.
 */
function item(label: string, extra: Partial<MenuEntry> = {}): MenuEntry {
  return {
    kind: 'item',
    id: label,
    label,
    onSelect: () => {
      chosen.push(label);
    },
    ...extra,
  };
}

const ENTRIES: readonly MenuEntry[] = [
  item('All boards', { meta: '⌘⇧H' }),
  { kind: 'separator', id: 'rule' },
  item('Rename'),
  item('Export', { meta: 'PNG, PDF', submenu: [item('PNG'), item('PDF')] }),
  item('Locked', { isDisabled: true }),
  item('Delete board', { isDanger: true }),
];

beforeEach(() => {
  chosen.length = 0;
});

describe('Menu', () => {
  it('is a menu of items with their meta, a separator, a submenu marker and a danger item', () => {
    render(<Harness entries={ENTRIES} />);
    const menu = open();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((element) => element.textContent)).toEqual([
      'All boards⌘⇧H',
      'Rename',
      'ExportPNG, PDF ›',
      'Locked',
      'Delete board',
    ]);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    expect(items[2]?.getAttribute('aria-haspopup')).toBe('menu');
    expect(items[2]?.getAttribute('aria-expanded')).toBe('false');
    expect(items[3]?.getAttribute('aria-disabled')).toBe('true');
    expect(items[4]?.dataset.danger).toBe('');
    expect(items.every((element) => element.tabIndex === -1)).toBe(true);
    expect(menu.dataset.shape).toBe('stack');
  });

  it('moves with the arrows, Home and End, wrapping, starting on the first item', () => {
    render(<Harness entries={ENTRIES} />);
    open();
    expect(focusedName()).toBe('All boards⌘⇧H');
    press('ArrowDown');
    expect(focusedName()).toBe('Rename');
    press('End');
    expect(focusedName()).toBe('Delete board');
    press('ArrowDown');
    expect(focusedName()).toBe('All boards⌘⇧H');
    press('ArrowUp');
    expect(focusedName()).toBe('Delete board');
    press('Home');
    expect(focusedName()).toBe('All boards⌘⇧H');
  });

  it('chooses with a click: closes, puts focus back on the opener, then runs the item', () => {
    const onClose = vi.fn<(reason: MenuCloseReason) => void>();
    render(<Harness entries={ENTRIES} onClose={onClose} />);
    const menu = open();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    expect(onClose).toHaveBeenCalledWith('choose');
    expect(chosen).toEqual(['Rename']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('does nothing for a disabled item', () => {
    render(<Harness entries={ENTRIES} />);
    const menu = open();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Locked' }));
    expect(chosen).toEqual([]);
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
  });

  it('opens a submenu with the arrow toward the end, and closes it with the arrow back', () => {
    render(<Harness entries={ENTRIES} />);
    open();
    press('ArrowDown');
    press('ArrowDown');
    expect(focusedName()).toBe('ExportPNG, PDF ›');
    press('ArrowRight');
    const submenu = screen.getByRole('menu', { name: 'Export' });
    expect(focusedName()).toBe('PNG');
    expect(submenu.dataset.side).toBe('right');
    press('ArrowDown');
    expect(focusedName()).toBe('PDF');
    // The submenu's own items only: Down wraps inside it.
    press('ArrowDown');
    expect(focusedName()).toBe('PNG');
    press('ArrowLeft');
    expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
    expect(focusedName()).toBe('ExportPNG, PDF ›');
  });

  it('Escape in a submenu closes only it; Escape again closes the menu with focus back', () => {
    const onClose = vi.fn<(reason: MenuCloseReason) => void>();
    render(<Harness entries={ENTRIES} onClose={onClose} />);
    const menu = open();
    const exportItem = within(menu).getByRole('menuitem', { name: 'ExportPNG, PDF ›' });
    // A click focuses the button in a browser; jsdom's does not.
    exportItem.focus();
    fireEvent.click(exportItem);
    expect(screen.getByRole('menu', { name: 'Export' })).toBeTruthy();
    expect(focusedName()).toBe('PNG');
    press('Escape');
    expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(focusedName()).toBe('ExportPNG, PDF ›');
    press('Escape');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('choosing in a submenu closes every level and runs the item once', () => {
    const onClose = vi.fn<(reason: MenuCloseReason) => void>();
    render(<Harness entries={ENTRIES} onClose={onClose} />);
    const menu = open();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'ExportPNG, PDF ›' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
    expect(chosen).toEqual(['PDF']);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('choose');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('Tab closes the menu once, and pointing at another item closes an open submenu', () => {
    const onClose = vi.fn<(reason: MenuCloseReason) => void>();
    render(<Harness entries={ENTRIES} onClose={onClose} />);
    const menu = open();
    const exportItem = within(menu).getByRole('menuitem', { name: 'ExportPNG, PDF ›' });
    fireEvent.pointerEnter(exportItem);
    expect(screen.getByRole('menu', { name: 'Export' })).toBeTruthy();
    expect(exportItem.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerEnter(within(menu).getByRole('menuitem', { name: 'Rename' }));
    expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
    fireEvent.pointerEnter(exportItem);
    screen.getByRole('menuitem', { name: 'PNG' }).focus();
    press('Tab');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('tab');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a submenu toward the start in a right-to-left page', () => {
    document.documentElement.dir = 'rtl';
    try {
      render(<Harness entries={ENTRIES} />);
      const menu = open();
      const exportItem = within(menu).getByRole('menuitem', { name: 'ExportPNG, PDF ›' });
      exportItem.focus();
      press('ArrowRight');
      expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull();
      press('ArrowLeft');
      expect(screen.getByRole('menu', { name: 'Export' })).toBeTruthy();
    } finally {
      document.documentElement.dir = '';
    }
  });
});

describe('typeahead', () => {
  it('moves to the item a letter starts, by its label', () => {
    render(<Harness entries={[item('Small', { meta: '12' }), item('Large', { meta: '24' })]} />);
    open();
    expect(focusedName()).toBe('Small12');
    press('l');
    expect(focusedName()).toBe('Large24');
  });

  it('reads labels, not metas: a prefix past a label names no meta', () => {
    // "Small" with meta "1" reads "Small1" in full; by its label it is "Small" alone.
    render(<Harness entries={[item('Small1 px'), item('Small', { meta: '1' })]} />);
    open();
    for (const key of 'small') press(key);
    expect(focusedName()).toBe('Small1');
    press('1');
    // By labels, only the first item starts with "small1": a meta would have kept the second.
    expect(focusedName()).toBe('Small1 px');
  });

  it('keeps a typed letter that names no item, so it reaches no shortcut', () => {
    render(<Harness entries={[item('Small', { meta: '12' }), item('Large', { meta: '24' })]} />);
    open();
    const letter = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement?.dispatchEvent(letter);
    });
    expect(letter.defaultPrevented).toBe(true);
    expect(focusedName()).toBe('Small12');
  });
});
