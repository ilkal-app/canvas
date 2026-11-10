// @vitest-environment jsdom
// The inspector's arrange section: one icon button per arrange command of the default
// keymap, named and tooltipped with the keymap's description and shortcut; the disabled rules,
// each saying why, the button staying focusable; a locked selection; arrow keys along a row.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { createDefaultShortcutRegistry, DEFAULT_SHORTCUTS } from '../../keymap/default-keymap.js';
import { formatChord } from '../../shortcuts/chord-format.js';
import type { KeyboardPlatform } from '../../shortcuts/keyboard-platform.js';
import type { ShellAction } from '../../state/shell-action.js';
import { memoryShape } from '../__fixtures__/memory-board.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import {
  ARRANGE_ROWS,
  arrangeButtonText,
  LOCKED_ARRANGE_REASON,
  stylePanelSection,
} from './arrange-section.js';

afterEach(cleanup);

/**
 * The arrange commands the default keymap binds, in its order, but create component, which has
 * no button in the rows (ruling 2: the shortcut, the context menu and the dock).
 */
const KEYMAP_COMMANDS = DEFAULT_SHORTCUTS.flatMap(({ action }) =>
  action.type === 'arrange' && action.command !== 'createComponent' ? [action.command] : [],
);

function shapes(count: number, fields: Record<string, unknown> = {}): BoardObject[] {
  return [...Array(count).keys()].map((index): BoardObject => ({
    ...memoryShape(`s${String(index)}`, 'a0'),
    ...fields,
  }));
}

function renderRows(
  selection: readonly BoardObject[],
  options: { isLocked?: boolean; platform?: KeyboardPlatform } = {},
) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props = {
    context: 'shape',
    selection,
    board: { get: () => undefined },
    defaults: undefined,
    isLocked: options.isLocked ?? false,
    shortcuts: createDefaultShortcutRegistry(options.platform ?? 'mac'),
    dispatch,
    applyStyle: vi.fn(),
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { dispatch };
}

function button(command: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
  if (element === null) throw new Error(`no button for ${command}`);
  return element;
}

const tooltipOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute('aria-describedby') ?? '');

describe('the arrange section', () => {
  it('has exactly one button for every arrange command of the default keymap', () => {
    const commands = ARRANGE_ROWS.flatMap((row) => row.groups.flat()).map((b) => b.command);
    expect([...commands].sort()).toEqual([...KEYMAP_COMMANDS].sort());
    expect(new Set(commands).size).toBe(commands.length);
    renderRows(shapes(3));
    for (const command of KEYMAP_COMMANDS) {
      expect(document.querySelectorAll(`[data-command="${command}"]`), command).toHaveLength(1);
    }
  });

  it.each<KeyboardPlatform>(['mac', 'other'])(
    'names each button and fills its tooltip with the keymap’s description and shortcut (%s)',
    (platform) => {
      // Every button applies: three objects, one a group.
      renderRows([...shapes(2), ...shapes(1, { id: 'g', type: 'group' })], { platform });
      const registry = createDefaultShortcutRegistry(platform);
      for (const command of KEYMAP_COMMANDS) {
        const entry = registry.entries.find(
          ({ action }) => action.type === 'arrange' && action.command === command,
        );
        const chord = entry?.parsedChords[0];
        if (entry === undefined || chord === undefined) throw new Error(`no shortcut: ${command}`);
        const shortcut = formatChord(chord, platform);
        const element = button(command);
        expect(element.getAttribute('aria-label')).toBe(`${entry.description} (${shortcut})`);
        const tooltip = tooltipOf(element);
        expect(tooltip?.firstChild?.textContent).toBe(entry.description);
        expect(tooltip?.querySelector('kbd')?.textContent).toBe(shortcut);
      }
    },
  );

  it('shows the reference card’s words and keys on a Mac', () => {
    const text = arrangeButtonText(createDefaultShortcutRegistry('mac'), 'alignLeft');
    expect(text).toMatchObject({ name: 'Align left', shortcut: '⌥A', label: 'Align left (⌥A)' });
    expect(arrangeButtonText(createDefaultShortcutRegistry('mac'), 'alignCentre').name).toBe(
      'Align horizontal centres',
    );
  });

  it('lays the buttons out in the frames’ three rows', () => {
    renderRows(shapes(3));
    const rows = screen.getAllByRole('toolbar').map((toolbar) => ({
      name: toolbar.getAttribute('aria-label'),
      commands: within(toolbar)
        .getAllByRole('button')
        .map((element) => element.dataset.command),
    }));
    expect(rows).toEqual([
      {
        name: 'Align',
        commands: [
          'alignLeft',
          'alignCentre',
          'alignRight',
          'alignTop',
          'alignMiddle',
          'alignBottom',
        ],
      },
      {
        name: 'Distribute and group',
        commands: ['distributeHorizontally', 'distributeVertically', 'tidyUp', 'group', 'ungroup'],
      },
      {
        name: 'Order',
        commands: ['bringToFront', 'bringForward', 'sendBackward', 'sendToBack'],
      },
    ]);
  });

  it.each([
    ['distributeHorizontally', 2, 'Distribute needs 3 or more objects'],
    ['distributeVertically', 2, 'Distribute needs 3 or more objects'],
    ['tidyUp', 1, 'Tidy up needs 2 or more objects'],
    ['group', 1, 'Group needs 2 or more objects'],
  ])(
    'disables %s for %i objects, saying why, and enables it for one more',
    (command, count, why) => {
      const { dispatch } = renderRows(shapes(count));
      const element = button(command);
      expect(element.getAttribute('aria-disabled')).toBe('true');
      // Still focusable, so its reason is read with it, and its press does nothing.
      expect(element.disabled).toBe(false);
      expect(tooltipOf(element)?.textContent).toBe(why);
      fireEvent.click(element);
      expect(dispatch).not.toHaveBeenCalled();
      cleanup();
      const enabled = renderRows(shapes(count + 1));
      expect(button(command).getAttribute('aria-disabled')).toBeNull();
      fireEvent.click(button(command));
      expect(enabled.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'arrange', command });
    },
  );

  it('disables ungroup without a group in the selection, saying why', () => {
    renderRows(shapes(3));
    expect(button('ungroup').getAttribute('aria-disabled')).toBe('true');
    expect(tooltipOf(button('ungroup'))?.textContent).toBe(
      'Ungroup needs a group in the selection',
    );
    cleanup();
    renderRows(shapes(1, { type: 'group' }));
    expect(button('ungroup').getAttribute('aria-disabled')).toBeNull();
  });

  it('disables every button of a locked selection, saying how to unlock it', () => {
    const { dispatch } = renderRows(shapes(3, { locked: true }), { isLocked: true });
    for (const command of KEYMAP_COMMANDS) {
      expect(button(command).getAttribute('aria-disabled'), command).toBe('true');
      expect(tooltipOf(button(command))?.textContent).toBe(LOCKED_ARRANGE_REASON);
      fireEvent.click(button(command));
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('makes each row one tab stop, the arrow keys moving along it', () => {
    renderRows(shapes(3));
    const [align] = screen.getAllByRole('toolbar');
    const items = within(align ?? document.body).getAllByRole('button');
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    items[0]?.focus();
    fireEvent.keyDown(items[0] ?? document.body, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1] ?? document.body, { key: 'End' });
    expect(document.activeElement).toBe(items[5]);
    expect(items[5]?.tabIndex).toBe(0);
  });
});
