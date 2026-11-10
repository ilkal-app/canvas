// Acceptance (Claude, from the PR 147 merge-queue run 37940053070): a family the page
// lays text out with is a family the page's font listeners have heard land. The text tool lays
// a family out as soon as `status` stops saying `loading` (`PAGE_TEXT_LAYOUT`), while the size
// follower writes the sizes left unmeasured only when the listeners run. Between the two, a
// family choice re-applied on Enter measures with the landed face and writes the stale size as
// a second person's change: one choice, two undo steps (text-edit.spec.ts, Enter: 7 change sets).
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';

const bytes = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
const source = { family: 'Example', weight: 400, isItalic: false, url: '/example.ttf' } as const;
const entry = { family: 'Example', category: 'sans', faces: [source] } as const;

describe('when a demanded family lands', () => {
  it('reports it ready no sooner than its listeners hear it', async () => {
    const fonts = new FontLibrary();
    // The content identity is hashed after the faces are installed; hold it, as a slow digest.
    let finishIdentity: (identity: string | undefined) => void = () => undefined;
    vi.spyOn(fonts, 'prepareContentIdentity').mockReturnValue(
      new Promise((resolve) => {
        finishIdentity = resolve;
      }),
    );
    const demand = new DemandFonts(fonts, [entry], () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    );
    const heard: string[] = [];
    demand.subscribe(() => heard.push(demand.status('Example')));

    const loading = demand.ensure('Example');
    // The face is in the library: the window in which the text tool can lay it out.
    await vi.waitFor(() => {
      expect(fonts.resolve(source)?.face.family).toBe('Example');
    });
    const isReadyUnheard = demand.status('Example') === 'ready' && !heard.includes('ready');
    expect(isReadyUnheard, 'ready before any listener heard it').toBe(false);

    finishIdentity('identity');
    expect(await loading).toBe(true);
    expect(demand.status('Example')).toBe('ready');
    expect(heard.at(-1)).toBe('ready');
  });
});
