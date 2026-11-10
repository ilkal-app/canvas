import { describe, expect, it, vi } from 'vitest';

import type { PageId } from '@canvas/schema';

import { createEngineDocument } from './create-engine-document.js';
import { createDemoDocument } from './demo-document.js';

describe('createEngineDocument pages', () => {
  it('tells the person of a refused page command', () => {
    const onNotice = vi.fn();
    const { document, pages } = createEngineDocument({ onNotice }, () => undefined);
    expect(pages.run('deletePage', { pageId: 'nowhere' })).toBeUndefined();
    expect(onNotice).toHaveBeenCalledTimes(1);
    document.destroy();
  });

  it('ends the mode under way and clears the selection before showing another page', () => {
    const store = createDemoDocument();
    const { document, pages } = createEngineDocument({ store }, () => undefined);
    const [first] = store.read().objects.keys();
    if (first === undefined) throw new Error('the demo board holds objects');
    document.selectTool.select([first]);
    expect(document.selectTool.selection.ids).toEqual([first]);
    const abandon = vi.spyOn(document.tools.router, 'abandonActiveMode');
    const added = pages.run('addPage', {}) as { pageId: PageId };
    pages.show(added.pageId);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(document.selectTool.selection.ids).toEqual([]);
    expect(pages.current()).toBe(added.pageId);
    document.destroy();
    store.destroy();
  });
});
