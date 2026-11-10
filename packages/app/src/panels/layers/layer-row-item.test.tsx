// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import type { BoardReader } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';

import { LayerRowItem } from './layer-row-item.js';
import { layerRowOf } from './layer-rows.js';

afterEach(cleanup);

it.each([
  ['text', undefined, 'text'],
  ['sticky', undefined, 'note'],
  ['image', undefined, 'image'],
  ['video', undefined, 'present'],
  ['shape', 'rectangle', 'rectangle'],
  ['shape', 'ellipse', 'ellipse'],
  ['shape', 'polygon', 'polygon'],
  ['shape', 'star', 'star'],
  ['shape', 'diamond', 'diamond'],
  ['line', undefined, 'line'],
  ['connector', undefined, 'connector'],
  ['path', undefined, 'pen'],
  ['group', undefined, 'group'],
  ['frame', undefined, 'frame'],
  ['comment', undefined, 'comment'],
  ['component', undefined, 'component'],
  ['instance', undefined, 'instance'],
])('shows the shared %s %s icon without changing the row name', (type, kind, icon) => {
  const board = { references: { childrenOf: () => new Set() } } as unknown as BoardReader;
  const object = {
    id: 'object',
    type,
    kind,
    text: 'A note',
    name: 'A frame',
    locked: false,
  } as unknown as BoardObject;
  const row = layerRowOf(board, new Set(), object, {
    parentId: null,
    level: 1,
    positionInSet: 1,
    setSize: 1,
  });
  render(
    <LayerRowItem
      row={row}
      index={0}
      isSelected={false}
      isFocusTarget
      onSelect={() => undefined}
      onToggleExpanded={() => undefined}
      onFocus={() => undefined}
    />,
  );
  const item = screen.getByRole('treeitem', { name: row.name });
  expect(item.querySelector('svg')?.getAttribute('data-icon')).toBe(icon);
  expect(item.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});

it('names a hidden row so, and its eye button shows it again', () => {
  const board = { references: { childrenOf: () => new Set() } } as unknown as BoardReader;
  const object = {
    id: 'object',
    type: 'shape',
    kind: 'rectangle',
    name: 'Badge',
    locked: false,
    isHidden: true,
  } as unknown as BoardObject;
  const row = layerRowOf(board, new Set(), object, {
    parentId: null,
    level: 1,
    positionInSet: 1,
    setSize: 1,
  });
  expect(row.isHidden).toBe(true);
  const toggled: string[] = [];
  render(
    <LayerRowItem
      row={row}
      index={0}
      isSelected={false}
      isFocusTarget
      onSelect={() => undefined}
      onToggleExpanded={() => undefined}
      onToggleHidden={(target) => toggled.push(target.id)}
      onFocus={() => undefined}
    />,
  );
  expect(screen.getByRole('treeitem', { name: 'Badge, hidden' })).toBeDefined();
  const eye = screen.getByRole('button', { name: 'Show Badge' });
  expect(eye.getAttribute('aria-pressed')).toBe('true');
  expect(eye.querySelector('svg')?.getAttribute('data-icon')).toBe('eye-off');
  fireEvent.click(eye);
  expect(toggled).toEqual(['object']);
});
