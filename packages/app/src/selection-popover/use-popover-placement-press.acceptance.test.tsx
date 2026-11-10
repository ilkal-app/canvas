// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';

import { usePopoverPlacement } from './use-popover-placement.js';

const SHAPE = {
  id: 'shape' as ObjectId,
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 300,
  y: 250,
  z: 'a0',
  type: 'shape',
  kind: 'rectangle',
  width: 100,
  height: 50,
  stroke: null,
  fill: [1, 0, 0, 1],
  cornerRadius: 0,
  sides: 4,
  label: null,
} as BoardObject;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
const IDS = [SHAPE.id];
const SOURCE = createCameraSource();
const STORE = new YjsDocumentStore({ clientId: 672 });
STORE.transact(SYSTEM_ORIGIN, (transaction) => {
  transaction.setObject(SHAPE);
});
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function flushFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const engine = useRef(
    new FakeMountedEngine(document.createElement('canvas'), { store: STORE }, Promise.resolve()),
  );
  engine.current.currentCamera = CAMERA;
  usePopoverPlacement(ref, engine.current, SOURCE, IDS);
  return (
    <main>
      <canvas data-testid="canvas" />
      <div ref={ref} data-testid="sheet" data-hidden="" />
    </main>
  );
}

describe('popover placement during canvas presses', () => {
  it('keeps a shown sheet visible through a click and moves of at most four pixels', () => {
    render(<Harness />);
    flushFrames();
    const sheet = screen.getByTestId('sheet');
    const canvas = screen.getByTestId('canvas');
    expect(sheet.hasAttribute('data-hidden')).toBe(false);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 30, pointerId: 1 });
    expect(sheet.hasAttribute('data-hidden')).toBe(false);
    fireEvent.pointerMove(canvas, { clientX: 24, clientY: 30, pointerId: 1 });
    expect(sheet.hasAttribute('data-hidden')).toBe(false);
    fireEvent.pointerUp(window, { clientX: 24, clientY: 30, pointerId: 1 });
    flushFrames();
    expect(sheet.hasAttribute('data-hidden')).toBe(false);
  });

  it('hides after crossing four pixels and reappears on the next frame after release', () => {
    render(<Harness />);
    flushFrames();
    const sheet = screen.getByTestId('sheet');
    const canvas = screen.getByTestId('canvas');
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 30, pointerId: 1 });
    expect(sheet.hasAttribute('data-hidden')).toBe(false);
    fireEvent.pointerMove(canvas, { clientX: 25, clientY: 30, pointerId: 1 });
    expect(sheet.hasAttribute('data-hidden')).toBe(true);
    fireEvent.pointerUp(window, { clientX: 25, clientY: 30, pointerId: 1 });
    expect(sheet.hasAttribute('data-hidden')).toBe(true);
    flushFrames();
    expect(sheet.hasAttribute('data-hidden')).toBe(false);
  });
});
