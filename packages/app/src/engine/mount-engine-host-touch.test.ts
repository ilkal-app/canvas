// @vitest-environment jsdom
// The engine host mount's touch and context menu paths against a fake host. In Chrome, with real
// touch through the DevTools protocol: tooling/scenario/specs/tools/touch.spec.ts and
// specs/app/context-menu.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';
import { LONG_PRESS_MS } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { MARKER, mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { LOCAL_USER_ORIGIN } from './demo-document.js';
import type { ContextMenuRequest } from './mounted-engine.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** A text object in the fake host's empty board to the right of the marker, world units. */
const TOUCH_TEXT: TextObject = {
  id: 'touch-text' as ObjectId,
  type: 'text',
  parentId: null,
  x: 200,
  y: 100,
  rotation: 0,
  z: 'a9',
  locked: false,
  createdBy: LOCAL_USER_ORIGIN.principalId,
  createdAt: 1,
  updatedAt: 1,
  width: 80,
  height: 30,
  text: 'Tap me',
  runs: [{ length: 6, style: DEFAULT_TEXT_STYLE }],
  align: 'left',
  autoWidth: false,
  verticalAlign: 'top',
};

async function mountWithMenu() {
  const requests: ContextMenuRequest[] = [];
  const mounted = await mountOnFakeHost({
    isReducedMotion: true,
    options: { onContextMenu: (request) => requests.push(request) },
  });
  const finger = (type: string, x: number, y: number, pointerId = 7) =>
    mounted.canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: 'touch',
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  return { ...mounted, requests, finger };
}

describe('createEngineHostMount: touch and the context menu', () => {
  it('asks the shell for the menu on a right-click, with the object under it selected', async () => {
    const { canvas, engine, requests } = await mountWithMenu();
    canvas.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 60, clientY: 60, cancelable: true }),
    );
    expect(requests).toEqual([{ clientX: 60, clientY: 60 }]);
    expect(engine.inspect().selectedIds).toEqual([MARKER]);
  });

  it('asks for the menu when a finger is held in place, and writes nothing', async () => {
    const { engine, requests, finger } = await mountWithMenu();
    finger('pointerdown', 60, 60);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(requests).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(requests).toEqual([{ clientX: 60, clientY: 60, isTouch: true }]);
    finger('pointerup', 60, 60);
    expect(engine.inspect()).toMatchObject({ selectedIds: [MARKER], changeSets: [] });
  });

  it('edits the label of a shape a finger taps twice, the camera where it was', async () => {
    const { engine, finger } = await mountWithMenu();
    const camera = engine.camera();
    finger('pointerdown', 60, 60);
    finger('pointerup', 60, 60);
    finger('pointerdown', 62, 61);
    finger('pointerup', 62, 61);
    expect(engine.inspect().textEditing).toMatchObject({ id: MARKER });
    expect(engine.camera()).toEqual(camera);
  });

  it('zooms to fit an object a double-tap lands on that it cannot edit (a locked shape)', async () => {
    const { engine, finger } = await mountWithMenu();
    engine.runCanvasAction({ type: 'toggleLockOf', ids: [MARKER as ObjectId] });
    finger('pointerdown', 60, 60);
    finger('pointerup', 60, 60);
    finger('pointerdown', 62, 61);
    finger('pointerup', 62, 61);
    // The marker (70 × 60) fitted into the 400 × 200 viewport with the 48 px margin.
    expect(engine.camera().zoom).toBeCloseTo((200 - 2 * 48) / 60, 6);
  });

  it('edits a text object a finger taps twice, and leaves the camera where it was', async () => {
    const { engine, finger, loaders } = await mountWithMenu();
    loaders[0]?.([TOUCH_TEXT]);
    const camera = engine.camera();
    finger('pointerdown', 220, 110);
    finger('pointerup', 220, 110);
    finger('pointerdown', 222, 111);
    finger('pointerup', 222, 111);
    expect(engine.inspect().textEditing).toMatchObject({ id: TOUCH_TEXT.id, text: 'Tap me' });
    expect(engine.camera()).toEqual(camera);
  });

  it('zooms to fit the board when a finger taps empty board twice', async () => {
    const { engine, finger } = await mountWithMenu();
    finger('pointerdown', 15, 15);
    finger('pointerup', 15, 15);
    finger('pointerdown', 20, 18);
    finger('pointerup', 20, 18);
    expect(engine.inspect().selectedIds).toEqual([]);
    // The whole demo board, not the marker alone, fitted into the viewport.
    expect(engine.camera().zoom).toBeLessThan(1);
  });

  it('drops a finger’s drag without writing when a second finger lands', async () => {
    const { engine, finger } = await mountWithMenu();
    finger('pointerdown', 60, 60);
    finger('pointermove', 90, 80);
    finger('pointerdown', 150, 150, 8);
    finger('pointerup', 150, 150, 8);
    finger('pointerup', 90, 80);
    expect(engine.inspect().changeSets).toEqual([]);
  });
});
