// @vitest-environment jsdom
// The line tool's default colour through the engine host mount: the creator's picks and theme reach the line tool (`lineToolContextOf`), and
// `ink` the person picked is kept over a filled object, where the default contrasts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('createEngineHostMount: theme and ink', () => {
  it('tells the host the viewer’s theme from the start and on each change, never the document', async () => {
    const { host, engine } = await mountOnFakeHost();
    expect(host.themes).toEqual(['light']);
    const before = engine.inspect().changeSets.length;
    engine.setTheme('dark');
    engine.setTheme('dark');
    engine.setTheme('light');
    expect(host.themes).toEqual(['light', 'dark', 'light']);
    expect(engine.inspect().changeSets).toHaveLength(before);
  });

  it('keeps a line’s picked ink over a filled object, and contrasts once the pick is cleared', async () => {
    const { engine, pointer } = await mountOnFakeHost();
    const drawLine = () => {
      pointer('pointerdown', 60, 60);
      pointer('pointermove', 150, 150);
      pointer('pointerup', 150, 150);
      const [line] = engine.inspect().selectedObjects;
      return line?.type === 'line' ? line.stroke.color : undefined;
    };
    engine.setActiveTool('line');
    engine.setToolStyle('line', { stroke: { color: 'ink', width: 2 } });
    engine.setInkPicked('line', true);
    expect(drawLine()).toBe('ink');
    engine.setActiveTool('line');
    engine.setInkPicked('line', false);
    expect(drawLine()).not.toBe('ink');
  });
});
