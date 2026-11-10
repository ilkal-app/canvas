// @vitest-environment jsdom
// The inspector's instance section (rulings 1, 5 and 8) over a real board: the main's
// name, Go to main, Detach, Reset all, and a row per overridable child of the main, each change
// one component action.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import { editableOverrideFields, type ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './instance-section.js';

/**
 * Renders the section for the card's instance.
 *
 * @param store - The board.
 * @param options - Whether the person may edit, and whether the instance is locked.
 * @param options.canEdit - Whether they may edit; true if absent.
 * @param options.isLocked - Whether the instance is locked; false if absent.
 * @returns The dispatch spy.
 * @throws {Error} When the instance is missing.
 */
function renderSection(
  store: YjsDocumentStore,
  options: { readonly canEdit?: boolean; readonly isLocked?: boolean } = {},
) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const instance = store.get('inst' as ObjectId);
  if (instance === undefined) throw new Error('no instance');
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

/**
 * A child's row.
 *
 * @param name - The row's name.
 * @returns The row.
 */
function row(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

afterEach(cleanup);

describe('the instance section', () => {
  it('offers an Opacity override for a child, commits percent and resets only opacity', () => {
    const { store } = createComponentBoard();
    const child = store.get('body' as ObjectId);
    if (child === undefined) throw new Error('body missing');
    expect(editableOverrideFields(child)).toContain('opacity');
    const first = renderSection(store);
    const body = screen
      .getAllByRole('group', { name: 'Rectangle' })
      .find((candidate) => candidate.style.paddingInlineStart === '0px');
    if (body === undefined) throw new Error('body row missing');
    const field = within(body).getByRole('spinbutton', { name: 'Opacity' });
    expect((field as HTMLInputElement).value).toBe('100');
    fireEvent.change(field, { target: { value: '40' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(first.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'body',
      override: { opacity: 0.4 },
    });
    cleanup();
    mustRun(store, 'setInstanceOverride', { id: 'inst', path: 'body', override: { opacity: 0.4 } });
    const second = renderSection(store);
    const overridden = screen
      .getAllByRole('group', { name: 'Rectangle' })
      .find((candidate) => candidate.style.paddingInlineStart === '0px');
    if (overridden === undefined) throw new Error('body row missing');
    expect(
      within(overridden).getByRole<HTMLInputElement>('spinbutton', { name: 'Opacity' }).value,
    ).toBe('40');
    fireEvent.click(within(overridden).getByRole('button', { name: 'Reset opacity' }));
    expect(second.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'body',
      fields: ['opacity'],
    });
  });
  // NumberControl commits on Enter and refuses a value outside its min/max. Scale is a percent.
  it('shows 100% by default, commits scale once, refuses out-of-range input, and resets only a scaled instance', () => {
    const { store } = createComponentBoard();
    const first = renderSection(store);
    const scale = screen.getByRole('spinbutton', { name: 'Scale' });
    expect((scale as HTMLInputElement).value).toBe('100');
    expect(screen.queryByRole('button', { name: 'Reset scale' })).toBeNull();
    fireEvent.change(scale, { target: { value: '200' } });
    fireEvent.keyDown(scale, { key: 'Enter' });
    expect(first.dispatch).toHaveBeenCalledTimes(1);
    expect(first.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setScale',
      id: 'inst',
      scale: 2,
    });
    cleanup();
    mustRun(store, 'resizeObjects', { resizes: [{ id: 'inst', scale: 2 }] });
    const second = renderSection(store);
    const scaled = screen.getByRole('spinbutton', { name: 'Scale' });
    expect((scaled as HTMLInputElement).value).toBe('200');
    // Out of range (5% to 2000%) is refused with the field's range message, as every inspector
    // number field refuses it, and nothing is dispatched.
    for (const outside of ['3000', '1']) {
      fireEvent.change(scaled, { target: { value: outside } });
      fireEvent.keyDown(scaled, { key: 'Enter' });
      expect(scaled.getAttribute('aria-invalid')).toBe('true');
    }
    expect(second.dispatch).not.toHaveBeenCalled();
    fireEvent.change(scaled, { target: { value: '2000' } });
    fireEvent.keyDown(scaled, { key: 'Enter' });
    expect(second.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setScale',
      id: 'inst',
      scale: 20,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset scale' }));
    expect(second.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setScale',
      id: 'inst',
      scale: 1,
    });
  });
  it('registers for instances only, with its own read-only state', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'instance',
      title: 'Instance',
      context: 'instance',
      isSelectionOnly: true,
      hasOwnLockState: true,
    });
  });

  it('names the main and goes to it', () => {
    const { store } = createComponentBoard({ isInstanceOnSecondPage: true });
    const { dispatch } = renderSection(store);
    expect(screen.getByText('Card')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Go to main' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'component', command: 'goToMain', id: 'card' });
  });

  it('detaches, and resets all only once something is overridden', () => {
    const { store } = createComponentBoard();
    const first = renderSection(store);
    const resetAll = screen.getByRole('button', { name: 'Reset all' });
    expect(resetAll.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
    expect(first.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'detach',
      id: 'inst',
    });
    cleanup();
    mustRun(store, 'setInstanceOverride', { id: 'inst', path: 'title', override: { text: 'Hi' } });
    const { dispatch } = renderSection(store);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
    });
  });

  it('lists a row per child, a nested instance’s children under it', () => {
    const { store } = createComponentBoard();
    renderSection(store);
    // The section's fieldsets are unnamed groups; the rows are named after their child.
    const names = screen
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label'))
      .filter((name) => name !== null);
    expect(names).toEqual([
      'Instance of Badge',
      'Rectangle',
      'Image',
      'Note “Notes”',
      'Text “Title”',
      'Rectangle',
    ]);
  });

  it('overrides a text, committed on Enter', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    const field = within(row('Text “Title”')).getByRole('textbox', { name: 'Text' });
    expect((field as HTMLInputElement).value).toBe('Title');
    fireEvent.change(field, { target: { value: 'Welcome' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'title',
      override: { text: 'Welcome' },
    });
  });

  it('hides a child, and shows it again by clearing that field alone', () => {
    const { store } = createComponentBoard();
    const first = renderSection(store);
    fireEvent.click(within(row('Image')).getByRole('button', { name: 'Hidden' }));
    expect(first.dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'photo',
      override: { isHidden: true },
    });
    cleanup();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'photo',
      override: { isHidden: true },
    });
    const { dispatch } = renderSection(store);
    const hidden = within(row('Image')).getByRole('button', { name: 'Hidden' });
    expect(hidden.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hidden);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'photo',
      fields: ['isHidden'],
    });
  });

  it('overrides a nested instance child’s fill by its nested path', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    const [dot] = screen.getAllByRole('group', { name: 'Rectangle' });
    if (dot === undefined) throw new Error('no dot row');
    const fill = within(dot).getByLabelText('Fill');
    fireEvent.change(fill, { target: { value: '#00ff00' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'badge-in-card/dot',
      override: { fill: [0, 1, 0, 1] },
    });
  });

  it('resets one overridden property of a child, keeping its others (rule 4)', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'note',
      override: { color: [0, 0, 1, 1], text: 'Later' },
    });
    const { dispatch } = renderSection(store);
    const note = row('Note “Notes”');
    // One Reset per overridden property; none for the row as a whole.
    expect(within(note).queryByRole('button', { name: /^Reset$/ })).toBeNull();
    fireEvent.click(within(note).getByRole('button', { name: 'Reset colour' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'note',
      fields: ['color'],
    });
    fireEvent.click(within(note).getByRole('button', { name: 'Reset text' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'note',
      fields: ['text'],
    });
    // A property without an override, and a child without any, offer no Reset.
    expect(within(row('Text “Title”')).queryAllByRole('button', { name: /^Reset/ })).toEqual([]);
  });

  it('resets a fill or a stroke colour alone', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'body',
      override: { fill: [0, 1, 0, 1], strokeColor: [0, 0, 1, 1] },
    });
    const { dispatch } = renderSection(store);
    // Two rows are rectangles: the card's body and, nested one level, the badge's dot.
    const rectangles = screen.getAllByRole('group', { name: 'Rectangle' });
    const isNested = (candidate: HTMLElement) => candidate.style.paddingInlineStart !== '0px';
    const body = rectangles.find((candidate) => !isNested(candidate));
    const dot = rectangles.find(isNested);
    if (body === undefined || dot === undefined) throw new Error('no rectangle rows');
    expect(within(dot).queryAllByRole('button', { name: /^Reset/ })).toEqual([]);
    for (const [name, field] of [
      ['Reset fill', 'fill'],
      ['Reset stroke', 'strokeColor'],
    ] as const) {
      fireEvent.click(within(body).getByRole('button', { name }));
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'component',
        command: 'resetOverrides',
        id: 'inst',
        path: 'body',
        fields: [field],
      });
    }
  });

  it('resets a replaced image’s asset, size and crop together, with or without images', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'photo',
      override: {
        assetId: 'asset-override',
        naturalSize: { width: 400, height: 300 },
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    });
    const { dispatch } = renderSection(store);
    fireEvent.click(within(row('Image')).getByRole('button', { name: 'Reset image' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'photo',
      fields: ['assetId', 'naturalSize', 'crop'],
    });
  });

  it('shows read-only to a person who cannot edit, or for a locked instance, but goes to the main', () => {
    for (const options of [{ canEdit: false }, { isLocked: true }]) {
      const { store } = createComponentBoard();
      const { dispatch } = renderSection(store, options);
      expect(screen.getByRole('button', { name: 'Detach' }).closest('fieldset')?.disabled).toBe(
        true,
      );
      expect(within(row('Text “Title”')).getByRole('textbox').closest('fieldset')?.disabled).toBe(
        true,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Go to main' }));
      expect(dispatch).toHaveBeenCalledWith({ type: 'component', command: 'goToMain', id: 'card' });
      cleanup();
    }
  });
});
