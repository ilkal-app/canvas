// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createRectangle, mustRun } from '../../engine/__fixtures__/component-board.js';
import { LOCAL_USER_ORIGIN } from '../../engine/demo-document.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { renderSwapSection, swapBoard } from './__fixtures__/swap-section.js';
import { stylePanelSection } from './instance-section.js';

afterEach(cleanup);

/**
 * The Swap options group's checkbox of a name.
 *
 * @param name - Its name.
 * @returns It.
 */
function option(name: string): HTMLInputElement {
  const group = screen.getByRole('group', { name: 'Swap options' });
  return within(group).getByRole('checkbox', { name });
}

/**
 * Sets a slot's options as a remote peer may, unchecked.
 *
 * @param store - The board.
 * @param options - The options.
 */
function setOptions(store: YjsDocumentStore, options: readonly string[]): void {
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    transaction.patchObject('badge-in-card' as ObjectId, {
      swapOptions: options as ObjectId[],
    });
  });
}

/**
 * The card instance's Main picker's option names.
 *
 * @returns The names.
 */
function choices(): string[] {
  const picker = within(screen.getByRole('group', { name: /Instance of/ })).getByRole('combobox', {
    name: 'Main',
  });
  return Array.from((picker as HTMLSelectElement).options, (choice) => choice.text);
}

describe('the Swap options group', () => {
  it('clears the list when its last main is cleared, and ignores clearing Any main', () => {
    const store = swapBoard();
    setOptions(store, ['check']);
    const { dispatch } = renderSwapSection(store, 'badge-in-card');
    expect(option('Any main').checked).toBe(false);
    fireEvent.click(option('Check'));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setSwapOptions',
      id: 'badge-in-card',
      options: null,
    });
    cleanup();
    const any = renderSwapSection(swapBoard(), 'badge-in-card');
    fireEvent.click(option('Any main'));
    expect(any.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the checked mains in the list order, and disables the rest at the limit', () => {
    const store = swapBoard();
    setOptions(store, ['check']);
    const { dispatch } = renderSwapSection(store, 'badge-in-card');
    fireEvent.click(option('Badge'));
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: ['badge', 'check'] }),
    );
    cleanup();
    setOptions(
      store,
      [...Array(64).keys()].map((index) => `main-${String(index)}`),
    );
    renderSwapSection(store, 'badge-in-card');
    expect(option('Check').disabled).toBe(true);
  });
});

describe('the instance section follows the board’s mains', () => {
  it('offers a main created or renamed anywhere', () => {
    const store = swapBoard();
    const instance = store.get('inst' as ObjectId);
    if (instance?.type !== 'instance') throw new Error('missing instance');
    const props: StylePanelSectionProps = {
      context: 'instance',
      selection: [instance],
      board: store,
      definitions: store,
      watchDefinitions: (listener) => store.subscribe(listener),
      defaults: undefined,
      isLocked: false,
      shortcuts: createDefaultShortcutRegistry('other'),
      dispatch: vi.fn<(action: ShellAction) => void>(),
      applyStyle: vi.fn(),
    };
    render(<stylePanelSection.render {...props} />);
    expect(choices()).toEqual(['Badge', 'Check']);
    act(() => {
      createRectangle(store, 'star-shape', null, { x: 900, y: 100, width: 20, height: 20 });
      mustRun(store, 'createComponent', { ids: ['star-shape'], name: 'Star', componentId: 'star' });
    });
    expect(choices()).toEqual(['Badge', 'Check', 'Star']);
    act(() => {
      mustRun(store, 'renameFrame', { id: 'check', name: 'Tick' });
    });
    expect(choices()).toEqual(['Badge', 'Tick', 'Star']);
  });
});

describe('the instance section without swaps', () => {
  it('lists no mains for an instance without slots, and nothing without an instance', () => {
    const store = swapBoard();
    mustRun(store, 'createInstance', { componentId: 'check', x: 0, y: 0, instanceId: 'tick' });
    renderSwapSection(store, 'tick');
    expect(screen.queryByRole('combobox', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Swap options' })).toBeNull();
    cleanup();
    const { container } = render(
      <stylePanelSection.render
        context="instance"
        selection={[]}
        board={store}
        defaults={undefined}
        isLocked={false}
        shortcuts={createDefaultShortcutRegistry('other')}
        dispatch={vi.fn()}
        applyStyle={vi.fn()}
      />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
