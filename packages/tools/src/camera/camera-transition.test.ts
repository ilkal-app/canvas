import { describe, expect, it } from 'vitest';

import { worldToScreen, type Camera } from '@canvas/engine';

import { CameraTransition, interpolateCamera } from './camera-transition.js';

const VIEW = { viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const FROM: Camera = { x: 0, y: 0, zoom: 1, ...VIEW };
const TO: Camera = { x: 1000, y: 500, zoom: 4, ...VIEW };

describe('interpolateCamera', () => {
  it('starts at the first camera and ends exactly at the second', () => {
    expect(interpolateCamera(FROM, TO, 0)).toEqual(FROM);
    expect(interpolateCamera(FROM, TO, 1)).toBe(TO);
  });

  it('interpolates the zoom geometrically and the viewport centre linearly', () => {
    const half = interpolateCamera(FROM, TO, 0.5);
    expect(half.zoom).toBeCloseTo(2, 12);
    // Centres: (400, 300) and (1100, 575); halfway (750, 437.5) sits at the viewport centre.
    const centre = worldToScreen(half, { x: 750, y: 437.5 });
    expect(centre.x).toBeCloseTo(400, 9);
    expect(centre.y).toBeCloseTo(300, 9);
  });
});

describe('CameraTransition', () => {
  it('follows the injected clock with an ease-in-out curve and finishes at the target', () => {
    let nowMs = 1000;
    const transition = new CameraTransition(FROM, TO, { durationMs: 200, clock: () => nowMs });
    expect(transition.sample()).toEqual(FROM);
    expect(transition.isFinished()).toBe(false);
    nowMs = 1100;
    // Ease-in-out is symmetric: halfway in time is halfway along.
    expect(transition.sample().zoom).toBeCloseTo(2, 12);
    nowMs = 1050;
    expect(transition.sample().zoom).toBeLessThan(Math.pow(4, 0.25));
    nowMs = 1200;
    expect(transition.sample()).toBe(TO);
    expect(transition.isFinished()).toBe(true);
    nowMs = 5000;
    expect(transition.sample()).toBe(TO);
  });

  it('jumps straight to the target when the duration is zero (reduced motion)', () => {
    const transition = new CameraTransition(FROM, TO, { durationMs: 0, clock: () => 0 });
    expect(transition.isFinished()).toBe(true);
    expect(transition.sample()).toBe(TO);
  });

  it('refuses a negative or non-finite duration', () => {
    expect(() => new CameraTransition(FROM, TO, { durationMs: -1, clock: () => 0 })).toThrow(
      RangeError,
    );
    expect(
      () => new CameraTransition(FROM, TO, { durationMs: Number.NaN, clock: () => 0 }),
    ).toThrow(RangeError);
  });
});
