// The Pages and Layers sections of the layers drawer match (item 13): the page list's
// header, heading, action button and rows take the layers panel's and the drawer's own rules,
// composed rather than copied, so the two cannot drift apart.
import { describe, expect, it } from 'vitest';

import { LAYER_ROW_HEIGHT_PX } from '../panels/layers/layer-row-item.js';
import layersCss from '../panels/layers/layers.module.css?raw';

import pagesCss from './pages-panel.module.css?raw';

/**
 * The declarations of the rule whose selector is exactly the one given.
 *
 * @param css - The stylesheet.
 * @param selector - The selector.
 * @returns Its declarations; empty when there is none.
 */
function ruleOf(css: string, selector: string): string {
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  for (const [, found = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (found.trim() === selector) return body;
  }
  return '';
}

describe('the page list’s styles', () => {
  it.each([
    ['.header', "header from '../panels/layers/layers.module.css'"],
    ['.heading', "heading from '../panels/layers/layers.module.css'"],
    ['.add', "close from '../shell/layers-drawer.module.css'"],
    ['.row', "rowLook from '../panels/layers/layers.module.css'"],
  ])('compose %s from the layers section’s own rule', (selector, composed) => {
    expect(ruleOf(pagesCss, selector)).toContain(`composes: ${composed};`);
  });

  it('give a page row a layer row’s height, and set no type of their own on it', () => {
    expect(ruleOf(pagesCss, '.row')).toContain(`height: ${String(LAYER_ROW_HEIGHT_PX)}px;`);
    expect(ruleOf(pagesCss, '.row')).not.toMatch(/\bfont\b/);
    expect(ruleOf(pagesCss, '.heading')).not.toMatch(/\bfont\b/);
  });

  it('mark the page shown as a selected layer row is marked', () => {
    expect(layersCss).toMatch(
      /\.rowLook\[aria-selected='true'\],\s*\.rowLook\[aria-current='page'\]/,
    );
    expect(ruleOf(layersCss, '.rowLook')).toContain('font: var(--text-body);');
  });
});
