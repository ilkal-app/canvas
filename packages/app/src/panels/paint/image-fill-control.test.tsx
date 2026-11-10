// @vitest-environment jsdom
// Image fills in the style panel (PR 3): the paint control's Image kind on selected
// shapes and frames, its fits and "Replace image…", with the shell's own sections: each
// committed edit is one style action. In Chrome: tooling/scenario/specs/app/image-fill.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, BoardObject, ImagePaint, ObjectId, Rgba } from '@canvas/schema';

import type { ReplacementAsset } from '../../assets/page-images.js';
import type { BoardViewSnapshot } from '../../hooks/use-board-view-state.js';
import type { ShellAction } from '../../state/shell-action.js';
import { memoryShape } from '../__fixtures__/memory-board.js';
import { createDefaultStylePanelRegistry } from '../default-style-sections.js';
import { ImageReplacementProvider, type ImageReplacer } from '../image-replacement-context.js';
import type { SelectionContext } from '../panel-sections.js';
import { StylePanel } from '../style-panel.js';

const REGISTRY = createDefaultStylePanelRegistry();
const RED: Rgba = [230 / 255, 57 / 255, 70 / 255, 1];
const WHOLE = { x: 0, y: 0, width: 1, height: 1 };
const PHOTO: ImagePaint = {
  type: 'image',
  assetId: 'asset-photo' as AssetId,
  naturalSize: { width: 1600, height: 900 },
  fit: 'tile',
  crop: WHOLE,
};
const CHOSEN: ReplacementAsset = {
  assetId: 'asset-chosen' as AssetId,
  naturalSize: { width: 400, height: 300 },
};

afterEach(cleanup);

function shape(id: string, fields: Record<string, unknown> = {}): BoardObject {
  return { ...memoryShape(id, 'a0'), ...fields };
}

function frame(id: string, background: unknown): BoardObject {
  return {
    ...memoryShape(id, 'a0'),
    type: 'frame',
    name: 'Frame',
    clip: false,
    background,
  } as unknown as BoardObject;
}

interface PanelOptions {
  readonly context: SelectionContext;
  readonly selection?: readonly BoardObject[];
  readonly replacer?: ImageReplacer | undefined;
}

/**
 * Renders the style panel under the page's image replacement.
 *
 * @param options - The context, the selection and the replacer (none: no assets service).
 * @returns The dispatch spy.
 */
function renderPanel(options: PanelOptions) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const selection = options.selection ?? [];
  const board = {
    documentVersion: 0,
    selectedIds: selection.map((object) => object.id),
    board: { get: () => undefined },
  } as unknown as BoardViewSnapshot;
  render(
    <ImageReplacementProvider value={options.replacer}>
      <StylePanel
        registry={REGISTRY}
        context={options.context}
        board={board}
        selection={selection}
        activeTool="select"
        toolStyles={{}}
        dispatch={dispatch}
      />
    </ImageReplacementProvider>,
  );
  return { dispatch };
}

/**
 * A replacer that records each file and hands back the `apply` it was given.
 *
 * @returns The replacer and its calls.
 */
function recordingReplacer() {
  const replacer = vi.fn<ImageReplacer>();
  const applyOf = (call = 0) => {
    const apply = replacer.mock.calls[call]?.[1];
    if (apply === undefined) throw new Error('no file was given');
    return apply;
  };
  return { replacer, applyOf };
}

function kinds(label = 'fill'): HTMLElement {
  return screen.getByRole('group', { name: `Kind of ${label}` });
}

function fits(label = 'fill'): HTMLElement {
  return screen.getByRole('group', { name: `Image fit of ${label}` });
}

/**
 * Picks a file in the hidden input the way the browser does.
 *
 * @param label - The field's name, lower case.
 * @returns The file.
 */
