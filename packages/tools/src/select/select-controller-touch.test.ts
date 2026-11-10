import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { SelectControllerOptions } from './select-controller-options.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectIntent } from './select-intent.js';
import { LONG_PRESS_MS, type DoubleTapFit } from './touch-gestures.js';

// The select board (`select-board.ts`): rect-a is 100 × 50 at (0, 0); group-g at (0, 300) holds
// rect-d, 40 × 40 at (0, 300) on the board, and group-h, which holds rect-e at (60, 300).

function setUp(options: Partial<SelectControllerOptions> = {}) {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const menus: ScreenPoint[] = [];
  const fits: DoubleTapFit[] = [];
  const activated: SelectIntent[] = [];
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onContextMenu: (screen) => menus.push(screen),
    onDoubleTap: (fit) => fits.push(fit),
    onActivate: (intent) => activated.push(intent),
    ...options,
  });
  const finger = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    point: Point,
    timeStamp = 0,
  ) => {
    controller.handle(
      {
        kind,
        screen: point,
        world: point,
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'touch',
        timeStamp,
      },
      1,
    );
  };
  const tap = (point: Point, timeStamp: number) => {
    finger('pointerDown', point, timeStamp);
    finger('pointerUp', point, timeStamp + 50);
  };
  return { controller, changeSets, menus, fits, activated, finger, tap };
}

