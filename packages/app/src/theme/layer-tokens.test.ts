// The shell's stacking order (item 9): one set of layer tokens, in order, and the sheets
// that float over the canvas taking their layer from it, so a menu opened from the top bars or
// the dock always stacks above the drawers. In Chrome, with `elementFromPoint`:
// tooling/scenario/specs/app/top-bars.spec.ts.
import { describe, expect, it } from 'vitest';

import { LAYER_TOKENS, type LayerTokenName } from './layer-tokens.js';
import { THEMES } from './theme-tokens.js';

const STYLESHEETS = import.meta.glob<string>('../**/*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;

/** Each floating sheet's rule, by stylesheet and selector, and the layer it must take. */
const LAYERED_RULES: readonly (readonly [string, string, LayerTokenName])[] = [
  ['../shell/layers-drawer.module.css', '.drawer', '--layer-drawer'],
  ['../shell/drawer.module.css', '.slot', '--layer-drawer'],
  ['../comments/comments.module.css', '.panel', '--layer-drawer'],
  ['../toolbar/dock.module.css', '.dock', '--layer-controls'],
  ['../toolbar/dock.module.css', '.zoom', '--layer-controls'],
  ['../comments/comments.module.css', '.card', '--layer-controls'],
  ['../feedback/toast-region.module.css', '.home', '--layer-notice'],
  ['../shell/top-bars.module.css', '.topBars', '--layer-bars'],
  ['../shell/top-bars.module.css', '.progress', '--layer-bars'],
  ['../context-menu/context-menu.module.css', '.menu', '--layer-menu'],
  ['../dialogs/dialog.module.css', '.backdrop', '--layer-dialog'],
  ['../shell/layers-drawer.module.css', ".drawer:has([aria-modal='true'])", '--layer-dialog'],
  ['../shell/drawer.module.css', ".slot:has([aria-modal='true'])", '--layer-dialog'],
];

/**
 * The `z-index` a stylesheet's rule sets.
 *
 * @param path - The stylesheet.
 * @param selector - The rule's selector, its whitespace collapsed.
 * @returns The value, or undefined when no such rule sets one.
 */
function zIndexOf(path: string, selector: string): string | undefined {
  const css = (STYLESHEETS[path] ?? '').replaceAll(/\/\*[\s\S]*?\*\//g, '');
  for (const [, rawSelector = '', body = ''] of css.matchAll(RULE_PATTERN)) {
    // A rule after `@value` lines has them before its selector, up to their last `;`.
    const own = rawSelector.split(';').at(-1) ?? '';
    if (own.trim().replaceAll(/\s+/g, ' ') !== selector) continue;
    return /\bz-index:\s*([^;]+);/.exec(body)?.[1]?.trim();
  }
  return undefined;
}

describe('the layer tokens', () => {
  it('stack the drawers, the controls, the bars, the menus, the notices and the dialogs in order', () => {
    const order: readonly LayerTokenName[] = [
      '--layer-drawer',
      '--layer-controls',
      '--layer-bars',
      '--layer-menu',
      '--layer-notice',
      '--layer-dialog',
    ];
    expect(Object.keys(LAYER_TOKENS)).toEqual(order);
    const values = order.map((name) => Number(LAYER_TOKENS[name]));
    for (const value of values) expect(Number.isInteger(value)).toBe(true);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1] ?? Infinity);
    }
  });

  it('stay above what the canvas shows with its own small numbers (pins, trace sheets)', () => {
    expect(Number(LAYER_TOKENS['--layer-drawer'])).toBeGreaterThan(10);
  });

  it('are in both themes, the same', () => {
    for (const [name, value] of Object.entries(LAYER_TOKENS)) {
      expect(THEMES.dark[name as LayerTokenName]).toBe(value);
      expect(THEMES.light[name as LayerTokenName]).toBe(value);
    }
  });

  it.each(LAYERED_RULES)('%s %s takes its layer from %s', (path, selector, token) => {
    expect(zIndexOf(path, selector)).toBe(`var(${token})`);
  });
});
