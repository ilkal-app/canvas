// @vitest-environment jsdom
// The floating sheet of the whiteboard's chrome: its shapes and the tokens it draws
// with. Geometry in a real browser is the scenario's (specs/app/floating-primitives.spec.ts).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FloatingSheet } from './floating-sheet.js';
import sheetCss from './floating-sheet.module.css?raw';

afterEach(cleanup);

/**
 * The CSS of the rules with exactly this selector, joined.
 *
 * @param selector - The selector.
 * @returns The rules' bodies.
 */
function rulesFor(selector: string): string {
  const withoutComments = sheetCss.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, own = '']) => own.trim() === selector)
    .map(([, , body = '']) => body)
    .join('\n');
}

describe('FloatingSheet', () => {
  it('is a toolbar-shaped sheet by default, with the role and name it is given', () => {
    render(
      <FloatingSheet role="toolbar" label="Sticky properties">
        <button type="button">Colour</button>
      </FloatingSheet>,
    );
    const sheet = screen.getByRole('toolbar', { name: 'Sticky properties' });
    expect(sheet.dataset.shape).toBe('toolbar');
    expect(sheet.dataset.floatingSheet).toBe('');
    expect(sheet.querySelector('button')?.textContent).toBe('Colour');
  });

  it('takes the bar and stack shapes, a class, a style and data attributes', () => {
    render(
      <>
        <FloatingSheet shape="bar" role="group" label="Board">
          Board
        </FloatingSheet>
        <FloatingSheet
          shape="stack"
          role="menu"
          label="Board menu"
          className="extra"
          style={{ left: '10px' }}
          dataAttributes={{ 'data-side': 'bottom' }}
        >
          Menu
        </FloatingSheet>
      </>,
    );
    expect(screen.getByRole('group', { name: 'Board' }).dataset.shape).toBe('bar');
    const menu = screen.getByRole('menu', { name: 'Board menu' });
    expect(menu.dataset.shape).toBe('stack');
    expect(menu.dataset.side).toBe('bottom');
    expect(menu.className).toContain('extra');
    expect(menu.style.left).toBe('10px');
  });

  it('draws the sheet surface, a hairline edge and the sheet shadow (Float/Light), from tokens', () => {
    const sheet = rulesFor('.sheet');
    expect(sheet).toContain('border: 1px solid var(--color-line-hairline)');
    expect(sheet).toContain('background: var(--color-surface-sheet)');
    expect(sheet).toContain('box-shadow: var(--shadow-sheet)');
    expect(sheet).toContain('box-sizing: border-box');
  });

  it('sizes each shape as the design does: 40 px toolbar, 44 px bar, 8 px and 6 px corners', () => {
    const toolbar = rulesFor(".sheet[data-shape='toolbar']");
    expect(toolbar).toContain('height: 40px');
    expect(toolbar).toContain('border-radius: 8px');
    const bar = rulesFor(".sheet[data-shape='bar']");
    expect(bar).toContain('height: 44px');
    expect(bar).toContain('border-radius: var(--radius-sheet)');
    const stack = rulesFor(".sheet[data-shape='stack']");
    expect(stack).toContain('flex-direction: column');
    expect(stack).toContain('gap: 2px');
    expect(stack).toContain('border-radius: 8px');
  });

  it('grows its bars to 48 px for a finger', () => {
    expect(sheetCss).toMatch(
      /@media \(pointer: coarse\) \{\s*\.sheet\[data-shape='toolbar'\],\s*\.sheet\[data-shape='bar'\] \{\s*height: 48px;/,
    );
  });
});
