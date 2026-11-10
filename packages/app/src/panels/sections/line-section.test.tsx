// @vitest-environment jsdom
// The style panel's line section in jsdom, as the panel mounts it: what it shows for lines, a
// mixed selection and the line tool's style, and that each committed choice is one `applyStyle`
// setting that field alone. In Chrome, over the real document: tooling/scenario/specs/tools/line.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, LineObject, ObjectId, PrincipalId } from '@canvas/schema';

import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';
import { patchFor, type StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './line-section.js';

/**
 * A line.
 *
 * @param id - Its id.
 * @param overrides - Fields to change.
 * @returns The line.
 */
function line(id: string, overrides: Partial<LineObject> = {}): LineObject {
  return {
    id: id as ObjectId,
    type: 'line',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 0,
    updatedAt: 0,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    route: 'straight',
    stroke: { color: [1, 0, 0, 1], width: 3 },
    startCap: 'none',
    endCap: 'arrow',
    ...overrides,
  };
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects; none for the line tool's style.
 * @param defaults - The line tool's style, with nothing selected.
 * @param activeTool - The active tool.
 * @param dispatch - Records changes to the next connector’s style.
 * @returns What `applyStyle` received.
 */
function renderSection(
  selection: readonly BoardObject[],
  defaults?: StylePanelSectionProps['defaults'],
  activeTool: StylePanelSectionProps['activeTool'] = 'select',
  dispatch: (action: ShellAction) => void = () => undefined,
) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const props = {
    context: 'line',
    selection,
    board: { get: () => undefined },
    defaults,
    activeTool,
    dispatch,
    applyStyle,
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return applyStyle;
}

/**
 * Commits a value the way the browser does: the input's value, then its `change` event.
 *
 * @param input - The input.
 * @param value - The value.
 */
function commit(input: HTMLElement, value: string): void {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The value of the field with a label.
 *
 * @param label - The label.
 * @returns The input's or select's value.
 */
function valueOf(label: string): string {
  const element = screen.getByLabelText(label);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? element.value
    : '';
}

/**
 * The route button pressed, by its name; none when none is.
 *
 * @returns The name.
 */
function pressedRoute(): string | null | undefined {
  const routes = within(screen.getByRole('group', { name: 'Route' })).getAllByRole('button');
  return routes
    .find((button) => button.getAttribute('aria-pressed') === 'true')
    ?.getAttribute('aria-label');
}

afterEach(cleanup);

describe('the line section', () => {
  it('registers for lines, connectors and the line tool', () => {
    expect(stylePanelSection).toMatchObject({ id: 'line', title: 'Line', context: 'line' });
  });

  it('shows a line’s stroke, caps and route', () => {
    renderSection([line('a')]);
    expect(valueOf('Width')).toBe('3');
    expect(valueOf('Start cap')).toBe('none');
    expect(valueOf('End cap')).toBe('arrow');
    expect(pressedRoute()).toBe('Route: straight');
  });

  it('sets one field per committed choice: a cap, the route', () => {
    const applyStyle = renderSection([line('a')]);
    fireEvent.change(screen.getByLabelText('End cap'), { target: { value: 'diamond' } });
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(applyStyle).toHaveBeenLastCalledWith({ endCap: 'diamond' });
    fireEvent.click(screen.getByRole('button', { name: 'Route: elbow' }));
    const lastRoute = applyStyle.mock.lastCall?.[0];
    expect(lastRoute && patchFor(lastRoute, line('a'))).toEqual({ route: 'elbow' });
  });

  it('sets a committed width on each line, keeping its own colour', () => {
    const blue = line('blue', { stroke: { color: [0, 0, 1, 1], width: 1 } });
    const applyStyle = renderSection([line('a'), blue]);
    commit(screen.getByLabelText('Width (mixed)'), '6.5');
    expect(applyStyle).toHaveBeenCalledTimes(1);
    const style = applyStyle.mock.lastCall?.[0];
    expect(style && patchFor(style, blue)).toEqual({ stroke: { color: [0, 0, 1, 1], width: 6.5 } });
    expect(style && patchFor(style, line('a'))).toEqual({
      stroke: { color: [1, 0, 0, 1], width: 6.5 },
    });
  });

  it('keeps each line’s own width when a colour is chosen for a mixed selection', () => {
    const thin = line('thin', { stroke: { color: [0, 0, 1, 1], width: 1 } });
    const applyStyle = renderSection([line('a'), thin]);
    expect(valueOf('Width (mixed)')).toBe('');
    commit(screen.getByLabelText('Stroke (mixed)'), '#00ff00');
    expect(applyStyle).toHaveBeenCalledTimes(1);
    const style = applyStyle.mock.lastCall?.[0];
    expect(style && patchFor(style, thin)).toEqual({ stroke: { color: [0, 1, 0, 1], width: 1 } });
    expect(style && patchFor(style, line('a'))).toEqual({
      stroke: { color: [0, 1, 0, 1], width: 3 },
    });
  });

  it('shows Mixed for caps the selection disagrees on', () => {
    renderSection([line('a'), line('b', { endCap: 'circle' })]);
    expect(screen.getByLabelText('End cap').textContent).toContain('Mixed');
  });

  it('shows and edits the line tool’s style with nothing selected', () => {
    const applyStyle = renderSection([], { endCap: 'arrow' });
    expect(valueOf('End cap')).toBe('arrow');
    expect(valueOf('Start cap')).toBe('none');
    fireEvent.change(screen.getByLabelText('Start cap'), { target: { value: 'circle' } });
    expect(applyStyle).toHaveBeenLastCalledWith({ startCap: 'circle' });
  });

  it('offers the connector tool’s style a curved route, and a line tool’s none', () => {
    const applyStyle = renderSection([], { route: 'straight', endCap: 'arrow' }, 'connector');
    fireEvent.click(screen.getByRole('button', { name: 'Route: curved' }));
    const chosen = applyStyle.mock.lastCall?.[0];
    expect(chosen && patchFor(chosen, undefined)).toEqual({ route: 'curved' });
    cleanup();
    renderSection([], { route: 'straight' }, 'line');
    const routes = within(screen.getByRole('group', { name: 'Route' })).getAllByRole('button');
    expect(routes.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Route: straight',
      'Route: elbow',
    ]);
  });

  it('curves a connector in a mixed selection and leaves its lines’ routes', () => {
    const connector = {
      ...line('k'),
      type: 'connector',
      from: { kind: 'point', x: 0, y: 0 },
      to: { kind: 'point', x: 10, y: 0 },
      label: null,
    } as unknown as BoardObject;
    const applyStyle = renderSection([line('a'), connector]);
    fireEvent.click(screen.getByRole('button', { name: 'Route: curved' }));
    const chosen = applyStyle.mock.lastCall?.[0];
    expect(chosen && patchFor(chosen, connector)).toEqual({ route: 'curved' });
    expect(chosen && patchFor(chosen, line('a'))).toEqual({});
  });
});

it.each(['straight', 'elbow', 'curved'] as const)(
  'remembers %s for the connector tool when a connector is selected',
  (route) => {
    const connector = {
      ...line('k'),
      type: 'connector',
      from: { kind: 'point', x: 0, y: 0 },
      to: { kind: 'point', x: 10, y: 0 },
      label: null,
    } as unknown as BoardObject;
    const dispatch = vi.fn();
    renderSection([connector], undefined, 'connector', dispatch);
    fireEvent.click(screen.getByRole('button', { name: `Route: ${route}` }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setToolStyle',
      tool: 'connector',
      style: { route },
    });
  },
);
