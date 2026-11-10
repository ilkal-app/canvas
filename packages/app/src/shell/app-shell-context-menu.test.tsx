// @vitest-environment jsdom
// Right-click and long-press on the real canvas: tooling/scenario/specs/app/context-menu.spec.ts
// and tooling/scenario/specs/tools/touch.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import {
  createFakeMount,
  type FakeMountedEngine,
} from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';

function renderShell(): FakeMountedEngine {
  const { mount, engines } = createFakeMount();
  render(<AppShell platform="mac" mountEngine={mount} />);
  const [engine] = engines;
  if (engine === undefined) throw new Error('The shell mounted no engine');
  return engine;
}

function openMenuAt(engine: FakeMountedEngine, clientX: number, clientY: number): void {
  act(() => {
    engine.options.onContextMenu?.({ clientX, clientY });
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('AppShell: context menu', () => {
  it('opens where the canvas asks, offering what applies to the engine’s selection', () => {
    const engine = renderShell();
    engine.inspection = {
      selectedIds: [],
      selectedObjects: [{ type: 'group' }, { type: 'shape' }] as unknown as BoardObject[],
      changeSets: [],
      enteredGroupId: null,
    };
    openMenuAt(engine, 120, 90);
    const menu = screen.getByRole('menu', { name: 'Canvas' });
    expect(menu.style.left).toBe('120px');
    expect(screen.getByRole('menuitem', { name: /^Ungroup/ })).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('menuitem', { name: /^Align left/ })).toBeInstanceOf(HTMLElement);
  });

  it('offers paste on empty canvas', () => {
    const engine = renderShell();
    openMenuAt(engine, 10, 10);
    expect(screen.getAllByRole('menuitem').map((item) => item.firstChild?.textContent)).toEqual([
      'Select all',
      'Paste',
    ]);
  });

  it('runs a chosen entry as its shortcut would, then closes', () => {
    const engine = renderShell();
    engine.inspection = {
      selectedIds: [],
      selectedObjects: [{ type: 'shape' }] as unknown as BoardObject[],
      changeSets: [],
      enteredGroupId: null,
    };
    openMenuAt(engine, 10, 10);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete/ }));
    expect(engine.actions).toEqual([{ type: 'selection', command: 'delete' }]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape without deselecting', () => {
    const engine = renderShell();
    openMenuAt(engine, 10, 10);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(engine.actions).toEqual([]);
  });
});
