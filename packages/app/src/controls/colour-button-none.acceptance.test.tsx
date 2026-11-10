// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import '../toolbar/tool-panels/tool-panel-contribution.js';
import { toolPanel as shapes } from '../toolbar/tool-panels/shapes-panel.js';

import { ColourButton, type ColourGroup } from './colour-button.js';

const GROUPS: readonly ColourGroup[] = [
  {
    label: 'Colours',
    choices: [
      { value: 'none', label: 'None', swatch: 'transparent' },
      { value: 'red', label: 'Red', swatch: '#ff0000' },
    ],
  },
];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(value: 'none' | 'red', isMixed = false): HTMLElement {
  render(
    <ColourButton
      label="Fill"
      value={value}
      valueLabel={value === 'none' ? 'None' : 'Red'}
      swatch={value === 'none' ? 'transparent' : '#ff0000'}
      groups={GROUPS}
      isMixed={isMixed}
      onChange={vi.fn()}
    />,
  );
  return screen.getByRole('button', {
    name: `Fill: ${isMixed ? 'Mixed' : value === 'none' ? 'None' : 'Red'}`,
  });
}

function current(trigger: HTMLElement): HTMLElement {
  const swatch = trigger.querySelector('span');
  if (swatch === null) throw new Error('Trigger has no current-colour swatch');
  return swatch;
}

describe('transparent colour swatches', () => {
  it('marks only the transparent palette choice as None and leaves its inline background empty', () => {
    const trigger = mount('none');
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Fill colours' });
    const none = within(dialog).getByRole('button', { name: 'None' });
    const red = within(dialog).getByRole('button', { name: 'Red' });
    expect(none.hasAttribute('data-none')).toBe(true);
    expect(none.style.background).toBe('');
    expect(red.hasAttribute('data-none')).toBe(false);
    expect(red.style.background).toBe('rgb(255, 0, 0)');
  });

  it('marks an unmixed transparent trigger as None without an inline background', () => {
    const swatch = current(mount('none'));
    expect(swatch.hasAttribute('data-none')).toBe(true);
    expect(swatch.hasAttribute('data-mixed')).toBe(false);
    expect(swatch.style.background).toBe('');
    const mixed = current(mount('none', true));
    expect(mixed.hasAttribute('data-mixed')).toBe(true);
    expect(mixed.hasAttribute('data-none')).toBe(false);
    cleanup();
    const coloured = current(mount('red'));
    expect(coloured.hasAttribute('data-none')).toBe(false);
    expect(coloured.hasAttribute('data-mixed')).toBe(false);
    expect(coloured.style.background).toBe('rgb(255, 0, 0)');
  });

  it('draws both None swatches with a checkerboard made only of theme tokens', () => {
    const css = readFileSync('packages/app/src/controls/colour-button.module.css', 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const noneRules = rules.filter(([, selector = '']) => selector.includes('[data-none]'));
    for (const selector of ['.swatch[data-none]', '.current[data-none]']) {
      const rule =
        noneRules.find(
          ([, head = '']) =>
            head.includes(selector) &&
            head.includes('.swatch[data-none]') &&
            head.includes('.current[data-none]'),
        ) ?? noneRules.find(([, head = '']) => head.includes(selector));
      expect(rule, `Missing checkerboard rule for ${selector}`).toBeDefined();
      const body = rule?.[2] ?? '';
      expect(body).toContain('repeating-conic-gradient(');
      expect(body).toContain('var(--color-surface-sheet)');
      expect(body).toContain('var(--color-surface-pressed)');
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
    }
  });

  it('shows None in the shapes Fill trigger and its opened palette', () => {
    render(
      <shapes.contents
        choices={{ kind: 'rectangle', fill: null, stroke: 'ink' }}
        onChange={vi.fn()}
        registry={createFloatingShortcutRegistry('mac')}
        dispatch={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Fill: None' });
    expect(current(trigger).hasAttribute('data-none')).toBe(true);
    fireEvent.click(trigger);
    const none = within(screen.getByRole('dialog', { name: 'Fill colours' })).getByRole('button', {
      name: 'None',
    });
    expect(none.hasAttribute('data-none')).toBe(true);
    expect(none.style.background).toBe('');
  });
});
