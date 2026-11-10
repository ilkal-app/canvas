// The document side of the components UI, over the real mount wiring
// (`createEngineDocument`: the page-scoped view, the whole board's definitions, the pages):
// create component, the inspector's component commands, and the delete confirmation.
import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createRectangle } from './__fixtures__/component-board.js';
import { mountComponentBoard as mounted } from './__fixtures__/mounted-component-board.js';

describe('create component (ruling 2)', () => {
  it('wraps the selection in a main named "Component N" and selects it, as one undo step', () => {
    const { store, document, run } = mounted();
    createRectangle(store, 'a', null, { x: 0, y: 900, width: 20, height: 20 });
    createRectangle(store, 'b', null, { x: 40, y: 900, width: 20, height: 20 });
    document.selectTool.select(['a', 'b'] as ObjectId[]);
    expect(run({ type: 'arrange', command: 'createComponent' })).toBe(true);
    const [mainId] = document.selectTool.selection.ids;
    const main = mainId === undefined ? undefined : store.get(mainId);
    expect(main).toMatchObject({ type: 'component', name: 'Component 3', retired: false });
    expect(store.get('a' as ObjectId)?.parentId).toBe(mainId);
    run({ type: 'history', command: 'undo' });
    // Undoing a main's creation retires it (the document keeps it for concurrent instances).
    expect(mainId === undefined ? undefined : store.get(mainId)).toMatchObject({ retired: true });
    expect(store.get('a' as ObjectId)?.parentId).toBeNull();
  });

  it('tells the person why nothing was made', () => {
    const { store, document, run, onNotice } = mounted();
    run({ type: 'arrange', command: 'createComponent' });
    expect(onNotice).toHaveBeenLastCalledWith('Select objects to make a component.');
    createRectangle(store, 'a', null, { x: 0, y: 900, width: 20, height: 20 });
    document.selectTool.select(['a', 'title'] as ObjectId[]);
    run({ type: 'arrange', command: 'createComponent' });
    expect(onNotice).toHaveBeenLastCalledWith(
      'Only objects in the same frame or group can make a component.',
    );
  });

  // A whiteboard (the floating chrome) has no components, whoever dispatches the action.
  it('makes nothing while the chrome has no design tools, and does once it has them', () => {
    let hasDesignTools = false;
    const { store, document, run } = mounted(false, () => hasDesignTools);
    createRectangle(store, 'a', null, { x: 0, y: 900, width: 20, height: 20 });
    document.selectTool.select(['a'] as ObjectId[]);
    expect(run({ type: 'arrange', command: 'createComponent' })).toBe(true);
    expect(store.get('a' as ObjectId)?.parentId).toBeNull();
    hasDesignTools = true;
    run({ type: 'arrange', command: 'createComponent' });
    expect(store.get('a' as ObjectId)?.parentId).not.toBeNull();
  });

  it('does nothing for a person who cannot edit', () => {
    const { store, document, run } = mounted();
    createRectangle(store, 'a', null, { x: 0, y: 900, width: 20, height: 20 });
    document.selectTool.select(['a'] as ObjectId[]);
    document.setEditable(false);
    run({ type: 'arrange', command: 'createComponent' });
    expect(store.get('a' as ObjectId)?.parentId).toBeNull();
  });
});

