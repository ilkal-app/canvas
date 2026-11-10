// Components across pages from the app (rule 6, part B1): the person's commands run
// through the page-scoped view, but a main's instances, and an instance's main, may be on
// other pages. Every command that reads them must see the whole board.
import { describe, expect, it, vi } from 'vitest';

import { planPaste } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { mustRun } from './__fixtures__/component-board.js';
import { mountComponentBoard } from './__fixtures__/mounted-component-board.js';

/**
 * The card board with the card's `inst` on a second page and `inst-a` on the main's page.
 *
 * @returns The mounted board.
 */
function twoPages() {
  const mounted = mountComponentBoard(true);
  const input = { componentId: 'card', x: 100, y: 900, instanceId: 'inst-a' };
  mustRun(mounted.store, 'createInstance', { ...input, pageId: mounted.firstPageId });
  return mounted;
}

/**
 * The type of an object of the whole board.
 *
 * @param mounted - The board.
 * @param id - The object.
 * @returns Its type, or undefined when it is gone.
 */
function typeOf(mounted: ReturnType<typeof twoPages>, id: string): string | undefined {
  return mounted.store.get(id as ObjectId)?.type;
}

describe('deleting a main detaches its instances on every page (rule 6)', () => {
  it('asks with every instance counted, then detaches them all in one undo step', () => {
    const mounted = twoPages();
    const { store, document, run, pages, firstPageId } = mounted;
    expect(pages.current()).toBe(firstPageId);
    const deletions = document.panels.board.deletions;
    const stop = deletions?.subscribe(() => undefined);
    document.selectTool.select(['card'] as ObjectId[]);
    run({ type: 'selection', command: 'delete' });
    expect(deletions?.current()?.deletion).toEqual({
      name: 'Card',
      mainCount: 1,
      instanceCount: 2,
    });
    deletions?.current()?.confirm();
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: true });
    expect(typeOf(mounted, 'inst')).toBe('frame');
    expect(typeOf(mounted, 'inst-a')).toBe('frame');
    run({ type: 'history', command: 'undo' });
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
    expect(typeOf(mounted, 'inst')).toBe('instance');
    expect(typeOf(mounted, 'inst-a')).toBe('instance');
    stop?.();
  });

  it('detaches off-page instances when nobody is there to ask', () => {
    const mounted = twoPages();
    mounted.document.selectTool.select(['card'] as ObjectId[]);
    mounted.run({ type: 'selection', command: 'delete' });
    expect(typeOf(mounted, 'inst')).toBe('frame');
  });

  it('asks before a cut, counting the instance on the other page', () => {
    const mounted = twoPages();
    const { document, clipboard } = mounted;
    const deletions = document.panels.board.deletions;
    const stop = deletions?.subscribe(() => undefined);
    document.selectTool.select(['card'] as ObjectId[]);
    const cut = clipboard.prepareCut();
    if (cut.kind !== 'ready') throw new Error('the cut is ready');
    cut.remove();
    expect(deletions?.current()?.deletion.instanceCount).toBe(2);
    deletions?.current()?.confirm();
    expect(typeOf(mounted, 'inst')).toBe('frame');
    expect(typeOf(mounted, 'inst-a')).toBe('frame');
    stop?.();
  });

  it('asks about a main whose only instances are on another page', () => {
    const mounted = mountComponentBoard(true);
    const { document, run } = mounted;
    const deletions = document.panels.board.deletions;
    const stop = deletions?.subscribe(() => undefined);
    document.selectTool.select(['card'] as ObjectId[]);
    run({ type: 'selection', command: 'delete' });
    expect(deletions?.current()?.deletion.instanceCount).toBe(1);
    deletions?.current()?.cancel();
    expect(typeOf(mounted, 'inst')).toBe('instance');
    stop?.();
  });
});

describe('deleting a main with the main of an instance in its content', () => {
  it('detaches the outer instance in one undo step, refused no more (PR 192, ruling 13)', () => {
    const mounted = mountComponentBoard();
    const { store, run, onNotice } = mounted;
    mounted.document.selectTool.select(['card', 'badge'] as ObjectId[]);
    run({ type: 'selection', command: 'delete' });
    expect(onNotice).not.toHaveBeenCalled();
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: true });
    expect(store.get('badge' as ObjectId)).toMatchObject({ retired: true });
    expect(typeOf(mounted, 'inst')).toBe('frame');
    run({ type: 'history', command: 'undo' });
    expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
    expect(store.get('badge' as ObjectId)).toMatchObject({ retired: false });
    expect(typeOf(mounted, 'inst')).toBe('instance');
  });
});

