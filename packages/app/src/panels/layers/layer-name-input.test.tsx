// @vitest-environment jsdom
// An object's name edited in its layers row (any object's since): a double-click
// opens the input,
// Enter or leaving it commits, Escape or an unchanged name commits nothing, and the row's click
// and the tree's keys never see the input's own.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { LayerRowItem, type LayerRowItemProps } from './layer-row-item.js';
import type { LayerRow } from './layer-rows.js';

afterEach(cleanup);

/**
 * A row of an object.
 *
 * @param type - Its type.
 * @param name - Its name.
 * @returns The row.
 */
function rowOf(type: LayerRow['type'], name: string): LayerRow {
  return {
    id: 'f' as ObjectId,
    type,
    name,
    parentId: null,
    level: 1,
    positionInSet: 1,
    setSize: 1,
    hasChildren: false,
    isExpanded: false,
    isLocked: false,
    isHidden: false,
  };
}

/**
 * Renders a row with spies.
 *
 * @param row - The row.
 * @param isEditable - Whether the row gets `onRename`.
 * @returns The spies.
 */
function renderRow(row: LayerRow, isEditable = true) {
  const onRename = vi.fn<NonNullable<LayerRowItemProps['onRename']>>();
  const onSelect = vi.fn<LayerRowItemProps['onSelect']>();
  const onTreeKey = vi.fn();
  render(
    // The tree's keys, which the input's must not reach.
    <div role="none" onKeyDown={onTreeKey}>
      <LayerRowItem
        row={row}
        index={0}
        isSelected={false}
        isFocusTarget
        onSelect={onSelect}
        onToggleExpanded={() => undefined}
        onFocus={() => undefined}
        {...(isEditable ? { onRename } : {})}
      />
    </div>,
  );
  return { onRename, onSelect, onTreeKey };
}

describe('renaming a layer row', () => {
  it('commits a frame’s new name on Enter, as one rename, and closes the input', () => {
    const { onRename, onSelect, onTreeKey } = renderRow(rowOf('frame', 'Panel'));
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'Panel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Panel' });
    expect(document.activeElement).toBe(input);
    expect(input).toHaveProperty('maxLength', 200);
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'Card' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'f' }), 'Card');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onTreeKey).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('commits a main’s name when the input loses focus', () => {
    const { onRename } = renderRow(rowOf('component', 'Button'));
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'Button' }));
    const input = screen.getByRole('textbox', { name: 'Rename Button' });
    fireEvent.change(input, { target: { value: 'Primary' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'f' }), 'Primary');
  });

  it('commits nothing on Escape or for an unchanged name', () => {
    const { onRename } = renderRow(rowOf('frame', 'Panel'));
    const item = screen.getByRole('treeitem', { name: 'Panel' });
    fireEvent.doubleClick(item);
    const input = screen.getByRole('textbox', { name: 'Rename Panel' });
    fireEvent.change(input, { target: { value: 'Dropped' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.doubleClick(item);
    const again = screen.getByRole('textbox', { name: 'Rename Panel' });
    fireEvent.pointerDown(again);
    fireEvent.doubleClick(again);
    fireEvent.keyDown(again, { key: 'a' });
    fireEvent.keyDown(again, { key: 'Enter' });
    fireEvent.blur(again);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('opens no input on a double-click of the row’s disclosure or lock button', () => {
    render(
      <LayerRowItem
        row={{ ...rowOf('frame', 'Panel'), hasChildren: true }}
        index={0}
        isSelected={false}
        isFocusTarget
        onSelect={() => undefined}
        onToggleExpanded={() => undefined}
        onToggleLock={() => undefined}
        onFocus={() => undefined}
        onRename={() => undefined}
      />,
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Expand Panel' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Lock Panel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renames a shape’s row, and stores nothing for its derived label unchanged', () => {
    const { onRename } = renderRow(rowOf('shape', 'Rectangle'));
    const item = screen.getByRole('treeitem', { name: 'Rectangle' });
    fireEvent.doubleClick(item);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename Rectangle' }), { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.doubleClick(item);
    const input = screen.getByRole('textbox', { name: 'Rename Rectangle' });
    fireEvent.change(input, { target: { value: 'Card background' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'f' }), 'Card background');
  });

  it('opens no input without onRename', () => {
    renderRow(rowOf('frame', 'Panel'), false);
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'Panel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
