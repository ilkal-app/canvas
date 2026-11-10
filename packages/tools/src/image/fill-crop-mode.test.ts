import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import * as schema from '@canvas/schema';
import {
  type AssetId,
  type BoardObject,
  type FrameObject,
  type ImagePaint,
  type ObjectId,
  type ShapeObject,
} from '@canvas/schema';
import * as tools from '@canvas/tools';

import { frame, rect } from '../select/__fixtures__/select-board.js';
import { ADA, NOW } from '../select/__fixtures__/select-store.js';
import { boxPointToWorld, type OrientedBox } from '../select/oriented-box.js';

import type { CropMode, CropModeContext } from './crop-mode.js';

const imagePaintImageFrame = (
  schema as unknown as {
    imagePaintImageFrame: (
      paint: Pick<ImagePaint, 'fit' | 'crop' | 'naturalSize'>,
      box: { width: number; height: number },
    ) => { x: number; y: number; width: number; height: number };
  }
).imagePaintImageFrame;
const fillCropModeOf = (
  tools as unknown as {
    fillCropModeOf: (
      context: CropModeContext,
      object: ShapeObject | FrameObject,
      box: OrientedBox,
    ) => CropMode | undefined;
  }
).fillCropModeOf;

const PAINT: ImagePaint = {
  type: 'image',
  assetId: 'a'.repeat(64) as AssetId,
  naturalSize: { width: 400, height: 300 },
  fit: 'fill',
  crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
};
const BOX: OrientedBox = { x: 100, y: 200, width: 240, height: 160, rotation: Math.PI / 2 };

function setup(kind: 'shape' | 'frame', paint: ImagePaint = PAINT) {
  const object =
    kind === 'shape'
      ? { ...rect('target', null, BOX), fill: paint }
      : { ...frame('target', null, BOX), background: paint };
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    transaction.setObject(object);
  });
  const previews = new Map<ObjectId, BoardObject | undefined>();
  const drops: ObjectId[] = [];
  let captures = 0;
  let exits = 0;
  const context: CropModeContext = {
    store,
    origin: ADA,
    environment: { clock: () => NOW, createId: () => 'preview-id' as ObjectId },
    capture: {
      command: (run) => {
        captures += 1;
        run();
      },
    },
    setPreview: (id, preview) => {
      previews.set(id, preview);
      if (preview === undefined) drops.push(id);
    },
    onChange: () => undefined,
    requestExit: () => {
      exits += 1;
    },
  };
  const mode = fillCropModeOf(context, object, BOX);
  if (mode === undefined) throw new Error('Image fill should enter crop mode');
  return {
    object,
    store,
    previews,
    drops,
    mode,
    get captures() {
      return captures;
    },
    get exits() {
      return exits;
    },
  };
}

