// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDemoDocument } from '../engine/demo-document.js';

import { AppShell } from './app-shell.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';

afterEach(cleanup);

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

it('holds editing and shortcuts during hydration and keeps the same canvas when released', () => {
  const { mount, engines } = createFakeMount();
  const view = render(<AppShell mode="diagram" platform="mac" mountEngine={mount} isLoading />);
  const canvas = view.container.querySelector('canvas');
  const engine = engines[0];
  if (engine === undefined) throw new Error('Missing engine.');
  expect(engine.editable.at(-1)).toBe(false);
  fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
  expect(engine.actions).toEqual([]);
  view.rerender(<AppShell mode="diagram" platform="mac" mountEngine={mount} isLoading={false} />);
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(engines).toHaveLength(1);
  expect(engine.editable.at(-1)).toBe(true);
  fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
  expect(engine.actions).toContainEqual({ type: 'history', command: 'undo' });
});

it('keeps an authorized editor toolbar and sidebar layout while the engine remains inert', () => {
  const { mount, engines } = createFakeMount(undefined, createDemoDocument());
  const view = render(
    <AppShell
      mode="diagram"
      platform="mac"
      mountEngine={mount}
      isLoading
      hasEditingLayoutWhileLoading
    />,
  );
  expect(view.getByRole('button', { name: 'Sticky note (S)' })).toBeDefined();
  // With nothing selected the inspector drawer is closed, and while the board loads its
  // shortcut is off and it shows no toggle: a selection opens it.
  act(() => {
    engines[0]?.select(['section-0-rect-0-0' as ObjectId]);
  });
  expect(view.getByRole('complementary', { name: 'Style' })).toBeDefined();
  expect(engines[0]?.editable.at(-1)).toBe(false);
  fireEvent.click(view.getByRole('button', { name: 'Sticky note (S)' }));
  expect(engines[0]?.activeTools.at(-1)).toBe('select');
  fireEvent.keyDown(document.body, { key: 'Delete' });
  expect(engines[0]?.actions).toEqual([]);
  view.rerender(<AppShell mode="diagram" platform="mac" mountEngine={mount} isLoading={false} />);
  expect(view.getByRole('button', { name: 'Sticky note (S)' })).toBeDefined();
  expect(engines).toHaveLength(1);
});

it('keeps the viewer layout while a read-only board is loading', () => {
  const { mount, engines } = createFakeMount();
  const view = render(
    <AppShell mode="diagram" mountEngine={mount} isLoading hasEditingLayoutWhileLoading={false} />,
  );
  expect(view.queryByRole('button', { name: 'Sticky note (S)' })).toBeNull();
  expect(view.queryByRole('complementary', { name: 'Style' })).toBeNull();
  expect(engines[0]?.editable.at(-1)).toBe(false);
});
