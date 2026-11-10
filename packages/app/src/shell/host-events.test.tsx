// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ThemePreference } from '../theme/theme-preference.js';

import { useHostEvents } from './host-events.js';

afterEach(cleanup);

describe('useHostEvents', () => {
  it('tells the host each change of the selection and the theme, never the first', () => {
    const onSelectionChange = vi.fn();
    const onThemePreferenceChange = vi.fn();
    const first: readonly ObjectId[] = [];
    const picked: readonly ObjectId[] = ['a' as ObjectId];
    const hook = renderHook(
      ({ ids, theme }: { ids: readonly ObjectId[]; theme: ThemePreference }) => {
        useHostEvents({ onSelectionChange, onThemePreferenceChange }, ids, theme, undefined);
      },
      { initialProps: { ids: first, theme: 'system' as ThemePreference } },
    );
    hook.rerender({ ids: first, theme: 'system' });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onThemePreferenceChange).not.toHaveBeenCalled();
    hook.rerender({ ids: picked, theme: 'system' });
    hook.rerender({ ids: picked, theme: 'dark' });
    hook.rerender({ ids: first, theme: 'dark' });
    expect(onSelectionChange.mock.calls).toEqual([[picked], [first]]);
    expect(onThemePreferenceChange.mock.calls).toEqual([['dark']]);
  });

  it('calls the latest callbacks, and none when the host gives none', () => {
    const early = vi.fn();
    const late = vi.fn();
    const none: readonly ObjectId[] = [];
    const picked: readonly ObjectId[] = ['b' as ObjectId];
    interface Props {
      readonly callback: ((ids: readonly ObjectId[]) => void) | undefined;
      readonly ids: readonly ObjectId[];
    }
    const hook = renderHook<undefined, Props>(
      ({ callback, ids }) => {
        useHostEvents(
          callback === undefined ? {} : { onSelectionChange: callback },
          ids,
          'system',
          undefined,
        );
      },
      { initialProps: { callback: undefined, ids: picked } },
    );
    hook.rerender({ callback: undefined, ids: none });
    hook.rerender({ callback: early, ids: none });
    hook.rerender({ callback: late, ids: picked });
    expect(early).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledWith(['b']);
  });

  it('tells the host each time the engine has mounted, not while there is none', () => {
    const onEngineMount = vi.fn();
    const ids: readonly ObjectId[] = [];
    const hook = renderHook<undefined, { readonly engine: object | undefined }>(
      ({ engine }) => {
        useHostEvents({ onEngineMount }, ids, 'system', engine);
      },
      { initialProps: { engine: undefined } },
    );
    expect(onEngineMount).not.toHaveBeenCalled();
    hook.rerender({ engine: {} });
    expect(onEngineMount).toHaveBeenCalledOnce();
    hook.rerender({ engine: undefined });
    hook.rerender({ engine: {} });
    expect(onEngineMount).toHaveBeenCalledTimes(2);
  });
});
