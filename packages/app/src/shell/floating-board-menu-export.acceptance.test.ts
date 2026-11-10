// Written before the export code. CONTRACT: floating Export follows Duplicate board
// and offers both PNG scales and PDF for board or selection, independently of a site host.
// Deliberately not asserted: menu animation, background colour, or file encoding.
import { describe, expect, it, vi } from 'vitest';

import { floatingBoardMenuEntries } from './floating-board-menu.js';

interface ExportOption {
  readonly scope: 'board' | 'selection';
  readonly onExport: (format: 'png' | 'pdf', scale: 1 | 2) => void;
}

function entries(exportOption?: ExportOption, hasHost = true) {
  return floatingBoardMenuEntries({
    host: hasHost
      ? { onRename: vi.fn(), onDuplicate: vi.fn(), onVersionHistory: vi.fn() }
      : undefined,
    onNavigateHome: undefined,
    themePreference: 'system',
    onThemeChange: vi.fn(),
    onKeyboardShortcuts: vi.fn(),
    openUrl: vi.fn(),
    export: exportOption,
  });
}

describe('floating board menu export', () => {
  it.each(['board', 'selection'] as const)('places %s Export and calls each format', (scope) => {
    const onExport = vi.fn();
    const menu = entries({ scope, onExport });
    expect(
      menu
        .filter((entry) => entry.kind !== 'separator')
        .map((entry) => entry.id)
        .slice(0, 4),
    ).toEqual(['rename', 'duplicate', 'export', 'version-history']);
    const item = menu.find((entry) => entry.id === 'export');
    expect(item).toMatchObject({ kind: 'item', label: 'Export', meta: 'PNG, PDF' });
    if (item?.kind !== 'item') throw new Error('Export item missing');
    expect(item.submenu).toMatchObject([
      {
        kind: 'item',
        id: 'export-png-1',
        label: 'PNG 1×',
        meta: scope === 'board' ? 'Board' : 'Selection',
      },
      {
        kind: 'item',
        id: 'export-png-2',
        label: 'PNG 2×',
        meta: scope === 'board' ? 'Board' : 'Selection',
      },
      {
        kind: 'item',
        id: 'export-pdf',
        label: 'PDF',
        meta: scope === 'board' ? 'Board' : 'Selection',
      },
    ]);
    for (const [index, scale] of [1, 2].entries()) {
      const choice = item.submenu?.[index];
      if (choice?.kind !== 'item') throw new Error('PNG choice missing');
      choice.onSelect?.();
      expect(onExport).toHaveBeenNthCalledWith(index + 1, 'png', scale);
    }
    const pdf = item.submenu?.[2];
    if (pdf?.kind !== 'item') throw new Error('PDF choice missing');
    pdf.onSelect?.();
    expect(onExport).toHaveBeenNthCalledWith(3, 'pdf', 2);
    expect(onExport).toHaveBeenCalledTimes(3);
  });

  it('offers Export without a host but omits it when no export action is supplied', () => {
    expect(
      entries({ scope: 'board', onExport: vi.fn() }, false).some((entry) => entry.id === 'export'),
    ).toBe(true);
    expect(entries(undefined).some((entry) => entry.id === 'export')).toBe(false);
  });
});