describe('an instance whose main is on another page (rules 2 and 4)', () => {
  /**
   * The board shown on the instance's page, with the instance selected.
   *
   * @returns The mounted board.
   */
  function onInstancePage() {
    const mounted = twoPages();
    mounted.pages.show(mounted.instancePageId);
    mounted.document.selectTool.select(['inst'] as ObjectId[]);
    return mounted;
  }

  /**
   * The one selected object.
   *
   * @param mounted - The board.
   * @returns It, as the whole board holds it.
   */
  function selected(mounted: ReturnType<typeof twoPages>) {
    const [id] = mounted.document.selectTool.selection.ids;
    return id === undefined ? undefined : mounted.store.get(id);
  }

  it('duplicates it on its page', () => {
    const mounted = onInstancePage();
    mounted.clipboard.duplicateSelection();
    expect(selected(mounted)).toMatchObject({
      type: 'instance',
      mainId: 'card',
      pageId: mounted.instancePageId,
    });
    expect(selected(mounted)?.id).not.toBe('inst');
  });

  it('pastes it on the page shown', () => {
    const mounted = onInstancePage();
    const copied = mounted.clipboard.copySelection();
    const target = mounted.clipboard.pasteTarget({ x: 900, y: 900 }, { x: 0, y: 0 });
    const created = vi.fn();
    target.createObjects(copied === undefined ? [] : planPaste(copied, target.pointer), created);
    expect(created.mock.lastCall?.[0]).toHaveLength(1);
    expect(selected(mounted)).toMatchObject({
      type: 'instance',
      mainId: 'card',
      pageId: mounted.instancePageId,
    });
  });

  it('makes a component of it', () => {
    const mounted = onInstancePage();
    mounted.run({ type: 'arrange', command: 'createComponent' });
    const main = selected(mounted);
    expect(main).toMatchObject({ type: 'component', pageId: mounted.instancePageId });
    expect(mounted.store.get('inst' as ObjectId)?.parentId).toBe(main?.id);
  });

  it('deletes it alone, with no question', () => {
    const mounted = onInstancePage();
    const stop = mounted.document.panels.board.deletions?.subscribe(() => undefined);
    mounted.run({ type: 'selection', command: 'delete' });
    expect(mounted.store.get('inst' as ObjectId)).toBeUndefined();
    expect(mounted.store.get('card' as ObjectId)).toMatchObject({ retired: false });
    stop?.();
  });

  it('deletes the page holding a main and detaches its instances elsewhere', () => {
    const mounted = twoPages();
    const { pages, firstPageId, instancePageId } = mounted;
    // The badge goes first: a nested instance of a main retired with it is refused (ruling 13).
    pages.run('moveObjectsToPage', { ids: ['badge'], pageId: instancePageId });
    pages.run('deletePage', { pageId: firstPageId });
    expect(mounted.store.get('card' as ObjectId)).toMatchObject({ retired: true });
    expect(typeOf(mounted, 'inst')).toBe('frame');
  });
});

describe('the panels’ board view across pages', () => {
  it('tells the whole board’s changes apart from the page’s', () => {
    const mounted = mountComponentBoard(true);
    const view = mounted.document.panels.board;
    const page = vi.fn();
    const whole = vi.fn();
    const stopPage = view.subscribe(page);
    const stopWhole = view.subscribeDefinitions?.(whole);
    // The card's instance is on the second page; the page shown is the first.
    mustRun(mounted.store, 'setInstanceOverride', {
      id: 'inst',
      path: 'title',
      override: { text: 'Hi' },
    });
    expect(page).not.toHaveBeenCalled();
    expect(whole).toHaveBeenCalledWith(expect.objectContaining({ updated: ['inst'] }));
    stopPage();
    stopWhole?.();
  });
});

describe('placing an instance from the components panel (ruling 3)', () => {
  it('centres it on the point, on the page shown, selected, as one undo step', () => {
    const mounted = twoPages();
    const { clipboard, pages, instancePageId, document, store, run } = mounted;
    pages.show(instancePageId);
    clipboard.placeInstance('card' as ObjectId, { x: 500, y: 400 });
    const [placedId] = document.selectTool.selection.ids;
    const placed = placedId === undefined ? undefined : store.get(placedId);
    const main = store.get('card' as ObjectId);
    if (main?.type !== 'component' || placed?.type !== 'instance') throw new Error('placed');
    expect(placed).toMatchObject({ type: 'instance', mainId: 'card', pageId: instancePageId });
    expect(placed.x + placed.width / 2).toBe(500);
    expect(placed.y + placed.height / 2).toBe(400);
    expect(placed.width).toBe(main.width);
    run({ type: 'history', command: 'undo' });
    expect(store.get(placed.id)).toBeUndefined();
  });

  it('places nothing for a person who cannot edit, or of a main not on the board', () => {
    const mounted = twoPages();
    const { clipboard, document, store } = mounted;
    expect(clipboard.canPlace()).toBe(true);
    document.setEditable(false);
    expect(clipboard.canPlace()).toBe(false);
    const before = store.read().objects.size;
    clipboard.placeInstance('card' as ObjectId, { x: 0, y: 0 });
    expect(store.read().objects.size).toBe(before);
    document.setEditable(true);
    clipboard.placeInstance('no-such-main' as ObjectId, { x: 0, y: 0 });
    expect(store.read().objects.size).toBe(before);
  });
});
