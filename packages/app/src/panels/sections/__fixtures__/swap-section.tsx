import { render } from '@testing-library/react';
import { vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../../keymap/default-keymap.js';
import type { ShellAction } from '../../../state/shell-action.js';
import type { StylePanelSectionProps } from '../../panel-sections.js';
import { stylePanelSection } from '../instance-section.js';

/**
 * Seeds a second main for swap picker tests.
 *
 * @returns A card board with a second main for swapping.
 */
export function swapBoard() {
  const { store } = createComponentBoard();
  createRectangle(store, 'check-mark', null, { x: 800, y: 100, width: 20, height: 20 });
  mustRun(store, 'createComponent', {
    ids: ['check-mark'],
    name: 'Check',
    componentId: 'check',
  });
  return store;
}

/**
 * Renders one instance's inspector section.
 *
 * @param store - The board.
 * @param id - The selected instance.
 * @param options - Edit and lock state.
 * @param options.canEdit - Whether the user can edit.
 * @param options.isLocked - Whether the instance is locked.
 * @returns The dispatch spy.
 * @throws {Error} If the instance is missing.
 */
export function renderSwapSection(
  store: YjsDocumentStore,
  id = 'inst',
  options: { readonly canEdit?: boolean; readonly isLocked?: boolean } = {},
) {
  const instance = store.get(id as ObjectId);
  if (instance?.type !== 'instance') throw new Error(`missing instance ${id}`);
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props: StylePanelSectionProps = {
    context: 'instance',
    selection: [{ ...instance, locked: options.isLocked ?? false }],
    board: store,
    definitions: store,
    defaults: undefined,
    isLocked: options.isLocked ?? false,
    canEdit: options.canEdit ?? true,
    shortcuts: createDefaultShortcutRegistry('other'),
    dispatch,
    applyStyle: vi.fn(),
  };
  render(<stylePanelSection.render {...props} />);
  return { dispatch };
}
