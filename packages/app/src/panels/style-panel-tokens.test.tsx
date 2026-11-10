// @vitest-environment jsdom
// The style panel's colour tokens, with the shell's own sections: the colour controls
// show a token in the selection's effective colour mode, a token chosen is one style action, and a
// token fill made a gradient starts from its value in that mode. In Chrome:
// tooling/scenario/specs/app/color-tokens.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, TokenEntry, TokenTable } from '@canvas/schema';

import type { BoardViewSnapshot } from '../hooks/use-board-view-state.js';
import type { ShellAction } from '../state/shell-action.js';

import { memoryShape } from './__fixtures__/memory-board.js';
import { rgbaToHex } from './controls/colour-hex.js';
import { ColourTokensProvider } from './controls/colour-tokens-context.js';
import { createDefaultStylePanelRegistry } from './default-style-sections.js';
import { StylePanel } from './style-panel.js';

const REGISTRY = createDefaultStylePanelRegistry();

const BRAND: TokenEntry = {
  id: 'brand1',
  name: 'Brand',
  light: [1, 0, 0, 1],
  dark: [0, 0, 1, 1],
  builtin: false,
  createdBy: null,
  createdAt: 0,
};

const TABLE: TokenTable = new Map([['brand1', BRAND]]);

afterEach(cleanup);

/**
 * A dark frame holding a shape filled with the brand token.
 *
 * @returns The frame and the shape.
 */
function darkFrameWithShape(): readonly [BoardObject, BoardObject] {
  const frame = {
    ...memoryShape('f', 'a0'),
    type: 'frame',
    colorMode: 'dark',
  } as unknown as BoardObject;
  const shape = { ...memoryShape('s', 'a1', 'f'), fill: { token: 'brand1' } } as BoardObject;
  return [frame, shape];
}

/**
 * Renders the panel over a selection, the board holding `objects`, in a viewer theme.
 *
 * @param selection - The selected objects.
 * @param objects - Every object of the board.
 * @param theme - The viewer's theme.
 * @returns The dispatch spy.
 */
function renderPanel(
  selection: readonly BoardObject[],
  objects: readonly BoardObject[],
  theme: 'light' | 'dark' = 'light',
) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const byId = new Map(objects.map((object) => [object.id, object]));
  const reader = { get: (id: ObjectId) => byId.get(id) };
  const board = {
    documentVersion: 0,
    selectedIds: selection.map((object) => object.id),
    board: reader,
    definitions: reader,
  } as unknown as BoardViewSnapshot;
  render(
    <ColourTokensProvider value={{ table: TABLE, mode: theme }}>
      <StylePanel
        registry={REGISTRY}
        context="shape"
        board={board}
        selection={selection}
        activeTool="select"
        toolStyles={{}}
        dispatch={dispatch}
      />
    </ColourTokensProvider>,
  );
  return { dispatch };
}

describe('the style panel with colour tokens', () => {
  it('shows a token fill in the effective mode of the selection, over the viewer theme', () => {
    const [frame, shape] = darkFrameWithShape();
    renderPanel([shape], [frame, shape], 'light');
    expect(screen.getByLabelText<HTMLInputElement>('Fill').value).toBe(rgbaToHex(BRAND.dark));
    expect(screen.getByText('Brand')).toBeTruthy();
  });

  it('shows a token in the viewer theme when nothing sets a mode', () => {
    const shape = { ...memoryShape('s', 'a1'), fill: { token: 'brand1' } } as BoardObject;
    renderPanel([shape], [shape], 'dark');
    expect(screen.getByLabelText<HTMLInputElement>('Fill').value).toBe(rgbaToHex(BRAND.dark));
  });

  it('sets a token fill and a token stroke as one style action each', () => {
    const shape = memoryShape('s', 'a1');
    const { dispatch } = renderPanel([shape], [shape]);
    fireEvent.click(screen.getByRole('button', { name: 'Fill tokens' }));
    fireEvent.click(screen.getByRole('button', { name: 'Brand' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [{ id: 's', style: { fill: { token: 'brand1' } } }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stroke tokens' }));
    fireEvent.click(screen.getByRole('button', { name: 'border' }));
    const action = dispatch.mock.lastCall?.[0];
    expect(action?.type === 'style' && action.changes[0]?.style.stroke?.color).toEqual({
      token: 'border',
    });
  });

  it('starts a gradient made from a token fill at its value in the mode', () => {
    const [frame, shape] = darkFrameWithShape();
    const { dispatch } = renderPanel([shape], [frame, shape]);
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    const action = dispatch.mock.lastCall?.[0];
    const fill = action?.type === 'style' ? action.changes[0]?.style.fill : undefined;
    expect(fill).toMatchObject({ type: 'linear', stops: [{ offset: 0, color: BRAND.dark }, {}] });
  });
});