describe('the inspector’s component commands (rulings 4 and 5)', () => {
  it('overrides a child of an instance whose main is on another page, one undo step', () => {
    const { pages, instancePageId, component, instance, run } = mounted(true);
    pages.show(instancePageId);
    const override = { fill: [0, 1, 0, 1] as [number, number, number, number] };
    component({ command: 'setOverride', id: 'inst' as ObjectId, path: 'body', override });
    component({
      command: 'setOverride',
      id: 'inst' as ObjectId,
      path: 'badge-in-card/dot',
      override: { isHidden: true },
    });
    expect(instance().overrides).toEqual({
      body: { fill: [0, 1, 0, 1] },
      'badge-in-card/dot': { isHidden: true },
    });
    run({ type: 'history', command: 'undo' });
    expect(instance().overrides).toEqual({ body: { fill: [0, 1, 0, 1] } });
  });

  it('holds a command committed during a press on the board until the press ends', () => {
    // An inspector text field commits on blur, which a press on the board takes.
    const { document, component, instance, run } = mounted();
    const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
    const press = (kind: 'pointerDown' | 'pointerUp'): void => {
      const input = {
        kind,
        screen: { x: 790, y: 590 },
        isShiftPressed: false,
        isModPressed: false,
      };
      document.handlePointer(input, camera);
    };
    press('pointerDown');
    component({
      command: 'setOverride',
      id: 'inst' as ObjectId,
      path: 'title',
      override: { text: 'Hi' },
    });
    expect(instance().overrides).toEqual({});
    press('pointerUp');
    expect(instance().overrides).toEqual({ title: { text: 'Hi' } });
    run({ type: 'history', command: 'undo' });
    expect(instance().overrides).toEqual({});
  });

  it('resets one field of a child, one child’s overrides, then all', () => {
    const { component, instance } = mounted();
    const id = 'inst' as ObjectId;
    component({ command: 'setOverride', id, path: 'body', override: { fill: [0, 1, 0, 1] } });
    component({ command: 'setOverride', id, path: 'title', override: { text: 'Hi' } });
    component({ command: 'setOverride', id, path: 'title', override: { isHidden: true } });
    component({ command: 'resetOverrides', id, path: 'title', fields: ['isHidden'] });
    component({ command: 'resetOverrides', id, path: 'body' });
    expect(instance().overrides).toEqual({ title: { text: 'Hi' } });
    component({ command: 'resetOverrides', id });
    expect(instance().overrides).toEqual({});
  });

  it('detaches an instance into a frame of plain objects, one undo step', () => {
    const { store, pages, instancePageId, component, run } = mounted(true);
    pages.show(instancePageId);
    component({ command: 'detach', id: 'inst' as ObjectId });
    expect(store.get('inst' as ObjectId)?.type).toBe('frame');
    expect(store.references.childrenOf('inst' as ObjectId).size).toBeGreaterThan(0);
    run({ type: 'history', command: 'undo' });
    expect(store.get('inst' as ObjectId)?.type).toBe('instance');
  });

  it('places an instance to the right of a main, on its page, and selects it', () => {
    const { store, document, firstPageId, component } = mounted();
    const main = store.get('card' as ObjectId);
    if (main?.type !== 'component') throw new Error('the card exists');
    component({ command: 'placeInstance', id: 'card' as ObjectId });
    const [placedId] = document.selectTool.selection.ids;
    const placed = placedId === undefined ? undefined : store.get(placedId);
    expect(placed).toMatchObject({
      type: 'instance',
      mainId: 'card',
      parentId: null,
      pageId: firstPageId,
      x: main.x + main.width + 40,
      y: main.y,
    });
  });

  it('renames a main', () => {
    const { store, component } = mounted();
    component({ command: 'rename', id: 'card' as ObjectId, name: 'Profile card' });
    expect(store.get('card' as ObjectId)).toMatchObject({ name: 'Profile card' });
  });

  it('goes to a main on another page: shows it, selects it, leaves the zoom to the camera', () => {
    const { pages, firstPageId, instancePageId, document, component } = mounted(true);
    pages.show(instancePageId);
    document.selectTool.select(['inst'] as ObjectId[]);
    expect(component({ command: 'goToMain', id: 'card' as ObjectId })).toBe(false);
    expect(pages.current()).toBe(firstPageId);
    expect(document.selectTool.selection.ids).toEqual(['card']);
  });

  it('lets a person who cannot edit go to a main and nothing else', () => {
    const { document, component, instance } = mounted();
    document.setEditable(false);
    const id = 'inst' as ObjectId;
    component({ command: 'setOverride', id, path: 'body', override: { fill: [0, 1, 0, 1] } });
    component({ command: 'detach', id });
    expect(instance().overrides).toEqual({});
    component({ command: 'goToMain', id: 'card' as ObjectId });
    expect(document.selectTool.selection.ids).toEqual(['card']);
  });
});

describe('deleting a main asks first (ruling 6)', () => {
  it('waits for the person when a deletion would detach an instance; Cancel keeps it', () => {
    const { store, document, run } = mounted();
    const deletions = document.panels.board.deletions;
    const listener = vi.fn();
    const stop = deletions?.subscribe(listener);
    document.selectTool.select(['card'] as ObjectId[]);
    run({ type: 'selection', command: 'delete' });
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
    expect(listener).toHaveBeenCalled();
    expect(deletions?.current()?.deletion).toEqual({
      name: 'Card',
      mainCount: 1,
      instanceCount: 1,
    });
    deletions?.current()?.cancel();
    expect(deletions?.current()).toBeUndefined();
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
    run({ type: 'selection', command: 'delete' });
    deletions?.current()?.confirm();
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: true });
    expect(store.get('inst' as ObjectId)?.type).toBe('frame');
    stop?.();
  });

  it('asks before a cut deletes the main, the copy already written', () => {
    const { store, document, clipboard } = mounted();
    const deletions = document.panels.board.deletions;
    const stop = deletions?.subscribe(() => undefined);
    document.selectTool.select(['card'] as ObjectId[]);
    const cut = clipboard.prepareCut();
    if (cut.kind !== 'ready') throw new Error('the cut is ready');
    cut.remove();
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
    deletions?.current()?.confirm();
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: true });
    stop?.();
  });

  it('deletes at once when nobody is there to ask, or when no instance would change', () => {
    const { store, document, run } = mounted();
    document.selectTool.select(['card'] as ObjectId[]);
    run({ type: 'selection', command: 'delete' });
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: true });
    const stop = document.panels.board.deletions?.subscribe(() => undefined);
    createRectangle(store, 'loose', null, { x: 0, y: 900, width: 20, height: 20 });
    document.selectTool.select(['loose'] as ObjectId[]);
    run({ type: 'selection', command: 'delete' });
    expect(store.get('loose' as ObjectId)).toBeUndefined();
    stop?.();
  });
});