describe('SelectController: touch', () => {
  it('forwards empty-board pan deltas without changing selection, overlay or document', () => {
    const pans: [number, number][] = [];
    const panOptions = {
      onPan: (deltaXPx: number, deltaYPx: number) => pans.push([deltaXPx, deltaYPx]),
    };
    const { controller, changeSets, finger, tap } = setUp({
      ...panOptions,
      onDoubleTap: () => undefined,
    });
    tap({ x: 50, y: 25 }, 0);
    expect(controller.selection.ids).toEqual(['rect-a']);
    finger('pointerDown', { x: 300, y: 700 }, 1_000);
    finger('pointerMove', { x: 280, y: 685 }, 1_020);
    expect(controller.overlay().marquee).toBeUndefined();
    finger('pointerMove', { x: 250, y: 660 }, 1_040);
    finger('pointerUp', { x: 240, y: 650 }, 1_060);
    expect(pans).toEqual([
      [-20, -15],
      [-30, -25],
      [-10, -10],
    ]);
    expect(controller.selection.ids).toEqual(['rect-a']);
    expect(controller.overlay().marquee).toBeUndefined();
    expect(changeSets).toEqual([]);
  });

  it('cancels an empty-board pan without changing the selection', () => {
    const pans: [number, number][] = [];
    const panOptions = {
      onPan: (deltaXPx: number, deltaYPx: number) => pans.push([deltaXPx, deltaYPx]),
    };
    const { controller, changeSets, finger, tap } = setUp({
      ...panOptions,
      onDoubleTap: () => undefined,
    });
    tap({ x: 50, y: 25 }, 0);
    finger('pointerDown', { x: 300, y: 700 }, 1_000);
    finger('pointerMove', { x: 280, y: 680 }, 1_020);
    controller.handle({ kind: 'pointerCancel' }, 1);
    finger('pointerUp', { x: 280, y: 680 }, 1_040);
    expect(pans).toEqual([[-20, -20]]);
    expect(controller.selection.ids).toEqual(['rect-a']);
    expect(controller.overlay().marquee).toBeUndefined();
    expect(changeSets).toEqual([]);
  });
  it('opens the context menu on a long-press, with the pressed object selected', () => {
    const { controller, menus, finger, changeSets } = setUp();
    finger('pointerDown', { x: 50, y: 25 }, 1_000);
    controller.handle(
      { kind: 'hold', timeStamp: 1_000 + LONG_PRESS_MS, screen: { x: 50, y: 25 } },
      1,
    );
    expect(controller.selection.ids).toEqual(['rect-a']);
    expect(menus).toEqual([{ x: 50, y: 25 }]);
    finger('pointerUp', { x: 50, y: 25 }, 1_700);
    expect(controller.isGesturing).toBe(false);
    expect(changeSets).toEqual([]);
  });

  it('is at rest once the menu opens, so an entry runs while the finger is still down', () => {
    const { controller, finger, changeSets } = setUp();
    finger('pointerDown', { x: 50, y: 25 }, 1_000);
    controller.handle(
      { kind: 'hold', timeStamp: 1_000 + LONG_PRESS_MS, screen: { x: 50, y: 25 } },
      1,
    );
    expect(controller.isGesturing).toBe(false);
    controller.deleteSelection();
    expect(changeSets).toHaveLength(1);
    expect(controller.selection.ids).toEqual([]);
  });

  it('opens it on a secondary click too', () => {
    const { controller, menus } = setUp();
    controller.handle(
      {
        kind: 'contextPress',
        screen: { x: 450, y: 150 },
        world: { x: 450, y: 150 },
        isShiftPressed: false,
        isModPressed: false,
      },
      1,
    );
    expect(menus).toEqual([{ x: 450, y: 150 }]);
    expect(controller.selection.ids).toEqual([]);
  });

  it('zooms to an object with nothing to enter or edit when a finger taps it twice', () => {
    const { controller, fits, activated, tap } = setUp();
    tap({ x: 50, y: 25 }, 0);
    expect(fits).toEqual([]);
    tap({ x: 70, y: 25 }, 200);
    expect(fits).toEqual(['selection']);
    expect(activated).toEqual([]);
    expect(controller.selection.ids).toEqual(['rect-a']);
  });

  it('enters a group a finger taps twice, as a double click does, and zooms nowhere', () => {
    const { controller, fits, activated, tap } = setUp();
    tap({ x: 20, y: 320 }, 0);
    expect(controller.selection.ids).toEqual([id('group-g')]);
    tap({ x: 22, y: 321 }, 200);
    expect(controller.enteredGroupId).toBe(id('group-g'));
    expect(controller.selection.ids).toEqual([id('rect-d')]);
    expect(fits).toEqual([]);
    expect(activated).toEqual([]);
  });

  it('moves a group a finger taps then drags within 400 ms, entering nothing', () => {
    const { controller, changeSets, fits, finger, tap } = setUp();
    tap({ x: 20, y: 320 }, 0);
    finger('pointerDown', { x: 20, y: 320 }, 200);
    finger('pointerMove', { x: 30, y: 320 }, 220);
    finger('pointerMove', { x: 40, y: 320 }, 240);
    finger('pointerUp', { x: 40, y: 320 }, 260);
    expect(changeSets).toHaveLength(1);
    expect(controller.enteredGroupId).toBeNull();
    expect(controller.selection.ids).toEqual([id('group-g')]);
    expect(fits).toEqual([]);
  });

  it('fits the board when a finger taps a frame’s background twice', () => {
    const { controller, fits, tap } = setUp();
    tap({ x: 600, y: 150 }, 0);
    tap({ x: 605, y: 152 }, 200);
    expect(controller.selection.ids).toEqual([]);
    expect(fits).toEqual(['board']);
  });

  it('hands an object with a mode of its own to onActivate, and zooms nowhere', () => {
    const { fits, activated, tap } = setUp({ canActivate: (object) => object === id('rect-a') });
    tap({ x: 50, y: 25 }, 0);
    tap({ x: 50, y: 25 }, 200);
    expect(fits).toEqual([]);
    expect(activated).toEqual([
      { type: 'activate', id: id('rect-a'), world: { x: 50, y: 25 }, pointerType: 'touch' },
    ]);
  });

  it('keeps a mouse’s double click on a plain object going to onActivate', () => {
    const { controller, fits, activated } = setUp();
    const click = (timeStamp: number) => {
      for (const kind of ['pointerDown', 'pointerUp'] as const) {
        controller.handle(
          {
            kind,
            screen: { x: 50, y: 25 },
            world: { x: 50, y: 25 },
            isShiftPressed: false,
            isModPressed: false,
            timeStamp,
          },
          1,
        );
      }
    };
    click(0);
    click(200);
    expect(activated).toHaveLength(1);
    expect(fits).toEqual([]);
  });

  it('zooms to fit the board when a finger taps empty board twice', () => {
    const { controller, fits, tap } = setUp();
    tap({ x: 50, y: 25 }, 0);
    tap({ x: 300, y: 700 }, 1_000);
    expect(controller.selection.ids).toEqual([]);
    tap({ x: 310, y: 705 }, 1_200);
    expect(fits).toEqual(['board']);
  });

  it('does not pair taps too far apart in time', () => {
    const { fits, tap } = setUp();
    tap({ x: 50, y: 25 }, 0);
    tap({ x: 50, y: 25 }, 1_000);
    expect(fits).toEqual([]);
  });

  it('cancels a finger’s drag without writing when a second finger lands', () => {
    const { controller, changeSets, finger } = setUp();
    finger('pointerDown', { x: 50, y: 25 });
    finger('pointerMove', { x: 90, y: 25 });
    expect(controller.isGesturing).toBe(true);
    controller.handle({ kind: 'pointerCancel' }, 1);
    expect(controller.isGesturing).toBe(false);
    expect(changeSets).toEqual([]);
  });
});
