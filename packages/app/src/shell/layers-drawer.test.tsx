// @vitest-environment jsdom
// The layers drawer: its parts, the focus moving in and back, the skeleton while the
// board loads, and the row states its stylesheet draws. In Chrome:
// tooling/scenario/specs/app/layers-drawer.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import { createDemoDocument } from '../engine/demo-document.js';
import { DocumentBoardView } from '../engine/document-board-view.js';
import skeletonCss from '../feedback/skeleton.module.css?raw';
import toastRegionCss from '../feedback/toast-region.module.css?raw';
import { createMemoryBoardView } from '../panels/__fixtures__/memory-board.js';
import layersCss from '../panels/layers/layers.module.css?raw';
import type { ShellAction } from '../state/shell-action.js';
import { GRAPHITE_COLORS, VELLUM_COLORS } from '../theme/color-tokens.js';
import { LAYER_TOKENS, type LayerTokenName } from '../theme/layer-tokens.js';
import dockCss from '../toolbar/dock.module.css?raw';

import { LayersDrawer, type LayersDrawerProps } from './layers-drawer.js';
import drawerCss from './layers-drawer.module.css?raw';

afterEach(cleanup);

function demoView(): BoardView {
  let ids: readonly ObjectId[] = [];
  return new DocumentBoardView(createDemoDocument(), {
    ids: () => ids,
    select: (next) => {
      ids = [...next];
    },
  });
}

/**
 * Renders the drawer beside an opener button and a stand-in for the zoom control's toggle, as
 * the workspace places it beside the canvas.
 *
 * @param props - The drawer's props besides whether it is open (closed if absent).
 * @returns The dispatch it was given, and a rerender with it open or closed.
 */
function renderDrawer(props: Partial<LayersDrawerProps> = {}) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const view = props.view ?? demoView();
  const drawer = (isOpen: boolean, more: Partial<LayersDrawerProps> = {}) => (
    <div>
      <button type="button">Opener</button>
      <LayersDrawer
        view={view}
        selectedIds={[]}
        dispatch={dispatch}
        {...props}
        {...more}
        isOpen={isOpen}
      />
      <button type="button" data-layers-toggle="">
        Layers
      </button>
    </div>
  );
  const result = render(drawer(props.isOpen ?? false));
  const rerender = (isOpen: boolean, more: Partial<LayersDrawerProps> = {}) => {
    act(() => {
      result.rerender(drawer(isOpen, more));
    });
  };
  return { dispatch, rerender };
}

/**
 * Runs the pending animation frames, a few times over.
 */
async function nextFrames(): Promise<void> {
  for (let frame = 0; frame < 3; frame += 1) {
    await act(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        }),
    );
  }
}

describe('LayersDrawer', () => {
  it('shows nothing while closed', () => {
    renderDrawer();
    expect(screen.queryByRole('complementary', { name: 'Layers' })).toBeNull();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('holds the layers panel, its header ending with the close button, which toggles the drawer', () => {
    const { dispatch } = renderDrawer({ isOpen: true });
    const panel = screen.getByRole('complementary', { name: 'Layers' });
    expect(within(panel).getAllByRole('treeitem').length).toBe(4);
    const close = within(panel).getByRole('button', { name: 'Close layers' });
    expect(close.closest('[data-drawer="layers"]')).not.toBeNull();
    fireEvent.click(close);
    expect(dispatch.mock.calls).toEqual([[{ type: 'toggleLayersDrawer' }]]);
  });

  it('puts the page list at the top of the drawer, above the layers, once there is one', () => {
    renderDrawer({ isOpen: true, pages: <p>Page 1</p> });
    const drawer = document.querySelector('[data-drawer="layers"]');
    const slot = drawer?.firstElementChild;
    expect(slot?.getAttribute('data-drawer-slot')).toBe('pages');
    expect(slot?.textContent).toBe('Page 1');
    expect(slot?.nextElementSibling?.querySelector('[role="tree"]')).not.toBeNull();
  });

  it('has no page slot until there is a page list', () => {
    renderDrawer({ isOpen: true });
    expect(document.querySelector('[data-drawer-slot="pages"]')).toBeNull();
  });

  it('takes no focus when it is open from the start (the person left it open)', () => {
    renderDrawer({ isOpen: true });
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the list’s focus row as it opens, and back to the opener as it closes', async () => {
    const { rerender } = renderDrawer();
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    rerender(true);
    await nextFrames();
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement?.textContent).toBe('Section 4');
    rerender(false);
    expect(document.activeElement).toBe(opener);
  });

  it('gives focus to the layers toggle when what opened it is gone', async () => {
    const { rerender } = renderDrawer();
    rerender(true);
    await nextFrames();
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
    rerender(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Layers' }));
  });

  it('leaves focus where it is when it closes with focus elsewhere', async () => {
    const { rerender } = renderDrawer();
    rerender(true);
    await nextFrames();
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    rerender(false);
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the close button on an empty board', async () => {
    const { rerender } = renderDrawer({ view: createMemoryBoardView([]) });
    rerender(true);
    await nextFrames();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close layers' }));
  });

  it('focuses the close button while the board loads', async () => {
    const { rerender } = renderDrawer({ isLoading: true });
    rerender(true);
    await nextFrames();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close layers' }));
  });

  it('shows static skeleton rows while the board loads, then the rows in their place', () => {
    const { rerender } = renderDrawer({ isOpen: true, isLoading: true });
    const tree = screen.getByRole('tree', { name: 'Layers' });
    expect(tree.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryAllByRole('treeitem')).toEqual([]);
    expect(screen.queryByText('The board is empty.')).toBeNull();
    const skeleton = tree.querySelector('[data-layers-skeleton]');
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    const bars = skeleton?.children ?? [];
    expect(bars.length).toBeGreaterThan(3);
    for (const bar of bars) expect((bar as HTMLElement).style.height).toBe('28px');
    rerender(true, { isLoading: false });
    expect(tree.isConnected).toBe(true);
    expect(tree.getAttribute('aria-busy')).toBeNull();
    expect(tree.querySelector('[data-layers-skeleton]')).toBeNull();
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
  });
});

/**
 * The declarations of every rule in a stylesheet whose selector is exactly the one given. A CSS
 * Modules `@value` statement (the dock's offsets, dock.module.css) is not a rule: it is dropped
 * first, so it never runs into the selector of the rule after it.
 *
 * @param css - The stylesheet.
 * @param selector - The selector.
 * @returns The declarations, joined.
 */
function rulesFor(css: string, selector: string): string {
  const withoutComments = css
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/@value\b[^;{}]*;/g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, found = '']) => found.trim() === selector)
    .map(([, , body = '']) => body)
    .join('\n');
}

