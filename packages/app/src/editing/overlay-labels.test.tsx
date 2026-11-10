// @vitest-environment jsdom
// The editing labels in jsdom (Figma "States" E2): a pill per label at its anchor,
// following the camera. In Chrome: tooling/scenario/specs/app/editing-states.spec.ts.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LOCKED_LABEL_TEXT } from '@canvas/tools';

import { createCameraSource } from './camera-source.js';
import { OverlayLabelFeed } from './overlay-label-feed.js';
import { labelPositionOf, OverlayLabels } from './overlay-labels.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1440, viewportHeightPx: 900, dpr: 1 };

afterEach(cleanup);

describe('labelPositionOf', () => {
  it('puts a label at its anchor on screen', () => {
    const label = { kind: 'gap', text: '24', at: { x: 416, y: 184 }, axis: 'x' } as const;
    expect(labelPositionOf(label, CAMERA)).toEqual({ left: 416, top: 184 });
    expect(labelPositionOf(label, { ...CAMERA, x: 16, y: 84, zoom: 2 })).toEqual({
      left: 800,
      top: 200,
    });
  });
});

describe('OverlayLabels', () => {
  it('draws each label the overlay shows, and nothing without one', () => {
    const feed = new OverlayLabelFeed();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { container } = render(<OverlayLabels feed={feed} camera={camera} />);
    expect(container.innerHTML).toBe('');
    act(() => {
      feed.publish([
        { kind: 'size', text: '176 × 130', at: { x: 604, y: 258 } },
        { kind: 'gap', text: '24', at: { x: 416, y: 184 }, axis: 'x' },
        { kind: 'locked', text: LOCKED_LABEL_TEXT, at: { x: 428, y: 368 } },
      ]);
    });
    let size = container.querySelector<HTMLElement>('[data-label-kind="size"]');
    expect(size?.textContent).toBe('176 × 130');
    expect(size?.style.left).toBe('604px');
    expect(size?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(LOCKED_LABEL_TEXT);
    act(() => {
      feed.publish([
        { kind: 'extent', text: '168 × 100', at: { x: 304, y: 720 } },
        { kind: 'connect', text: 'Release to connect', at: { x: 676, y: 518 } },
      ]);
    });
    const kinds = [...container.querySelectorAll('[data-label-kind]')].map((pill) => [
      pill.getAttribute('data-label-kind'),
      pill.textContent,
      pill.getAttribute('aria-hidden'),
    ]);
    expect(kinds).toEqual([
      ['extent', '168 × 100', 'true'],
      ['connect', 'Release to connect', 'true'],
    ]);
    act(() => {
      feed.publish([
        { kind: 'size', text: '176 × 130', at: { x: 604, y: 258 } },
        { kind: 'gap', text: '24', at: { x: 416, y: 184 }, axis: 'x' },
      ]);
    });
    size = container.querySelector<HTMLElement>('[data-label-kind="size"]');
    act(() => {
      camera.write({ ...CAMERA, x: 4 });
    });
    expect(size?.style.left).toBe('600px');
    act(() => {
      feed.publish(undefined);
    });
    expect(container.innerHTML).toBe('');
  });
});
