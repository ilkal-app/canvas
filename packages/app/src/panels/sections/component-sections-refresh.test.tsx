// @vitest-environment jsdom
// The component and instance sections follow the whole board (part B1): a main, its
// content or its instances may be on another page, whose changes the page's feed never tells.
import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection as componentSection } from './component-section.js';
import { stylePanelSection as instanceSection } from './instance-section.js';

/**
 * Renders a section for an object of the board, watching the whole board's change sets.
 *
 * @param store - The board.
 * @param id - The selected object.
 * @param section - The section.
 * @returns How many times it rendered.
 * @throws {Error} When the object is missing.
 */
function renderWatching(
  store: YjsDocumentStore,
  id: string,
  section: typeof componentSection,
): { readonly renders: () => number } {
  const object = store.get(id as ObjectId);
  if (object === undefined) throw new Error(`no ${id}`);
  let renders = 0;
  const props: StylePanelSectionProps = {
    context: object.type === 'instance' ? 'instance' : 'component',
    selection: [object],
    board: store,
    definitions: store,
    watchDefinitions: (listener) => store.subscribe(listener),
    defaults: undefined,
    isLocked: false,
    shortcuts: createDefaultShortcutRegistry('other'),
    dispatch: vi.fn(),
    applyStyle: vi.fn(),
  };
  const onRender = (): void => {
    renders += 1;
  };
  render(
    <Profiler id="section" onRender={onRender}>
      <section.render {...props} />
    </Profiler>,
  );
  return { renders: () => renders };
}

afterEach(cleanup);

describe('sections that follow the whole board', () => {
  it('shows a main renamed on another page', () => {
    const { store } = createComponentBoard({ isInstanceOnSecondPage: true });
    renderWatching(store, 'inst', instanceSection);
    act(() => {
      mustRun(store, 'renameFrame', { id: 'card', name: 'Profile' });
    });
    expect(screen.getByText('Profile')).toBeDefined();
  });

  it('lists a child added to a nested main', () => {
    const { store } = createComponentBoard({ isInstanceOnSecondPage: true });
    renderWatching(store, 'inst', instanceSection);
    const before = screen.getAllByRole('group', { name: 'Rectangle' }).length;
    act(() => {
      createRectangle(store, 'dot-2', 'badge', { x: 0, y: 0, width: 4, height: 4 });
    });
    expect(screen.getAllByRole('group', { name: 'Rectangle' })).toHaveLength(before + 1);
  });

  it('leaves the instance section alone for a change outside its main', () => {
    const { store } = createComponentBoard({ isInstanceOnSecondPage: true });
    const { renders } = renderWatching(store, 'inst', instanceSection);
    const before = renders();
    act(() => {
      createRectangle(store, 'loose', null, { x: 0, y: 2000, width: 4, height: 4 });
    });
    expect(renders()).toBe(before);
    act(() => {
      mustRun(store, 'renameFrame', { id: 'card', name: 'Profile' });
    });
    expect(renders()).toBe(before + 1);
  });

  it('counts an instance placed on another page', () => {
    const { store, instancePageId } = createComponentBoard({ isInstanceOnSecondPage: true });
    renderWatching(store, 'card', componentSection);
    expect(screen.getByText('1 instance')).toBeDefined();
    act(() => {
      const input = { componentId: 'card', x: 0, y: 1200, pageId: instancePageId };
      mustRun(store, 'createInstance', { ...input, instanceId: 'inst-2' });
    });
    expect(screen.getByText('2 instances')).toBeDefined();
    act(() => {
      mustRun(store, 'deleteObjects', { ids: ['inst'] });
    });
    expect(screen.getByText('1 instance')).toBeDefined();
  });
});