/**
 * The declarations of every rule in a stylesheet whose selector list holds the one given (`.a`
 * in `.a, .b`).
 *
 * @param css - The stylesheet.
 * @param selector - The selector.
 * @returns The declarations, joined.
 */
function rulesListing(css: string, selector: string): string {
  const withoutComments = css
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/@value\b[^;{}]*;/g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, found = '']) => found.split(',').some((part) => part.trim() === selector))
    .map(([, , body = '']) => body)
    .join('\n');
}

function luminanceOf(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastOf(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminanceOf(first), luminanceOf(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('the layer rows’ states (the Control states sheet)', () => {
  it('ring a focused row in 2 px of the hand colour outside it, above its neighbours', () => {
    const focus = rulesFor(layersCss, '.row:focus-visible');
    // The ring is the focus ring, which is the hand colour since UI-18.
    expect(focus).toMatch(/outline:\s*2px solid var\(--color-focus-ring\)/);
    expect(GRAPHITE_COLORS['--color-focus-ring']).toBe(GRAPHITE_COLORS['--color-hand-you']);
    expect(focus).toMatch(/outline-offset:\s*0/);
    expect(focus).toMatch(/z-index:\s*1/);
  });

  it('tell a selected row from a hovered one: a hand-colour bar, 3:1 on the drawer in both themes', () => {
    // A layer row's look is `.rowLook`, which the page rows share (item 13).
    expect(rulesFor(layersCss, '.row')).toMatch(/composes:\s*rowLook/);
    expect(rulesFor(layersCss, '.rowLook:hover')).toMatch(
      /background:\s*var\(--color-surface-raised\)/,
    );
    expect(rulesListing(layersCss, ".rowLook[aria-selected='true']")).toMatch(
      /background:\s*var\(--color-surface-pressed\)/,
    );
    const bar = rulesListing(layersCss, ".rowLook[aria-selected='true']::before");
    expect(bar).toMatch(/width:\s*2px/);
    expect(bar).toMatch(/background:\s*var\(--color-hand-you\)/);
    expect(rulesFor(drawerCss, '.drawer')).toMatch(/background:\s*var\(--color-surface-sheet\)/);
    for (const colors of [GRAPHITE_COLORS, VELLUM_COLORS]) {
      const drawer = colors['--color-surface-sheet'];
      expect(contrastOf(colors['--color-hand-you'], drawer)).toBeGreaterThanOrEqual(3);
      expect(colors['--color-surface-pressed']).not.toBe(colors['--color-surface-raised']);
    }
  });

  it('keep the skeleton still: no animation or transition', () => {
    for (const selector of ['.skeleton', '.skeletonRow']) {
      expect(rulesFor(layersCss, selector)).not.toMatch(/animation|transition/);
    }
    // Its bars are the shared Skeleton since UI-18, which is as still.
    expect(rulesFor(skeletonCss, '.skeleton')).not.toMatch(/animation|transition/);
  });

  // Item 4: the board's notices are toasts in the one region, whose home is over the
  // dock; it stays above the drawer wherever they meet (rewritten from the notices' stack).
  it('keep the board’s notices above the drawer, whose foot they overlap while it is open', () => {
    // Each takes its layer from the shell's stacking tokens (item 9).
    const zIndexOf = (css: string, selector: string) => {
      const token = /z-index:\s*var\((--layer-[a-z]+)\)/.exec(rulesFor(css, selector))?.[1];
      return Number(token === undefined ? Number.NaN : LAYER_TOKENS[token as LayerTokenName]);
    };
    expect(zIndexOf(toastRegionCss, '.home')).toBeGreaterThan(zIndexOf(drawerCss, '.drawer'));
  });

  it('size the drawer as the board-name bar: 261 px, 16 px in', () => {
    const drawer = rulesFor(drawerCss, '.drawer');
    expect(drawer).toMatch(/width:\s*261px/);
    // 16 px in: the shell's one inset, the zoom control's and the bars' too (item 10).
    expect(drawer).toMatch(/left:\s*dockInset;/);
    expect(dockCss).toMatch(/@value dockInset: var\(--space-4\);/);
  });
});
