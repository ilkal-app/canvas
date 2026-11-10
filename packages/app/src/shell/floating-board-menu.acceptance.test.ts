// The floating board menu's pure entries and host action contract.
import { describe, expect, it, vi } from 'vitest';

import type { MenuEntry, MenuItemEntry } from '../controls/menu.js';
import type { ThemePreference } from '../theme/theme-preference.js';

import { floatingBoardMenuEntries, type FloatingBoardMenuHost } from './floating-board-menu.js';
import type { HelpLinks } from './help-links.js';

/** The host's help page and feedback address, as the site gives them. */
const HELP_AND_FEEDBACK = { docsUrl: '/help', feedbackUrl: 'mailto:feedback@example.com' };

function entries(
  host: FloatingBoardMenuHost | undefined,
  preference: ThemePreference = 'system',
  onNavigateHome: (() => void) | null = vi.fn(),
  help: HelpLinks | null = HELP_AND_FEEDBACK,
) {
  const onThemeChange = vi.fn();
  const onKeyboardShortcuts = vi.fn();
  const openUrl = vi.fn();
  const result = floatingBoardMenuEntries({
    host,
    onNavigateHome: onNavigateHome ?? undefined,
    themePreference: preference,
    onThemeChange,
    onKeyboardShortcuts,
    openUrl,
    help: help ?? undefined,
  });
  return { result, onThemeChange, onKeyboardShortcuts, openUrl };
}

function item(list: readonly MenuEntry[], id: string): MenuItemEntry {
  const found = list.find((entry) => entry.kind !== 'separator' && entry.id === id);
  if (found === undefined || found.kind === 'separator') throw new Error(`Missing ${id}`);
  return found;
}

describe('floating board menu entries', () => {
  it('orders the owner actions and keeps only separators between populated groups', () => {
    const host = {
      onRename: vi.fn(),
      onVersionHistory: vi.fn(),
      onShare: vi.fn(),
      onBoardSettings: vi.fn(),
      onDelete: vi.fn(),
    };
    const { result } = entries(host);
    expect(result.map(({ id }) => id)).toEqual([
      'all-boards',
      expect.any(String),
      'rename',
      'version-history',
      expect.any(String),
      'share',
      'board-settings',
      'theme',
      'keyboard-shortcuts',
      'help',
      expect.any(String),
      'delete',
    ]);
    expect(result.map(({ kind }) => kind)).toEqual([
      'item',
      'separator',
      'item',
      'item',
      'separator',
      'item',
      'item',
      'item',
      'item',
      'item',
      'separator',
      'item',
    ]);
    expect(
      result.filter((entry) => entry.kind !== 'separator').map(({ id, label }) => [id, label]),
    ).toEqual([
      ['all-boards', 'All boards'],
      ['rename', 'Rename'],
      ['version-history', 'Version history'],
      ['share', 'Share and permissions'],
      ['board-settings', 'Board settings'],
      ['theme', 'Theme'],
      ['keyboard-shortcuts', 'Keyboard shortcuts'],
      ['help', 'Help and feedback'],
      ['delete', 'Delete board'],
    ]);
    expect(item(result, 'delete').isDanger).toBe(true);
    expect(item(result, 'keyboard-shortcuts').meta).toBe('?');
    expect(item(result, 'all-boards').meta).toBeUndefined();
    expect(item(result, 'version-history').meta).toBeUndefined();
    expect(
      result.some(({ id }) => ['grid', 'snapping', 'comments', 'duplicate', 'export'].includes(id)),
    ).toBe(false);
  });

  it('collapses absent host groups without leading, trailing, or doubled separators', () => {
    const viewer = entries(undefined).result;
    expect(viewer.map(({ kind, id }) => (kind === 'separator' ? 'separator' : id))).toEqual([
      'all-boards',
      'separator',
      'theme',
      'keyboard-shortcuts',
      'help',
    ]);
    const noHome = entries(undefined, 'system', null).result;
    expect(noHome.map(({ id }) => id)).toEqual(['theme', 'keyboard-shortcuts', 'help']);
  });

  it.each([
    ['system', 'System', 'theme-system'],
    ['light', 'Light (Vellum)', 'theme-light'],
    ['dark', 'Dark (Graphite)', 'theme-dark'],
  ] as const)('shows %s as the theme meta and checked radio', (preference, label, checkedId) => {
    const { result, onThemeChange } = entries(undefined, preference);
    const theme = item(result, 'theme');
    expect(theme.meta).toBe(label);
    expect(
      theme.submenu
        ?.filter((entry) => entry.kind !== 'separator')
        .map(({ id, kind, label: text }) => [id, kind, text]),
    ).toEqual([
      ['theme-system', 'radio', 'System'],
      ['theme-light', 'radio', 'Light (Vellum)'],
      ['theme-dark', 'radio', 'Dark (Graphite)'],
    ]);
    expect(
      theme.submenu
        ?.filter((entry) => entry.kind === 'radio' && entry.isChecked)
        .map(({ id }) => id),
    ).toEqual([checkedId]);
    item(theme.submenu ?? [], 'theme-dark').onSelect?.();
    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith('dark');
  });

  it('routes help to the shared URLs with the correct tab policy', () => {
    const { result, openUrl } = entries(undefined);
    const help = item(result, 'help');
    expect(
      help.submenu
        ?.filter((entry) => entry.kind !== 'separator')
        .map(({ id, label }) => [id, label]),
    ).toEqual([
      ['help-docs', 'Help centre'],
      ['help-feedback', 'Send feedback'],
    ]);
    item(help.submenu ?? [], 'help-docs').onSelect?.();
    item(help.submenu ?? [], 'help-feedback').onSelect?.();
    expect(openUrl.mock.calls).toEqual([
      [HELP_AND_FEEDBACK.docsUrl, true],
      [HELP_AND_FEEDBACK.feedbackUrl, false],
    ]);
  });

  it('offers only the help the host gives, and none without its links', () => {
    const none = entries(undefined, 'system', null, null).result;
    expect(none.map(({ id }) => id)).toEqual(['theme', 'keyboard-shortcuts']);
    const docsOnly = item(entries(undefined, 'system', null, { docsUrl: '/docs' }).result, 'help');
    expect(docsOnly.submenu?.map((entry) => entry.kind === 'separator' || entry.id)).toEqual([
      'help-docs',
    ]);
    const feedbackOnly = item(
      entries(undefined, 'system', null, { feedbackUrl: 'mailto:a@example.com' }).result,
      'help',
    );
    expect(feedbackOnly.submenu?.map((entry) => entry.kind === 'separator' || entry.id)).toEqual([
      'help-feedback',
    ]);
  });

  it('routes every host action, home, and the shortcut sheet to its callback', () => {
    const host = {
      onRename: vi.fn(),
      onVersionHistory: vi.fn(),
      onShare: vi.fn(),
      onBoardSettings: vi.fn(),
      onDelete: vi.fn(),
    };
    const onNavigateHome = vi.fn();
    const { result, onKeyboardShortcuts } = entries(host, 'system', onNavigateHome);
    const actions = [
      ['all-boards', onNavigateHome],
      ['rename', host.onRename],
      ['version-history', host.onVersionHistory],
      ['share', host.onShare],
      ['board-settings', host.onBoardSettings],
      ['keyboard-shortcuts', onKeyboardShortcuts],
      ['delete', host.onDelete],
    ] as const;
    for (const [id, callback] of actions) {
      item(result, id).onSelect?.();
      expect(callback).toHaveBeenCalledOnce();
    }
  });
});