describe('fillCropModeOf', () => {
  it.each(['shape', 'frame'] as const)(
    'previews the %s and a separate whole image below it',
    (kind) => {
      const fixture = setup(kind);
      const { object, previews, mode } = fixture;
      expect(previews.get(object.id)).toMatchObject(object);
      const [image] = [...previews.entries()].filter(([id]) => id !== object.id);
      expect(image?.[1]).toMatchObject({
        type: 'shape',
        kind: 'rectangle',
        cornerRadius: 0,
        sides: 4,
        stroke: null,
        label: null,
        fill: { ...PAINT, fit: 'fill', crop: { x: 0, y: 0, width: 1, height: 1 } },
        rotation: BOX.rotation,
      });
      const imageObject = image?.[1];
      expect(imageObject?.type).toBe('shape');
      if (imageObject?.type === 'shape') {
        expect(imageObject.z < object.z).toBe(true);
        const local = imagePaintImageFrame(PAINT, BOX);
        const corner = boxPointToWorld(BOX, local);
        expect(imageObject.x).toBeCloseTo(corner.x, 9);
        expect(imageObject.y).toBeCloseTo(corner.y, 9);
        expect(imageObject.width).toBeCloseTo(local.width, 9);
        expect(imageObject.height).toBeCloseTo(local.height, 9);
      }
      expect(mode.crop).toEqual(PAINT.crop);
      expect(mode.overlay()).toMatchObject({ frame: undefined });
      expect(mode.overlay().toolRects?.length).toBeGreaterThan(0);
      mode.exit();
      expect(fixture.captures).toBe(0);
      expect(fixture.drops).toEqual(expect.arrayContaining([object.id, image?.[0]]));
    },
  );

  it.each(['shape', 'frame'] as const)(
    'commits one %s paint change without moving its box',
    (kind) => {
      const fixture = setup(kind);
      const { object, mode, previews, store } = fixture;
      mode.onKey({ kind: 'nudge', direction: 'left', isLarge: true });
      expect(mode.crop.width).toBeLessThan(PAINT.crop.width);
      const draft = mode.crop;
      const preview = previews.get(object.id);
      expect(preview).toMatchObject({
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        [kind === 'shape' ? 'fill' : 'background']: { ...PAINT, crop: draft },
      });
      expect(store.get(object.id)).toMatchObject({
        [kind === 'shape' ? 'fill' : 'background']: PAINT,
      });
      mode.onKey({ kind: 'enter' });
      expect(fixture.exits).toBe(1);
      mode.exit();
      expect(fixture.captures).toBe(1);
      expect(store.get(object.id)).toMatchObject({
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        [kind === 'shape' ? 'fill' : 'background']: { ...PAINT, crop: draft },
      });
      expect(fixture.drops).toHaveLength(2);
    },
  );

  it('drags a rotated fill crop handle within the image and previews only its paint', () => {
    const fixture = setup('shape');
    const full = imagePaintImageFrame(PAINT, BOX);
    const from = boxPointToWorld(BOX, {
      x: full.x + (PAINT.crop.x + PAINT.crop.width) * full.width,
      y: full.y + (PAINT.crop.y + PAINT.crop.height / 2) * full.height,
    });
    const to = boxPointToWorld(BOX, {
      x: full.x + (PAINT.crop.x + PAINT.crop.width) * full.width - 40,
      y: full.y + (PAINT.crop.y + PAINT.crop.height / 2) * full.height,
    });
    const input = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', world: typeof from) => ({
      kind,
      world,
      screen: world,
      zoom: 1,
      isShiftPressed: false,
      isModPressed: false,
      pointerType: 'mouse' as const,
    });
    fixture.mode.onPointer(input('pointerDown', from));
    fixture.mode.onPointer(input('pointerMove', to));
    fixture.mode.onPointer(input('pointerUp', to));
    expect(fixture.mode.crop.width).toBeLessThan(PAINT.crop.width);
    expect(fixture.mode.crop.x).toBeGreaterThanOrEqual(0);
    expect(fixture.mode.crop.x + fixture.mode.crop.width).toBeLessThanOrEqual(1);
    expect(fixture.previews.get(fixture.object.id)).toMatchObject({
      x: fixture.object.x,
      y: fixture.object.y,
      width: fixture.object.width,
      height: fixture.object.height,
      rotation: fixture.object.rotation,
      fill: { ...PAINT, crop: fixture.mode.crop },
    });
  });

  it('cancels on Escape and abandon without writing', () => {
    for (const cancel of ['escape', 'abandon'] as const) {
      const fixture = setup('shape');
      fixture.mode.onKey({ kind: 'nudge', direction: 'left', isLarge: false });
      if (cancel === 'escape') {
        fixture.mode.onKey({ kind: 'escape' });
        fixture.mode.exit();
      } else fixture.mode.abandon();
      expect(fixture.captures).toBe(0);
      expect(fixture.store.get(fixture.object.id)).toMatchObject({ fill: PAINT });
      expect(fixture.drops).toHaveLength(2);
    }
  });

  it('refuses locked objects and non-image paints', () => {
    const fixture = setup('shape');
    const context = {
      store: fixture.store,
      origin: ADA,
      environment: { clock: () => NOW, createId: () => 'unused' as ObjectId },
      setPreview: () => undefined,
      onChange: () => undefined,
      requestExit: () => undefined,
    };
    const shape = { ...rect('other', null, BOX), fill: PAINT };
    expect(fillCropModeOf(context, { ...shape, locked: true }, BOX)).toBeUndefined();
    expect(fillCropModeOf(context, { ...shape, fill: [1, 0, 0, 1] }, BOX)).toBeUndefined();
  });
});
