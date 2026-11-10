// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// The shell's panels wired to the engine's board view: the style panel follows the selection
// and hands restyles to the engine, the layers panel selects, refusals show a notice. In Chrome:
// tooling/scenario/specs/app/style-panel.spec.ts and layers-panel.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDemoDocument } from '../engine/demo-document.js';
import { createStylePanelRegistry, registerStylePanelSection } from '../panels/panel-sections.js';

import { openLayersDrawer } from './__fixtures__/layers-drawer-steps.js';
import { AppShell } from './app-shell.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';

const MARKER = 'section-0-rect-0-0' as ObjectId;

afterEach(cleanup);

function renderShell(options: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const store = createDemoDocument();
  const { mount, engines } = createFakeMount(undefined, store);
  render(<AppShell mode="diagram" platform="mac" mountEngine={mount} {...options} />);
  const engine = engines[0];
  if (engine === undefined) throw new Error('the shell mounted no engine');
  return { engine, store };
}

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

describe('AppShell panels', () => {
  it('shows the style panel for the selection and hands a restyle to the engine', () => {
    const { engine } = renderShell();
    // With nothing selected the inspector drawer is closed: alt+8 opens it (its toggle
    // shows only while it is open), and it stays open, the same panel, as the selection
    // changes.
    fireEvent.keyDown(document.body, { key: '8', code: 'Digit8', altKey: true });
    const style = screen.getByRole('complementary', { name: 'Style' });
    expect(style.getAttribute('data-context')).toBe('none');
    act(() => {
      engine.select([MARKER]);
    });
    expect(style.getAttribute('data-context')).toBe('shape');
    const fill = screen.getByLabelText('Fill');
    (fill as HTMLInputElement).value = '#00ff00';
    act(() => {
      fill.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(engine.actions).toEqual([
      { type: 'style', changes: [{ id: MARKER, style: { fill: [0, 1, 0, 1] } }] },
    ]);
  });

  it('lists the board in the layers panel and selects from it', () => {
    const { engine } = renderShell();
    // In the layers drawer since, closed at first.
    openLayersDrawer();
    expect(screen.getByRole('complementary', { name: 'Layers' })).toBeInstanceOf(HTMLElement);
    act(() => {
      fireEvent.click(screen.getByRole('treeitem', { name: 'Section 2' }));
    });
    expect(engine.selectedIds).toEqual(['section-1']);
    expect(screen.getByRole('complementary', { name: 'Style' }).getAttribute('data-context')).toBe(
      'frame',
    );
  });

  it('shows a refused command in its one notice, until dismissed', () => {
    const { engine } = renderShell();
    act(() => {
      engine.options.onNotice?.('That change could not be made: the object is locked.');
    });
    expect(screen.getAllByRole('status', { name: 'Notice' })).toHaveLength(1);
    expect(screen.getByRole('status', { name: 'Notice' }).textContent).toContain(
      'That change could not be made: the object is locked.',
    );
    // The shared Toast's Dismiss names what it dismisses (item 4).
    fireEvent.click(
      screen.getByRole('button', { name: /^Dismiss: That change could not be made/ }),
    );
    expect(screen.queryByText(/could not be made/)).toBeNull();
  });

  it("shows the engine's other notices, and hands it each creation tool's style", () => {
    const { engine } = renderShell();
    act(() => {
      engine.options.onNotice?.('1 object was left where it was.');
    });
    expect(screen.getByRole('status', { name: 'Notice' }).textContent).toContain(
      '1 object was left where it was.',
    );
    expect(engine.toolStyles.map(([tool]) => tool)).toContain('shape');
  });

  it('shows the sections it is given instead of the defaults', () => {
    const sections = registerStylePanelSection(createStylePanelRegistry(), {
      id: 'probe',
      title: 'Probe',
      context: 'shape',
      order: 1,
      render: () => <p>Probe section</p>,
    });
    const { engine } = renderShell({ stylePanelSections: sections });
    act(() => {
      engine.select([MARKER]);
    });
    expect(screen.getByText('Probe section')).toBeInstanceOf(HTMLElement);
    expect(screen.queryByRole('region', { name: 'Arrange' })).toBeNull();
  });
});
