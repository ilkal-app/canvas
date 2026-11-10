// The dock's offsets: the dock and the zoom control sit
// 16 px (`--space-4`) off the canvas's bottom and left edges, and the overlays placed above them
// take the dock's values from dock.module.css rather than repeating the sums, so a change to the
// margin or a height is one line there.
import { describe, expect, it } from 'vitest';

import commentsCss from '../comments/comments.module.css?raw';
import toastRegionCss from '../feedback/toast-region.module.css?raw';
import drawerCss from '../shell/layers-drawer.module.css?raw';

import dockCss from './dock.module.css?raw';

/**
 * The declarations of the rule whose selector is exactly the one given, comments and `@value`
 * statements dropped first.
 *
 * @param css - The stylesheet.
 * @param selector - The selector.
 * @returns Its declarations.
 */
function ruleOf(css: string, selector: string): string {
  const rules = css
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/@value\b[^;{}]*;/g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g);
  return [...rules].find(([, found = '']) => found.trim() === selector)?.[2] ?? '';
}

describe('the dock’s offsets', () => {
  it('put the dock and the zoom control 16 px off the bottom edge, the zoom control 16 px in', () => {
    expect(dockCss).toMatch(/@value dockInset: var\(--space-4\);/);
    expect(dockCss).toMatch(/@value dockTop: calc\(dockInset \+ 50px\);/);
    expect(dockCss).toMatch(/@value zoomTop: calc\(dockInset \+ 38px\);/);
    expect(ruleOf(dockCss, '.dock')).toMatch(/bottom: dockInset;/);
    expect(ruleOf(dockCss, '.zoom')).toMatch(/bottom: dockInset;\s*left: dockInset;/);
  });

  it('keep the overlays a step above the dock or the zoom control through those values', () => {
    // Item 4: the notice and the board's notices are toasts in the one region, whose
    // shell home sits a step above the dock until it measures the dock itself
    // (feedback/toast-placement.test.tsx); rewritten from the notice's and the notices' stack's.
    expect(toastRegionCss).toMatch(/@value dockTop from '\.\.\/toolbar\/dock\.module\.css';/);
    expect(ruleOf(toastRegionCss, ".home[data-toast-home='home']")).toMatch(
      /bottom: calc\(dockTop \+ var\(--space-3\)\);/,
    );
    // The comment card beside its pin keeps above the dock.
    expect(ruleOf(commentsCss, '.card')).toMatch(
      /max-height: calc\(100% - var\(--space-4\) \* 2 - 42px - dockTop - var\(--space-3\)\);/,
    );
    expect(ruleOf(drawerCss, '.drawer')).toMatch(/bottom: calc\(zoomTop \+ var\(--space-2\)\);/);
  });

  it('repeat neither the dock’s 50 px nor the zoom control’s 38 px in those overlays', () => {
    for (const css of [toastRegionCss, commentsCss, drawerCss]) {
      const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      expect(/\b(?:50|38)px\b/.exec(withoutComments)?.[0]).toBeUndefined();
    }
  });
});
