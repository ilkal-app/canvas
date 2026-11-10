// @vitest-environment jsdom
// The engine host mount for a person who cannot edit (a viewer), against a fake host:
// the mount's own canvas actions (duplicate) and the text panel are refused with the rest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { everyShellAction } from '../state/__fixtures__/every-shell-action.js';
import { isEditingAction } from '../state/editing-actions.js';
import type { CanvasAction } from '../state/shell-action.js';

import { MARKER, mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { createDemoDocument } from './demo-document.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/**
 * A mount on the demo document with everything selected, its document writes counted.
 *
 * @returns The mount and the count.
 */
async function mountViewer() {
  const store = createDemoDocument();
  const mounted = await mountOnFakeHost({ options: { store } });
  mounted.engine.runCanvasAction({ type: 'selection', command: 'selectAll' });
  const writes = { count: 0 };
  store.subscribeUpdates(() => {
    writes.count += 1;
  });
  mounted.engine.setEditable(false);
  return { ...mounted, store, writes };
}

describe('createEngineHostMount for a person who cannot edit', () => {
  it('runs no editing canvas action, duplicate included, and writes nothing', async () => {
    const { engine, writes } = await mountViewer();
    const editing = everyShellAction(MARKER as ObjectId).filter(
      (action): action is CanvasAction =>
        isEditingAction(action) && action.type !== 'selectTool' && action.type !== 'setToolStyle',
    );
    for (const action of editing) engine.runCanvasAction(action);
    expect(writes.count).toBe(0);
    expect(engine.inspect().selectedIds).toHaveLength(4);
  });

  it('pans with the arrows instead of nudging the selection', async () => {
    const { engine, writes } = await mountViewer();
    const before = engine.camera();
    engine.runCanvasAction({ type: 'nudge', direction: 'left', isLarge: true });
    expect(engine.camera().x).not.toBe(before.x);
    expect(writes.count).toBe(0);
  });

  it('drags nothing on the canvas, and restyles no text from the panel', async () => {
    const { engine, pointer, writes } = await mountViewer();
    pointer('pointerdown', 60, 60);
    pointer('pointermove', 90, 90);
    pointer('pointerup', 90, 90);
    engine.applyTextStyle?.({ kind: 'toggleBold' });
    expect(writes.count).toBe(0);
    expect(engine.inspect().selectedIds).toEqual([MARKER]);
  });

  it('duplicates again once the person can edit', async () => {
    const { engine, store, writes } = await mountViewer();
    const before = store.read().objects.size;
    engine.setEditable(true);
    engine.runCanvasAction({ type: 'selection', command: 'duplicate' });
    // The whole demo board is more than one part: it is written a part per task.
    await vi.waitFor(() => {
      expect(writes.count).toBeGreaterThan(0);
    });
    await store.whenIdle();
    expect(store.read().objects.size).toBe(before * 2);
  });
});
