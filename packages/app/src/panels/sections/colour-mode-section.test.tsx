// @vitest-environment jsdom
// The inspector's Colours section: Auto, Light or Dark for frames, mains and
// instances, one style change each. In Chrome: tooling/scenario/specs/app/color-tokens.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { StylePanelSectionProps } from '../panel-sections.js';
import type { StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './colour-mode-section.js';

afterEach(cleanup);

/**
 * A container with a colour mode, or none.
 *
 * @param type - Its type.
 * @param colorMode - Its mode.
 * @returns The object.
 */
function container(type: 'frame' | 'component' | 'instance', colorMode?: 'light' | 'dark') {
  return { id: `${type}1` as ObjectId, type, ...(colorMode && { colorMode }) } as BoardObject;
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects.
 * @returns The style spy.
 */
function renderSection(selection: readonly BoardObject[]) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const props = { context: 'frame', selection, applyStyle } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle };
}

/**
 * The pressed choices.
 *
 * @returns Their names.
 */
function pressed(): string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);
}

describe('the Colours section', () => {
  it('registers for frames, mains and instances, selection only', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'colour-mode',
      title: 'Colours',
      context: ['frame', 'component', 'instance'],
      isSelectionOnly: true,
    });
  });

  it('presses Auto for no mode, the mode set, and nothing when the selection differs', () => {
    renderSection([container('frame')]);
    expect(pressed()).toEqual(['Auto']);
    cleanup();
    renderSection([container('instance', 'dark')]);
    expect(pressed()).toEqual(['Dark']);
    cleanup();
    renderSection([container('frame', 'light'), container('component')]);
    expect(pressed()).toEqual([]);
  });

  it('sets the mode, and clears it for Auto, as one style change', () => {
    const { applyStyle } = renderSection([container('component', 'light')]);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(applyStyle).toHaveBeenLastCalledWith({ colorMode: 'dark' });
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(applyStyle).toHaveBeenLastCalledWith({ colorMode: null });
    expect(screen.getByRole('group', { name: 'Colour mode' })).toBeTruthy();
  });
});
