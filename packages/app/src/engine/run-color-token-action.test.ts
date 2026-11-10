import { describe, expect, it, vi } from 'vitest';

import type { ColorMode, ObjectId, Rgba } from '@canvas/schema';

import type { ColorTokenAction } from '../state/color-token-action.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { runColorTokenAction } from './run-color-token-action.js';

/**
 * A demo board and the context the Board colours section's commands run in.
 *
 * @returns The store, the context and the refusal spy.
 */
function setUp() {
  const store = createDemoDocument();
  const onCommandRefused = vi.fn();
  let next = 0;
  const environment = {
    clock: () => 1_790_000_000_000,
    createId: () => {
      next += 1;
      return `token${String(next)}` as ObjectId;
    },
  };
  const context = { store, origin: LOCAL_USER_ORIGIN, environment, onCommandRefused };
  return { store, context, onCommandRefused };
}

describe('runColorTokenAction', () => {
  it('creates, recolours, renames and deletes a custom token, one change set each', () => {
    const { store, context, onCommandRefused } = setUp();
    const changes = vi.fn();
    store.subscribe(changes);
    const light = [1, 0, 0, 1] as const;
    const dark = [0, 0, 1, 1] as const;
    runColorTokenAction(context, {
      type: 'colorToken',
      command: 'set',
      name: 'Brand',
      light: [...light],
      dark: [...dark],
    });
    const [id] = [...store.readTokens().keys()];
    if (id === undefined) throw new Error('no token');
    expect(store.readTokens().get(id)).toMatchObject({ name: 'Brand', light, dark });
    const green = [0, 1, 0, 1] as const;
    runColorTokenAction(context, {
      type: 'colorToken',
      command: 'set',
      id,
      name: 'Brand',
      light: [...green],
      dark: [...dark],
    });
    expect(store.readTokens().get(id)?.light).toEqual(green);
    runColorTokenAction(context, { type: 'colorToken', command: 'rename', id, name: 'Logo' });
    expect(store.readTokens().get(id)?.name).toBe('Logo');
    runColorTokenAction(context, { type: 'colorToken', command: 'delete', id });
    expect(store.readTokens().has(id)).toBe(false);
    expect(changes).toHaveBeenCalledTimes(4);
    expect(onCommandRefused).not.toHaveBeenCalled();
  });

  it('edits a built-in and resets it to its defaults', () => {
    const { store, context } = setUp();
    runColorTokenAction(context, {
      type: 'colorToken',
      command: 'set',
      id: 'accent',
      name: 'accent',
      light: [1, 0, 0, 1],
      dark: [1, 0, 0, 1],
    });
    expect(store.readTokens().get('accent')?.builtin).toBe(true);
    runColorTokenAction(context, { type: 'colorToken', command: 'reset', id: 'accent' });
    expect(store.readTokens().has('accent')).toBe(false);
  });

  it('reports a refused command and writes nothing', () => {
    const { store, context, onCommandRefused } = setUp();
    runColorTokenAction(context, { type: 'colorToken', command: 'delete', id: 'accent' });
    expect(onCommandRefused).toHaveBeenCalledTimes(1);
    runColorTokenAction(context, {
      type: 'colorToken',
      command: 'set',
      name: 'ink',
      light: [0, 0, 0, 1],
      dark: [1, 1, 1, 1],
    });
    expect(onCommandRefused).toHaveBeenCalledTimes(2);
    expect(store.readTokens().size).toBe(0);
  });

  it('sets one mode, keeping the name and other value as they are when it runs', () => {
    const { store, context, onCommandRefused } = setUp();
    runColorTokenAction(context, {
      type: 'colorToken',
      command: 'set',
      name: 'Brand',
      light: [1, 0, 0, 1],
      dark: [0, 0, 1, 1],
    });
    const [id] = [...store.readTokens().keys()];
    if (id === undefined) throw new Error('no token');
    // Someone edits Light from a picker opened now (dark blue); meanwhile a collaborator renames
    // the token and makes Dark green. The Light edit keeps both.
    const setValue = (tokenId: string, mode: ColorMode, value: Rgba): ColorTokenAction => ({
      type: 'colorToken',
      command: 'setValue',
      id: tokenId,
      mode,
      value,
    });
    const edit = setValue(id, 'light', [1, 1, 0, 1]);
    runColorTokenAction(context, { type: 'colorToken', command: 'rename', id, name: 'Logo' });
    runColorTokenAction(context, setValue(id, 'dark', [0, 1, 0, 1]));
    runColorTokenAction(context, edit);
    expect(store.readTokens().get(id)).toMatchObject({
      name: 'Logo',
      light: [1, 1, 0, 1],
      dark: [0, 1, 0, 1],
    });
    runColorTokenAction(context, setValue('accent', 'light', [1, 0, 1, 1]));
    expect(store.readTokens().get('accent')).toMatchObject({
      name: 'accent',
      builtin: true,
      light: [1, 0, 1, 1],
    });
    expect(onCommandRefused).not.toHaveBeenCalled();
  });

  it('refuses one mode of a token a collaborator deleted, writing nothing', () => {
    const { store, context, onCommandRefused } = setUp();
    const changes = vi.fn();
    store.subscribe(changes);
    runColorTokenAction(context, {
      type: 'colorToken',
      command: 'setValue',
      id: 'gone',
      mode: 'dark',
      value: [0, 1, 0, 1],
    });
    expect(onCommandRefused).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ code: 'missing-token' }),
    ]);
    expect(changes).not.toHaveBeenCalled();
  });
});
