// @vitest-environment jsdom
// A frame child's background is the source of its Fill override row.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import { paintSchema, type ObjectId, type Paint } from '@canvas/schema';

import { mustRun } from '../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './instance-section.js';

const BACKGROUND = [0.2, 0.4, 0.6, 1] as const;
const STROKE = [0.8, 0.2, 0.4, 1] as const;
const GRADIENT: Paint = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

/**
 * Seeds a main with an outlined frame child and places its selected instance.
 *
 * @param background - The frame's source background.
 * @returns The board containing the main and its instance.
 */
function frameBoard(background: Paint | null): YjsDocumentStore {
  const store = new YjsDocumentStore();
  mustRun(store, 'createObject', {
    object: {
      type: 'frame',
      id: 'frame-child',
      parentId: null,
      x: 100,
      y: 100,
      width: 160,
      height: 100,
      name: 'Inner frame',
      clip: false,
      background,
      stroke: { color: STROKE, width: 2 },
    },
  });
  mustRun(store, 'createComponent', {
    ids: ['frame-child'],
    name: 'Card',
    componentId: 'card',
  });
  mustRun(store, 'createInstance', {
    componentId: 'card',
    x: 400,
    y: 100,
    instanceId: 'inst',
  });
  return store;
}

/**
 * Renders the selected instance's inspector section and records its commands.
 *
 * @param store - The board to inspect.
 * @returns The command dispatch spy.
 * @throws {Error} When the instance is missing.
 */
function renderSection(store: YjsDocumentStore) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const instance = store.get('inst' as ObjectId);
  if (instance === undefined) throw new Error('instance missing');
  const props: StylePanelSectionProps = {
    context: 'instance',
    selection: [instance],
    board: store,
    definitions: store,
    defaults: undefined,
    isLocked: false,
    canEdit: true,
    shortcuts: createDefaultShortcutRegistry('other'),
    dispatch,
    applyStyle: vi.fn(),
  };
  render(<stylePanelSection.render {...props} />);
  return dispatch;
}

afterEach(cleanup);

describe('a frame child in the instance inspector', () => {
  it('shows its background and stroke, writes fill, and resets fill alone', () => {
    const store = frameBoard([...BACKGROUND]);
    const dispatch = renderSection(store);
    const row = screen.getByRole('group', { name: 'Inner frame' });
    const fill = within(row).getByLabelText<HTMLInputElement>('Fill', { exact: true });
    const stroke = within(row).getByLabelText<HTMLInputElement>('Stroke', { exact: true });
    expect(fill.value).toBe('#336699');
    expect(stroke.value).toBe('#cc3366');
    expect(within(row).getByRole('button', { name: 'Fill tokens' })).toBeDefined();
    expect(within(row).getByRole('button', { name: 'Stroke tokens' })).toBeDefined();

    fireEvent.change(fill, { target: { value: '#00ff00' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'frame-child',
      override: { fill: [0, 1, 0, 1] },
    });
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'frame-child',
      override: { fill: [0, 1, 0, 1] },
    });
    expect(store.get('inst' as ObjectId)).toMatchObject({
      overrides: { 'frame-child': { fill: [0, 1, 0, 1] } },
    });
    cleanup();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'frame-child',
      override: { strokeColor: [0, 0, 1, 1] },
    });
    const resetDispatch = renderSection(store);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Inner frame' })).getByRole('button', {
        name: 'Reset fill',
      }),
    );
    expect(resetDispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'frame-child',
      fields: ['fill'],
    });
    mustRun(store, 'resetInstanceOverrides', {
      id: 'inst',
      path: 'frame-child',
      fields: ['fill'],
    });
    expect(store.get('inst' as ObjectId)).toMatchObject({
      overrides: { 'frame-child': { strokeColor: [0, 0, 1, 1] } },
    });
  });

  for (const { name, background } of [
    { name: 'gradient', background: GRADIENT },
    { name: 'no', background: null },
    // An image and a token reference show as none too, as a shape's do.
    {
      name: 'image',
      background: paintSchema.parse({
        type: 'image',
        assetId: 'asset-photo',
        naturalSize: { width: 1600, height: 900 },
        fit: 'crop',
        crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
      }),
    },
    { name: 'token', background: paintSchema.parse({ token: 'surface' }) },
  ]) {
    it(`shows a none Fill for a frame with ${name} background`, () => {
      const store = frameBoard(background);
      renderSection(store);
      const row = screen.getByRole('group', { name: 'Inner frame' });
      // An exact label (fixed after the acceptance commit): /Fill/ also matched "Fill tokens".
      const fill = within(row).getByLabelText<HTMLInputElement>('Fill (none)', { exact: true });
      expect(fill.closest('[data-state]')?.getAttribute('data-state')).toBe('none');
      expect(within(row).getByRole('button', { name: 'Fill tokens' })).toBeDefined();
    });
  }
});
