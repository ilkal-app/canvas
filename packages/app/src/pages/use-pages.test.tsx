// @vitest-environment jsdom
// The page shown, followed where the shell always is: the address and presence keep up
// while the page list is closed away in the layers drawer.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import { createSeededIdGenerator, type PageId, type PrincipalId } from '@canvas/schema';

import { createPageView } from './create-page-view.js';
import type { PageNavigation } from './page-navigator.js';
import { usePageShown } from './use-pages.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

/**
 * The page shown followed with no page list mounted, as while the layers drawer is closed.
 *
 * @param props - The component's props.
 * @param props.pages - The pages, or undefined before an engine mounts.
 * @param props.onShown - Hears each page shown.
 * @param props.isInAddress - Whether the page shown is kept in the address; true if absent.
 * @returns Nothing.
 */
function NoPageList(props: {
  readonly pages: PageNavigation | undefined;
  readonly onShown: (pageId: PageId) => void;
  readonly isInAddress?: boolean;
}): null {
  usePageShown(props.pages, props.onShown, props.isInAddress);
  return null;
}

describe('usePageShown', () => {
  it('keeps the address and presence on the page shown, an unknown address leaving the first', () => {
    history.replaceState(null, '', '/?page=nowhere');
    const store = new YjsDocumentStore();
    const environment = { clock: () => 1, createId: createSeededIdGenerator(9) };
    const { pages, release } = createPageView(store, ORIGIN, environment, {});
    const shown = vi.fn();
    render(<NoPageList pages={pages} onShown={shown} />);
    expect(pages.current()).toBe('page-1');
    expect(new URL(location.href).searchParams.get('page')).toBe('page-1');
    expect(shown).toHaveBeenLastCalledWith('page-1');
    let added: PageId | undefined;
    act(() => {
      added = (pages.run('addPage', {}) as { readonly pageId: PageId }).pageId;
      pages.show(added);
    });
    expect(new URL(location.href).searchParams.get('page')).toBe(added);
    expect(shown).toHaveBeenLastCalledWith(added);
    release();
    store.destroy();
  });

  it('leaves an embedding host’s address alone, neither reading nor writing it', () => {
    const store = new YjsDocumentStore();
    const environment = { clock: () => 1, createId: createSeededIdGenerator(9) };
    const { pages, release } = createPageView(store, ORIGIN, environment, {});
    const second = (pages.run('addPage', {}) as { readonly pageId: PageId }).pageId;
    history.replaceState(null, '', `/host?page=${second}&tab=2`);
    const shown = vi.fn();
    render(<NoPageList pages={pages} onShown={shown} isInAddress={false} />);
    // A page the host's address names is not opened: the board stays on its first.
    expect(pages.current()).toBe('page-1');
    act(() => {
      pages.show(second);
    });
    expect(location.pathname + location.search).toBe(`/host?page=${second}&tab=2`);
    expect(shown.mock.calls).toEqual([['page-1'], [second]]);
    release();
    store.destroy();
  });

  it('does nothing before an engine mounts', () => {
    const shown = vi.fn();
    render(<NoPageList pages={undefined} onShown={shown} />);
    expect(shown).not.toHaveBeenCalled();
    expect(new URL(location.href).searchParams.get('page')).toBeNull();
  });
});
