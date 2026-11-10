// @vitest-environment jsdom
// Swipe-back off while a board is mounted: the hold on the document root and body,
// counted across nested shells, and the board's own scrolling regions. In Chrome:
// tooling/scenario/specs/app/no-swipe-back.spec.ts and specs/site/board-swipe-back.spec.ts.
import { cleanup, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import presenceCss from '../collab/presence-share-bar.module.css?raw';
import commentsCss from '../comments/comments.module.css?raw';
import contextMenuCss from '../context-menu/context-menu.module.css?raw';
import cheatSheetCss from '../dialogs/shortcut-cheat-sheet.module.css?raw';
import pagesCss from '../pages/pages-panel.module.css?raw';
import layersCss from '../panels/layers/layers.module.css?raw';
import stylePanelCss from '../panels/style-panel.module.css?raw';

import { holdNoSwipeBack, useNoSwipeBack } from './use-no-swipe-back.js';

afterEach(() => {
  cleanup();
  document.documentElement.style.overscrollBehaviorX = '';
  document.body.style.overscrollBehaviorX = '';
});

function rootValues(): readonly [string, string] {
  return [
    document.documentElement.style.overscrollBehaviorX,
    document.body.style.overscrollBehaviorX,
  ];
}

function Board({ children }: { readonly children?: ReactNode }): ReactElement {
  useNoSwipeBack();
  return <div>{children}</div>;
}

describe('holdNoSwipeBack', () => {
  it('sets none on the root and the body and puts back what was there', () => {
    document.documentElement.style.overscrollBehaviorX = 'contain';
    const release = holdNoSwipeBack(document);
    expect(rootValues()).toEqual(['none', 'none']);
    release();
    expect(rootValues()).toEqual(['contain', '']);
  });

  it('restores only when the last of two holds is released', () => {
    const first = holdNoSwipeBack(document);
    const second = holdNoSwipeBack(document);
    first();
    expect(rootValues()).toEqual(['none', 'none']);
    second();
    expect(rootValues()).toEqual(['', '']);
  });

  it('counts a release called twice once', () => {
    const first = holdNoSwipeBack(document);
    const second = holdNoSwipeBack(document);
    first();
    first();
    expect(rootValues()).toEqual(['none', 'none']);
    second();
    expect(rootValues()).toEqual(['', '']);
  });

  it('keeps each document to itself', () => {
    const other = document.implementation.createHTMLDocument('other');
    const release = holdNoSwipeBack(other);
    expect(other.documentElement.style.overscrollBehaviorX).toBe('none');
    expect(other.body.style.overscrollBehaviorX).toBe('none');
    expect(rootValues()).toEqual(['', '']);
    release();
    expect(other.documentElement.style.overscrollBehaviorX).toBe('');
  });

  it('holds on the root alone in a document without a body', () => {
    const other = document.implementation.createHTMLDocument('bodiless');
    other.body.remove();
    const release = holdNoSwipeBack(other);
    expect(other.documentElement.style.overscrollBehaviorX).toBe('none');
    release();
    expect(other.documentElement.style.overscrollBehaviorX).toBe('');
  });
});

describe('useNoSwipeBack', () => {
  it('holds from mount to unmount', () => {
    const { unmount } = render(<Board />);
    expect(rootValues()).toEqual(['none', 'none']);
    unmount();
    expect(rootValues()).toEqual(['', '']);
  });

  it('keeps the hold while a nested board unmounts first', () => {
    const { rerender, unmount } = render(
      <Board>
        <Board />
      </Board>,
    );
    rerender(<Board />);
    expect(rootValues()).toEqual(['none', 'none']);
    unmount();
    expect(rootValues()).toEqual(['', '']);
  });

  it('keeps the hold while one of two sibling boards unmounts', () => {
    const { rerender, unmount } = render(
      <>
        <Board key="a" />
        <Board key="b" />
      </>,
    );
    rerender(<Board key="b" />);
    expect(rootValues()).toEqual(['none', 'none']);
    unmount();
    expect(rootValues()).toEqual(['', '']);
  });
});

describe("the board's own scrolling regions", () => {
  it.each([
    ['the layers list', layersCss],
    ['the style panel', stylePanelCss],
    ['the pages list', pagesCss],
    ['the context menu', contextMenuCss],
    ['the collaborators listbox', presenceCss],
    ['the comments', commentsCss],
    ['the shortcut cheat sheet', cheatSheetCss],
  ])('%s does not chain a sideways overscroll to the page', (name, css) => {
    const scrolling = css.split('}').filter((rule) => /overflow(-y)?:\s*auto;/.test(rule));
    expect(scrolling.length, name).toBeGreaterThan(0);
    for (const rule of scrolling) expect(rule, name).toContain('overscroll-behavior-x: none;');
  });
});
