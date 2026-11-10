import { describe, expect, it } from 'vitest';

import { LABEL_PADDING } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { frame, rect } from '../select/__fixtures__/select-board.js';

import {
  createTextModeContext,
  TEN,
  tenPointNote,
  tenPointText,
} from './__fixtures__/text-mode-context.js';
import { measuredSize, wrapWidthOf, writeTextContent } from './text-content-writer.js';

const CONTENT = { text: 'ab', runs: [{ length: 2, style: TEN }] };

describe('writeTextContent', () => {
  it('writes nothing to an object that has no text, or is gone', () => {
    const board = frame('frame', null, { x: 0, y: 0, width: 10, height: 10 });
    const { store, context } = createTextModeContext([board]);
    const before = store.encodeState();
    expect(writeTextContent(context, board.id, CONTENT)).toBe(false);
    expect(writeTextContent(context, 'gone' as ObjectId, CONTENT)).toBe(false);
    expect(store.encodeState()).toEqual(before);
  });

  it("writes a shape's label without a size, fonts or not, and reports nothing unmeasured", () => {
    const shape = rect('shape', null, { x: 0, y: 0, width: 100, height: 60 });
    const { store, context } = createTextModeContext([shape]);
    const unmeasured: ObjectId[] = [];
    const fontless = {
      ...context,
      layout: { layout: () => undefined },
      onWrittenUnmeasured: (written: ObjectId) => unmeasured.push(written),
    };
    expect(writeTextContent(fontless, shape.id, CONTENT)).toBe(true);
    expect(store.get(shape.id)).toMatchObject({ label: CONTENT, width: 100, height: 60 });
    expect(unmeasured).toEqual([]);
  });
});

describe('a text box’s wrap width and measured size', () => {
  it('wraps a note inside its padding, fixed text at its width, auto-width text nowhere', () => {
    expect(wrapWidthOf(tenPointNote('n', ''))).toBe(168);
    const shape = rect('shape', null, { x: 0, y: 0, width: 100, height: 60 });
    expect(wrapWidthOf(shape)).toBe(100 - 2 * LABEL_PADDING);
    expect(wrapWidthOf(tenPointText('t', '', { autoWidth: false, width: 90 }))).toBe(90);
    expect(wrapWidthOf(tenPointText('t', ''))).toBeNull();
  });

  it('keeps a note square for short text and a text object as tall as its text', () => {
    const layout = { width: 12, height: 12.5 } as Parameters<typeof measuredSize>[1];
    expect(measuredSize(tenPointNote('n', 'ab'), layout)).toEqual({ width: 200, height: 200 });
    expect(measuredSize(tenPointText('t', 'ab'), layout)).toEqual({ width: 12, height: 12.5 });
  });

  it('never shrinks a note below the height it has, and grows it past that for taller text', () => {
    const tall = tenPointNote('n', 'ab', { height: 400 });
    const short = { width: 12, height: 12.5 } as Parameters<typeof measuredSize>[1];
    const long = { width: 12, height: 500 } as Parameters<typeof measuredSize>[1];
    expect(measuredSize(tall, short)).toEqual({ width: 200, height: 400 });
    expect(measuredSize(tall, long)).toEqual({ width: 200, height: 532 });
  });
});
