// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePatch } from '@canvas/document';
import { TOOL_IDS, type ToolId } from '@canvas/tools';

import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ToolStyles } from '../state/tool-style.js';

import { useEngineToolStyles } from './use-engine-tool-styles.js';

afterEach(cleanup);

function engineWith(
  setToolStyle: MountedEngine['setToolStyle'],
  setInkPicked: MountedEngine['setInkPicked'] = vi.fn(),
): MountedEngine {
  return { setToolStyle, setInkPicked } as unknown as MountedEngine;
}

interface Props {
  readonly engine: MountedEngine | undefined;
  readonly styles: ToolStyles;
  readonly picked?: Readonly<Partial<Record<ToolId, true>>>;
}

describe('useEngineToolStyles', () => {
  it("hands a new engine every tool's style, then only the ones that change", () => {
    const setToolStyle = vi.fn();
    const shape: StylePatch = { fill: null };
    const styles: ToolStyles = { shape };
    const first = engineWith(setToolStyle);
    const hook = renderHook<undefined, Props>(
      ({ engine, styles }: Props) => {
        useEngineToolStyles(engine, styles);
      },
      { initialProps: { engine: first, styles } },
    );
    expect(setToolStyle).toHaveBeenCalledTimes(TOOL_IDS.length);
    expect(setToolStyle).toHaveBeenCalledWith('shape', shape);
    expect(setToolStyle).toHaveBeenCalledWith('text', {});
    setToolStyle.mockClear();
    const next: StylePatch = { fill: [1, 0, 0, 1] };
    hook.rerender({ engine: first, styles: { shape: next } });
    expect(setToolStyle.mock.calls).toEqual([['shape', next]]);
    setToolStyle.mockClear();
    hook.rerender({ engine: engineWith(setToolStyle), styles: { shape: next } });
    expect(setToolStyle).toHaveBeenCalledTimes(TOOL_IDS.length);
  });

  it('does nothing until an engine mounts', () => {
    const hook = renderHook<undefined, Props>(
      ({ engine, styles }: Props) => {
        useEngineToolStyles(engine, styles);
      },
      { initialProps: { engine: undefined, styles: {} } },
    );
    const setToolStyle = vi.fn();
    hook.rerender({ engine: undefined, styles: { shape: {} } });
    hook.rerender({ engine: engineWith(setToolStyle), styles: {} });
    expect(setToolStyle).toHaveBeenCalledTimes(TOOL_IDS.length);
  });

  it('hands each tool whether its ink was picked, then only the picks that change', () => {
    const setInkPicked = vi.fn();
    const engine = engineWith(vi.fn(), setInkPicked);
    const styles: ToolStyles = {};
    const hook = renderHook<undefined, Props>(
      ({ engine, styles, picked }: Props) => {
        useEngineToolStyles(engine, styles, picked);
      },
      { initialProps: { engine, styles } },
    );
    expect(setInkPicked).toHaveBeenCalledTimes(TOOL_IDS.length);
    expect(setInkPicked).toHaveBeenCalledWith('line', false);
    setInkPicked.mockClear();
    hook.rerender({ engine, styles, picked: { line: true } });
    expect(setInkPicked.mock.calls).toEqual([['line', true]]);
    setInkPicked.mockClear();
    hook.rerender({ engine, styles, picked: {} });
    expect(setInkPicked.mock.calls).toEqual([['line', false]]);
  });
});
