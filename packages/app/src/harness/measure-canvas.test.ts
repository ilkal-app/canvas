// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { measureCanvas } from './measure-canvas.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('measureCanvas', () => {
  it('reports the CSS box, its position, the drawing buffer and the device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 12, y: 48, width: 320, height: 200 }),
    );
    expect(measureCanvas(canvas)).toEqual({
      cssWidthPx: 320,
      cssHeightPx: 200,
      cssLeftPx: 12,
      cssTopPx: 48,
      widthPx: 640,
      heightPx: 400,
      dpr: 2,
    });
  });

  it("reports the engine's drawing buffer and ratio, where the engine runs, when it has drawn", () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = document.createElement('canvas');
    // A canvas handed to a worker keeps its hand-over size on the page.
    canvas.width = 300;
    canvas.height = 150;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 320, height: 200 }),
    );
    expect(measureCanvas(canvas, { widthPx: 640, heightPx: 400, dpr: 2 })).toMatchObject({
      cssWidthPx: 320,
      widthPx: 640,
      heightPx: 400,
      dpr: 2,
    });
  });
});
