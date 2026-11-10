import { describe, expect, it } from 'vitest';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { contextMenuSections, isOfferedFor } from './context-menu-entries.js';

const REGISTRY = createDefaultShortcutRegistry('other');

function labelsFor(count: number, hasGroup = false): string[][] {
  return contextMenuSections(REGISTRY, { count, hasGroup }).map(({ entries }) =>
    entries.map(({ label }) => label),
  );
}

describe('contextMenuSections', () => {
  it('offers paste and select all on empty canvas', () => {
    expect(labelsFor(0)).toEqual([['Select all', 'Paste']]);
  });

  it('offers one object editing, lock, create component and the order commands', () => {
    expect(labelsFor(1)).toEqual([
      ['Select all of the same type', 'Delete', 'Duplicate', 'Copy', 'Cut', 'Lock or unlock'],
      ['Create component', 'Bring forward', 'Send backward', 'Bring to front', 'Send to back'],
    ]);
  });

  it('dispatches create component as its shortcut, mod+alt+k, does', () => {
    const [, arrangement] = contextMenuSections(REGISTRY, { count: 2, hasGroup: false });
    const create = arrangement?.entries.find(({ label }) => label === 'Create component');
    expect(create?.action).toEqual({ type: 'arrange', command: 'createComponent' });
    expect(create?.chord).toEqual(expect.objectContaining({ key: 'k', hasAlt: true }));
  });

  it('adds group, align and tidy up for two objects, and distribute from three', () => {
    const [, two = []] = labelsFor(2);
    expect(two).toContain('Group');
    expect(two).toContain('Align left');
    expect(two).toContain('Tidy up');
    expect(two).not.toContain('Distribute horizontally');
    const [, three = []] = labelsFor(3);
    expect(three).toContain('Distribute horizontally');
    expect(three).toContain('Distribute vertically');
  });

  it('offers ungroup only when a group is selected', () => {
    expect(labelsFor(1)[1]).not.toContain('Ungroup');
    expect(labelsFor(1, true)[1]).toContain('Ungroup');
  });

  it('never lists nudges or deselect, which have no place in a menu', () => {
    const everything = labelsFor(5, true).flat();
    expect(everything.some((label) => label.startsWith('Nudge'))).toBe(false);
    expect(everything).not.toContain('Deselect');
  });

  it('carries each entry’s action and primary chord, as its shortcut dispatches it', () => {
    const [editing] = contextMenuSections(REGISTRY, { count: 1, hasGroup: false });
    const duplicate = editing?.entries.find(({ label }) => label === 'Duplicate');
    expect(duplicate?.action).toEqual({ type: 'selection', command: 'duplicate' });
    expect(duplicate?.chord).toEqual(expect.objectContaining({ key: 'd' }));
    const del = editing?.entries.find(({ label }) => label === 'Delete');
    expect(del?.chord).toEqual(expect.objectContaining({ key: 'delete' }));
  });
});

describe('contextMenuSections for a person who cannot edit', () => {
  it('offers only what looks: select all on empty board, select same type and copy on objects', () => {
    const actionsFor = (count: number) =>
      contextMenuSections(REGISTRY, { count, hasGroup: true }, false).flatMap(({ entries }) =>
        entries.map(({ action }) => action),
      );
    expect(actionsFor(0)).toEqual([{ type: 'selection', command: 'selectAll' }]);
    expect(actionsFor(3)).toEqual([
      { type: 'selection', command: 'selectSameType' },
      { type: 'selection', command: 'copy' },
    ]);
  });
});

describe('isOfferedFor', () => {
  it('leaves out actions that are not selection or arrangement commands', () => {
    expect(isOfferedFor({ type: 'history', command: 'undo' }, { count: 1, hasGroup: false })).toBe(
      false,
    );
    expect(
      isOfferedFor(
        { type: 'nudge', direction: 'up', isLarge: false },
        { count: 1, hasGroup: false },
      ),
    ).toBe(false);
  });
});
