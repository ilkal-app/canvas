import { describe, expect, it } from 'vitest';

import { THEMES } from './theme-tokens.js';

// Every component stylesheet in the package, as text.
const STYLESHEETS = import.meta.glob<string>('../**/*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const LITERAL_COLOR_PATTERN = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i;
// A font size, a `font` shorthand or a font family written out rather than taken from a text
// style token: `font: inherit` is allowed, a literal size or family is not.
const LITERAL_FONT_PATTERN =
  /\bfont-size:(?!\s*var\()|\bfont:(?!\s*(?:var\(|inherit\b))|\bfont-family:(?!\s*(?:var\(|inherit\b))/i;
// A weight heavier than Medium: the chrome's Rand is loaded in 400 and 500 only, and
// hierarchy comes from size and the secondary grey, never from bold.
const HEAVY_WEIGHT_PATTERN = /\bfont-weight:\s*(?:[6-9]00|bold(?:er)?)\b/i;
// A rule for a control (a button, field, select, toggle or swatch, by element or class name) and
// the border colour it sets. A control's edge must be seen: 3:1 against the surface, which only
// `--color-line-control` gives (item 3; `--color-line-hairline` is about 1.3:1).
const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const CONTROL_SELECTOR_PATTERN =
  /(?:^|[\s,>+~])(?:button|input|select|textarea)\b|\.(?:button|input|select|toggle|swatch|action|dismiss|close|number)\b/;
const CONTROL_BORDER_PATTERN =
  /\bborder(?:-(?:top|right|bottom|left))?(?:-color)?:[^;]*var\((--color-[a-z-]+)\)/g;
const TOKEN_REFERENCE_PATTERN = /var\((--[a-z0-9-]+)/gi;
// Keyboard focus (UI-18): the control states sheet's ring, 2 px of `--color-focus-ring`
// outside the control. Drawn inside (-2 px) only where the item sits in something that would clip
// a ring outside it (a menu's or a list's items, the buttons flush in a bar's edge), and flush
// (0) on a layer row, whose neighbours touch it and which rises above them.
const FOCUS_RING = 'outline: 2px solid var(--color-focus-ring)';
const FOCUS_OFFSET_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ['account/account-menu.module.css .item:focus-visible', '-2px'],
  ['collab/presence-share-bar.module.css .menuItem:focus-visible', '-2px'],
  ['collab/presence-share-bar.module.css .option:focus', '-2px'],
  ['context-menu/context-menu.module.css .item:focus-visible', '-2px'],
  ['controls/menu.module.css .item:focus-visible', '-2px'],
  ['editing/text-bar.module.css .listItem:focus-visible', '-2px'],
  ['panels/layers/layers.module.css .list:focus-visible', '-2px'],
  ['panels/layers/layers.module.css .row:focus-visible', '0'],
  ['shell/layers-drawer.module.css .close:focus-visible', '-2px'],
  ['shell/top-bars.module.css .iconButton:focus-visible', '-2px'],
  ['shell/top-bars.module.css .menuItem:focus-visible', '-2px'],
  ['site/board-bar.module.css .home:focus-visible, .rename:focus-visible', '-2px'],
  // The sign-in pages' fields and code boxes: one amber edge, the 2 px ring drawn inside the field
  // over its border, as the frames draw focus (A3's 2 px inside stroke; owner).
  ['site/email-sign-in.module.css .input:focus-visible', '-2px'],
  ['site/email-sign-in.module.css .digits .digit:focus-visible', '-2px'],
  // A site field's ring is drawn inside it over its 1 px border, so focus reads as one edge, as A3
  // draws it (owner).
  ['site/site.module.css .frame input:focus-visible', '-2px'],
  // Home's search and the New board dialog's template search: the same one edge (owner).
  [
    'site/home.module.css .search:has(.searchInput:focus-visible), .searchLarge:has(.searchInput:focus-visible)',
    '-2px',
  ],
  ['site/new-board-templates.module.css .search:has(.searchInput:focus-visible)', '-2px'],
  ['toolbar/dock.module.css .menuItem:focus-visible', '-2px'],
]);
// A disabled control (UI-18 item 2): when it is faded, it is to 38%.
const DISABLED_SELECTOR_PATTERN = /:disabled|\[aria-disabled='true'\]|\[data-disabled\]/;

describe('component stylesheets', () => {
  it('exist, so the checks below are not vacuous', () => {
    expect(Object.keys(STYLESHEETS).length).toBeGreaterThan(0);
  });

  it('use no literal colours, only theme tokens', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      expect(LITERAL_COLOR_PATTERN.exec(css)?.[0], path).toBeUndefined();
    }
  });

  it('set type only through text style and font tokens, never a literal size or family', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      expect(LITERAL_FONT_PATTERN.exec(css)?.[0], path).toBeUndefined();
    }
  });

  it('never set a weight heavier than Medium', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      expect(HEAVY_WEIGHT_PATTERN.exec(css)?.[0], path).toBeUndefined();
    }
  });

  it('give every bordered control the 3:1 control line, never the hairline', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector = '', body = ''] of withoutComments.matchAll(RULE_PATTERN)) {
        // A disabled control is exempt (WCAG 1.4.11) and is meant to look faint.
        if (!CONTROL_SELECTOR_PATTERN.test(selector.trim()) || selector.includes('disabled'))
          continue;
        for (const [, token] of body.matchAll(CONTROL_BORDER_PATTERN)) {
          expect(token, `${path} ${selector.trim()}`).not.toBe('--color-line-hairline');
        }
      }
    }
  });

  it('draw keyboard focus only as the shared ring: 2 px of the focus ring, 2 px outside', () => {
    let rings = 0;
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      for (const [, rawSelector = '', body = ''] of withoutComments.matchAll(RULE_PATTERN)) {
        const selector = rawSelector.trim().replaceAll(/\s+/g, ' ');
        if (!selector.includes(':focus')) continue;
        const where = `${path.replace(/^\.\.\//, '')} ${selector}`;
        expect(/box-shadow:[^;]*focus-ring/.exec(body)?.[0], where).toBeUndefined();
        const outline = /\boutline:\s*([^;]+);/.exec(body)?.[1]?.trim();
        if (outline === undefined || outline === 'none') continue;
        rings += 1;
        expect(`outline: ${outline}`, where).toBe(FOCUS_RING);
        const offset = /\boutline-offset:\s*([^;]+);/.exec(body)?.[1]?.trim();
        expect(offset, where).toBe(FOCUS_OFFSET_EXCEPTIONS.get(where) ?? '2px');
      }
    }
    expect(rings).toBeGreaterThan(20);
  });

  it('fade a disabled control to 38%, never another opacity', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector = '', body = ''] of withoutComments.matchAll(RULE_PATTERN)) {
        // A busy button takes no press but is not disabled: it keeps its look while it works.
        // A hover or press kept off a disabled control (`:not(:disabled)`) is not the disabled look.
        const own = selector.replaceAll(/:not\([^()]*\)/g, '');
        if (!DISABLED_SELECTOR_PATTERN.test(own) || own.includes('aria-busy')) continue;
        const opacity = /\bopacity:\s*([^;]+);/.exec(body)?.[1]?.trim();
        if (opacity === undefined) continue;
        expect(opacity, `${path} ${selector.trim()}`).toBe('0.38');
      }
    }
  });

  it('reference only tokens the themes define', () => {
    const defined = new Set(Object.keys(THEMES.light));
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      for (const [, name] of css.matchAll(TOKEN_REFERENCE_PATTERN)) {
        expect(defined.has(name ?? ''), `${path} uses ${name ?? ''}`).toBe(true);
      }
    }
  });
});
