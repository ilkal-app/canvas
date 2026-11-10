// @vitest-environment jsdom
// The engine host mount's text input before its host starts: a note a click makes while the host
// is loading takes the keyboard at once. In Chrome on software rendering, where the host starts
// slowly: tooling/scenario/specs/tools/sticky.spec.ts, under the pre-merge run.
import { afterEach, expect, it, vi } from 'vitest';

import { VIEWPORT } from './__fixtures__/fake-engine-host.js';
import { createEngineHostMount } from './mount-engine-host.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('gives a note made while the host is still starting the keyboard', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const mount = createEngineHostMount({
    prefer: 'worker',
    startHost: () => new Promise<never>(() => undefined),
  });
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { setPointerCapture: () => undefined });
  document.body.append(canvas);
  const engine = mount(canvas, { viewport: VIEWPORT });
  engine.setActiveTool('sticky');
  for (const type of ['pointerdown', 'pointerup'])
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, button: 0, clientX: 300, clientY: 150 }),
    );
  expect(engine.inspect().textEditing).toMatchObject({ text: '' });
  // Keys typed now reach the note, not the tool shortcuts (h is the hand tool).
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Text editor');
  engine.destroy();
  expect(document.querySelector('textarea')).toBeNull();
});