function pickFile(label = 'fill'): File {
  const input = screen.getByLabelText<HTMLInputElement>(`Choose image for ${label}`);
  const file = new File(['png'], 'photo.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return file;
}

function lastStyles(dispatch: ReturnType<typeof renderPanel>['dispatch']): unknown {
  const action = dispatch.mock.lastCall?.[0];
  return action?.type === 'style' ? action.changes : action;
}

describe('the Image kind of a shape’s fill', () => {
  it('opens the file picker, and writes the chosen image whole and covering, badged on the shapes', () => {
    const { replacer, applyOf } = recordingReplacer();
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: RED }), shape('b', { fill: null })],
      replacer,
    });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(within(kinds()).getByRole('button', { name: 'Image' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    expect(dispatch).not.toHaveBeenCalled();
    const file = pickFile();
    expect(replacer).toHaveBeenCalledExactlyOnceWith(file, expect.any(Function));
    expect(applyOf()(CHOSEN)).toEqual(['a', 'b']);
    const fill = {
      type: 'image',
      assetId: 'asset-chosen',
      naturalSize: { width: 400, height: 300 },
      fit: 'crop',
      crop: WHOLE,
    };
    expect(dispatch).toHaveBeenCalledOnce();
    expect(lastStyles(dispatch)).toEqual([
      { id: 'a', style: { fill } },
      { id: 'b', style: { fill } },
    ]);
  });

  it('ignores a picker closed with no file', () => {
    const { replacer } = recordingReplacer();
    renderPanel({ context: 'shape', selection: [shape('a')], replacer });
    const input = screen.getByLabelText<HTMLInputElement>('Choose image for fill');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    fireEvent.change(input);
    expect(replacer).not.toHaveBeenCalled();
  });

  it('is not offered without the page’s images, for paths, or for the tools’ style', () => {
    renderPanel({ context: 'shape', selection: [shape('a')], replacer: undefined });
    expect(within(kinds()).queryByRole('button', { name: 'Image' })).toBeNull();
    cleanup();
    const { replacer } = recordingReplacer();
    const path = { ...shape('p'), type: 'path', vertices: [], segments: [] } as BoardObject;
    renderPanel({ context: 'vector', selection: [path], replacer });
    expect(within(kinds()).queryByRole('button', { name: 'Image' })).toBeNull();
    expect(screen.queryByLabelText('Choose image for fill')).toBeNull();
    cleanup();
    renderPanel({ context: 'shape', selection: [], replacer });
    expect(within(kinds()).queryByRole('button', { name: 'Image' })).toBeNull();
  });

  it('shows an image fill’s kind and fit pressed, and sets a fit in one action', () => {
    const { replacer } = recordingReplacer();
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: PHOTO })],
      replacer,
    });
    expect(
      within(kinds()).getByRole('button', { name: 'Image' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByLabelText('Fill')).toBeNull();
    expect(within(fits()).getByRole('button', { name: 'Tile' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // A press keeps the focus where it was, as the kind buttons do.
    expect(fireEvent.mouseDown(within(fits()).getByRole('button', { name: 'Fit' }))).toBe(false);
    fireEvent.click(within(fits()).getByRole('button', { name: 'Tile' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(within(fits()).getByRole('button', { name: 'Fit' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: 'a', style: { fill: { ...PHOTO, fit: 'fit' } } }],
    });
  });

  it('replaces the image in the fill’s own fit, and a second press of Image opens nothing', () => {
    const { replacer, applyOf } = recordingReplacer();
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: PHOTO })],
      replacer,
    });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(within(kinds()).getByRole('button', { name: 'Image' }));
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace image…' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    pickFile();
    applyOf()(CHOSEN);
    expect(lastStyles(dispatch)).toEqual([
      {
        id: 'a',
        style: { fill: { ...PHOTO, assetId: 'asset-chosen', naturalSize: CHOSEN.naturalSize } },
      },
    ]);
  });

  it('presses no fit for differing fits, and sets the chosen one on each image fill', () => {
    const { replacer } = recordingReplacer();
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: PHOTO }), shape('b', { fill: { ...PHOTO, fit: 'fill' } })],
      replacer,
    });
    for (const each of within(fits()).getAllByRole('button')) {
      expect(each.getAttribute('aria-pressed')).toBe('false');
    }
    fireEvent.click(within(fits()).getByRole('button', { name: 'Crop' }));
    expect(lastStyles(dispatch)).toEqual([
      { id: 'a', style: { fill: { ...PHOTO, fit: 'crop' } } },
      { id: 'b', style: { fill: { ...PHOTO, fit: 'crop' } } },
    ]);
  });

  it('keeps showing an image fill without the page’s images, with no way to replace it', () => {
    renderPanel({ context: 'shape', selection: [shape('a', { fill: PHOTO })] });
    expect(
      within(kinds()).getByRole('button', { name: 'Image' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(fits()).getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Replace image…' })).toBeNull();
  });

  it('turns an image fill to none as Solid', () => {
    const { replacer } = recordingReplacer();
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: PHOTO })],
      replacer,
    });
    fireEvent.click(within(kinds()).getByRole('button', { name: 'Solid' }));
    expect(lastStyles(dispatch)).toEqual([{ id: 'a', style: { fill: null } }]);
  });
});

describe('the Image kind of a frame’s background', () => {
  it('writes the chosen image to every selected frame, badged on them', () => {
    const { replacer, applyOf } = recordingReplacer();
    const { dispatch } = renderPanel({
      context: 'frame',
      selection: [frame('f', RED), frame('g', null)],
      replacer,
    });
    expect(within(kinds('background')).getByRole('button', { name: 'Image' })).toBeTruthy();
    pickFile('background');
    expect(applyOf()(CHOSEN)).toEqual(['f', 'g'] as ObjectId[]);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        {
          id: 'f',
          style: {
            background: {
              type: 'image',
              assetId: 'asset-chosen',
              naturalSize: CHOSEN.naturalSize,
              fit: 'crop',
              crop: WHOLE,
            },
          },
        },
        {
          id: 'g',
          style: {
            background: {
              type: 'image',
              assetId: 'asset-chosen',
              naturalSize: CHOSEN.naturalSize,
              fit: 'crop',
              crop: WHOLE,
            },
          },
        },
      ],
    });
  });
});

describe('image fill crop entry', () => {
  it.each([
    ['shape', [shape('a', { fill: PHOTO })]],
    ['frame', [frame('f', PHOTO)]],
  ] as const)(
    'offers Crop image on one unlocked %s and dispatches the selection action',
    (context, selection) => {
      const { dispatch } = renderPanel({ context, selection: [...selection] });
      fireEvent.click(screen.getByRole('button', { name: 'Crop image…' }));
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'selection',
        command: 'cropImageFill',
      });
    },
  );

  it.each([
    ['two shapes', 'shape', [shape('a', { fill: PHOTO }), shape('b', { fill: PHOTO })]],
    ['locked shape', 'shape', [shape('a', { fill: PHOTO, locked: true })]],
    ['solid shape', 'shape', [shape('a', { fill: RED })]],
    ['two frames', 'frame', [frame('a', PHOTO), frame('b', PHOTO)]],
    ['locked frame', 'frame', [{ ...frame('f', PHOTO), locked: true }]],
    ['solid frame', 'frame', [frame('f', RED)]],
  ] as const)('hides Crop image for %s', (name, context, selection) => {
    expect(name).toBeTruthy();
    renderPanel({ context, selection: [...selection] });
    expect(screen.queryByRole('button', { name: 'Crop image…' })).toBeNull();
  });
});
