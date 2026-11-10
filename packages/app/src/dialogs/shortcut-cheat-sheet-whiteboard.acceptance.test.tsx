// @vitest-environment jsdom
// The floating whiteboard presents its own focused shortcut catalogue.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';

import { ShortcutCheatSheet } from './shortcut-cheat-sheet.js';

const TOOL_ORDER = [
  'Select',
  'Pan',
  'Section',
  'Shapes',
  'Image',
  'Text',
  'Connector',
  'Draw',
  'Eraser, while drawing',
  'Sticky note',
  // The keys a tool takes while on (the coordinator's ruling) follow its row.
  'Place a sticky at the centre (sticky tool on)',
  'Stack a sticky note below the selected one',
  'Comment',
  // Reactions' E landed with, after this test was written.
  'Reactions',
  'Send the focused reaction (Reactions open)',
];

/**
 * Shows the whiteboard shortcut sheet on a platform.
 *
 * @param platform - The key label convention.
 * @returns The sheet's dialog.
 */
function renderSheet(platform: KeyboardPlatform): HTMLElement {
  render(
    <ShortcutCheatSheet
      registry={createFloatingShortcutRegistry(platform)}
      layout="whiteboard"
      onClose={vi.fn()}
    />,
  );
  return screen.getByRole('dialog');
}

afterEach(cleanup);

describe('whiteboard shortcut sheet', () => {
  it.each(['mac', 'other'] as const)(
    'shows the dock tools in order and Pan as H or Space on %s',
    (platform) => {
      const dialog = renderSheet(platform);
      const tools = within(dialog).getByRole('region', { name: 'Tools' });
      expect([...tools.querySelectorAll('dt')].map((row) => row.textContent)).toEqual(TOOL_ORDER);
      const panKeys = within(tools).getByText('Pan').nextElementSibling;
      if (panKeys === null) throw new Error('Pan has no keycaps.');
      expect([...panKeys.querySelectorAll('kbd kbd')].map((key) => key.textContent)).toEqual([
        'H',
        'Space',
      ]);
      expect(panKeys.textContent).toBe('HorSpace');
      const placeKeys = within(tools).getByText('Place a sticky at the centre (sticky tool on)');
      expect(placeKeys.nextElementSibling?.textContent).toBe(platform === 'mac' ? '↩' : 'Enter');
      const sendKeys = within(tools).getByText('Send the focused reaction (Reactions open)');
      expect(sendKeys.nextElementSibling?.textContent).toBe(
        platform === 'mac' ? '↩orSpace' : 'EnterorSpace',
      );
    },
  );

  it.each([
    ['mac', '⌘/'],
    ['other', 'Ctrl/'],
  ] as const)('shows the popover and navigation keys on %s', (platform, popoverKeys) => {
    const dialog = renderSheet(platform);
    const selection = within(dialog).getByRole('region', { name: 'Selection and editing' });
    expect(
      within(selection).getByText("Focus the selection's properties").nextElementSibling
        ?.textContent,
    ).toBe(popoverKeys);
    const navigation = within(dialog).getByRole('region', { name: 'Navigation' });
    expect(within(navigation).getByText('Search the board').nextElementSibling?.textContent).toBe(
      platform === 'mac' ? '⌘F' : 'CtrlF',
    );
    expect(
      within(navigation).getByText('Show or hide the minimap').nextElementSibling?.textContent,
    ).toBe(platform === 'mac' ? '⇧M' : 'ShiftM');
  });

  it('omits the five classic-only rows while retaining their bindings', () => {
    const dialog = renderSheet('other');
    for (const description of [
      'Show or hide the inspector',
      'Show or hide layers',
      'Create component',
      'Delete points and join their neighbours (vector edit)',
      'Show or hide the developer overlay',
    ])
      expect(within(dialog).queryByText(description)).toBeNull();
  });
});
